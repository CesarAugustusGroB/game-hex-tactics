import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { MAX_HP_BY_TYPE } from '../../battle/simulate';
import { planFollowerLegs, PX_PER_HEX } from './followerPath';
import type { Unit, Team } from '../../battle/simulate';
import { getTerrainMods } from '../../battle/terrain';
import { TERRAINS } from '../terrain-defs';
import { TEAM_TINTS, HEADING_ARROWS, LOD_THRESHOLD, TICK_MS, type Armies, type GroupOrders } from '../constants';
import { spawnMovementDust } from './movementFx';

const UNIT_SPRITE_SIZE = 112;
const UNIT_SHADOW_OFFSET = { x: 8, y: 18 };
const UNIT_SHADOW_ALPHA = 0.35;
const UNIT_SHADOW_W = UNIT_SPRITE_SIZE * 0.82;
const UNIT_SHADOW_H = UNIT_SPRITE_SIZE * 0.30;
const HP_BAR_W = 26;
const HP_BAR_H = 4;
const HP_BAR_Y = -40;
const BADGE_Y = -44;
const STAR_STYLE = { fontSize: 14, fontWeight: '900' as const, fill: 0xfacc15, stroke: { color: 0x000000, width: 2 } };

// Persistent per-unit children, created once and mutated each tick. Stored on the unit
// container as `_visual` (same casting convention the codebase uses for `_targetKey`).
interface UnitVisual {
  marker: PIXI.Graphics;
  outline: PIXI.Graphics;
  shadow: PIXI.Sprite;
  sprite: PIXI.Sprite;
  hpBg: PIXI.Sprite;
  hpFg: PIXI.Sprite;
  star: PIXI.Text;
  arrow: PIXI.Text;
  arrowHeading: string;
}
// `_path`: pending move waypoints (hex centers) the visual still has to walk through, each
// tagged with the px/sec speed for that leg. A per-frame follower (advanceUnitFollowers)
// drains it at constant speed so fractional sim speeds (1.5 hex/tick → 1,2,1,2 hexes per
// tick) glide smoothly instead of pulsing fast/slow each tick.
type UnitContainer = PIXI.Container & {
  _targetKey?: string; _hexKey?: string; _hex?: Hex; _visual?: UnitVisual;
  _path?: { x: number; y: number; speed: number }[];
};

/** Advance every unit container one frame along its queued move path at constant speed.
 *  Called from the PIXI ticker (per frame). The buffered path gives a small lag that keeps
 *  motion continuous across the sim's lumpy per-tick hex delivery — no fast/slow pulsing,
 *  pauses only when a unit genuinely stops (combat, idle). */
export function advanceUnitFollowers(containers: Map<string, PIXI.Container>, deltaMS: number): void {
  const dt = deltaMS / 1000;
  containers.forEach(cont => {
    const c = cont as UnitContainer;
    if (c.destroyed || !c._path || c._path.length === 0) return;
    // Safety against runaway lag (e.g. speed/delivery drift): never trail more than a few
    // hexes — jump to the penultimate waypoint and glide the last leg.
    if (c._path.length > 6) c._path.splice(0, c._path.length - 2);
    let budget = c._path[0].speed * dt;
    while (budget > 0 && c._path.length > 0) {
      const wp = c._path[0];
      const dx = wp.x - c.position.x, dy = wp.y - c.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        c.position.set(wp.x, wp.y);
        c._path.shift();
        budget -= dist;
      } else {
        c.position.x += (dx / dist) * budget;
        c.position.y += (dy / dist) * budget;
        budget = 0;
      }
    }
  });
}

export interface UnitsRenderContext {
  unitsGfx: PIXI.Container;
  movementDustGfx: PIXI.Container;
  unitContainers: Map<string, PIXI.Container>;
  dustTexture: PIXI.Texture | null;
  // textures per (team, unit type)
  unitTextureRed: PIXI.Texture;
  unitTextureBlue: PIXI.Texture;
  unitTextureRedCavalry: PIXI.Texture;
  unitTextureBlueCavalry: PIXI.Texture;
  unitTextureRedSkirmisher: PIXI.Texture;
  unitTextureBlueSkirmisher: PIXI.Texture;
  armyTexture: PIXI.Texture;
  // Soft shadow baked once at boot (PixiApp). Drawn as a plain Sprite per unit.
  shadowTexture: PIXI.Texture;
  // data
  armies: Armies;
  groupOrders: GroupOrders;
  gridData: { hex: Hex; type: string }[];
  currentStrategicHex: Hex | null;
  viewMode: 'STRATEGIC' | 'TACTICAL';
  selectedTeam: Team;
  fogOfWar: boolean;
  // current world scale — read directly so GSAP dive tweens don't cause stale reads
  worldScale: number;
}

// Unit-local hexagon vertices (size = HexUtils.size) — identical for every unit, so
// compute once at module load instead of per unit per tick.
const UNIT_VERTS: { x: number; y: number }[] = (() => {
  const s = HexUtils.size;
  const v: { x: number; y: number }[] = [];
  for (let k = 0; k < 6; k++) {
    const ang = (Math.PI / 180) * (60 * k);
    v.push({ x: s * Math.cos(ang), y: s * Math.sin(ang) });
  }
  return v;
})();

function createUnitVisual(
  container: PIXI.Container,
  tex: PIXI.Texture,
  shadowTex: PIXI.Texture,
  teamColor: number,
  isFar: boolean,
): UnitVisual {
  // Strategic-view team marker; drawn before the outline so strokes sit on top.
  const marker = new PIXI.Graphics();
  marker.poly(UNIT_VERTS.flatMap(v => [v.x, v.y])).fill({ color: teamColor, alpha: 0.7 });
  marker.label = 'unit-marker';
  marker.visible = isFar;
  container.addChild(marker);

  // Team perimeter outline — geometry redrawn each tick (neighbour-dependent).
  const outline = new PIXI.Graphics();
  container.addChild(outline);

  const shadow = new PIXI.Sprite(shadowTex);
  shadow.anchor.set(0.5);
  shadow.x = UNIT_SHADOW_OFFSET.x;
  shadow.y = UNIT_SHADOW_OFFSET.y;
  shadow.width = UNIT_SHADOW_W;
  shadow.height = UNIT_SHADOW_H;
  shadow.alpha = UNIT_SHADOW_ALPHA;
  shadow.label = 'unit-sprite-shadow';
  shadow.visible = !isFar;
  container.addChild(shadow);

  const sprite = new PIXI.Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.width = UNIT_SPRITE_SIZE;
  sprite.height = UNIT_SPRITE_SIZE;
  sprite.label = 'unit-sprite';
  sprite.visible = !isFar;
  container.addChild(sprite);

  // HP bar as tinted white sprites so per-tick updates just set width/tint (no Graphics
  // rebuild). Anchor 0 (top-left) matches the old Graphics rect(barX, barY, ...).
  const hpBg = new PIXI.Sprite(PIXI.Texture.WHITE);
  hpBg.tint = 0x000000;
  hpBg.alpha = 0.6;
  hpBg.width = HP_BAR_W;
  hpBg.height = HP_BAR_H;
  hpBg.x = -HP_BAR_W / 2;
  hpBg.y = HP_BAR_Y;
  hpBg.label = 'unit-detail';
  hpBg.visible = false;
  container.addChild(hpBg);

  const hpFg = new PIXI.Sprite(PIXI.Texture.WHITE);
  hpFg.height = HP_BAR_H;
  hpFg.x = -HP_BAR_W / 2;
  hpFg.y = HP_BAR_Y;
  hpFg.label = 'unit-detail';
  hpFg.visible = false;
  container.addChild(hpFg);

  const star = new PIXI.Text({ text: '★', style: STAR_STYLE });
  star.anchor.set(0.5);
  star.x = 0;
  star.y = BADGE_Y;
  star.label = 'unit-detail';
  star.visible = false;
  container.addChild(star);

  const arrow = new PIXI.Text({ text: '→', style: STAR_STYLE });
  arrow.anchor.set(0.5);
  arrow.x = 14;
  arrow.y = BADGE_Y;
  arrow.label = 'unit-detail';
  arrow.visible = false;
  container.addChild(arrow);

  return { marker, outline, shadow, sprite, hpBg, hpFg, star, arrow, arrowHeading: '→' };
}

export function drawUnits(ctx: UnitsRenderContext): void {
  const c = ctx.unitsGfx;
  const armyTex = ctx.armyTexture;

  // Kill EVERY GSAP tween bound to a unit before destroy. Killing only the container +
  // its position MISSED the children — the unit-sprite carries the melee lunge tween, and
  // a surviving tween keeps setting .x/.y on a freed (null) object every frame, throwing
  // inside GSAP's rAF. One such throw aborts that frame's whole tween pass → ALL units
  // freeze for a frame and then jump = the "teleport". Children must be killed too.
  const killUnitTweens = (cont: PIXI.Container) => {
    gsap.killTweensOf(cont);
    gsap.killTweensOf(cont.position);
    for (const child of cont.children) {
      gsap.killTweensOf(child);
      gsap.killTweensOf((child as PIXI.Container).position);
      gsap.killTweensOf((child as PIXI.Container).scale);
    }
  };
  const destroyAllUnitContainers = () => {
    ctx.unitContainers.forEach(cont => {
      killUnitTweens(cont);
      cont.destroy({ children: true });
    });
    ctx.unitContainers.clear();
  };

  // Single O(hexes) build, then O(1) lookups — replaces per-unit / per-ring gridData.find.
  const tileTypeByKey = new Map<string, string>(ctx.gridData.map(d => [HexUtils.key(d.hex), d.type]));

  if (ctx.viewMode === 'STRATEGIC') {
    destroyAllUnitContainers();
    c.removeChildren();
    ctx.armies.forEach((_units, key) => {
      const strategicHex = HexUtils.fromKey(key);
      const type = tileTypeByKey.get(key);
      if (!type) return;
      const pos = HexUtils.hexToPixel(strategicHex);
      const sprite = new PIXI.Sprite(armyTex);
      sprite.anchor.set(0.5, 1);
      sprite.x = pos.x;
      sprite.y = pos.y - TERRAINS[type].height - 6;
      sprite.width = 40;
      sprite.height = 40;
      c.addChild(sprite);
    });
    return;
  }

  // TACTICAL
  if (!ctx.currentStrategicHex) {
    destroyAllUnitContainers();
    c.removeChildren();
    return;
  }
  const units = ctx.armies.get(HexUtils.key(ctx.currentStrategicHex)) ?? [];

  // Destroy containers for units that no longer exist so GSAP can't tween ghosts.
  const wantedIds = new Set(units.map(u => u.id));
  ctx.unitContainers.forEach((cont, id) => {
    if (!wantedIds.has(id)) {
      killUnitTweens(cont);
      cont.destroy({ children: true });
      ctx.unitContainers.delete(id);
    }
  });
  // Remove only transient children (attack-target rings); persistent unit containers stay.
  for (let i = c.children.length - 1; i >= 0; i--) {
    if (c.children[i].label !== 'unit-container') c.removeChildAt(i);
  }

  // Lieutenant per (team, groupId): the unit at the attack target if an order is active,
  // else the lowest-id live unit so a marker still appears between orders.
  const lieutenantIds = new Set<string>();
  const lowestByGroup = new Map<string, Unit>();
  for (const u of units) {
    const k = `${u.team}:${u.groupId}`;
    const cur = lowestByGroup.get(k);
    if (!cur || u.id < cur.id) lowestByGroup.set(k, u);
  }
  lowestByGroup.forEach((lo, key) => {
    const order = ctx.groupOrders.get(key);
    if (order?.attackTarget) {
      const at = order.attackTarget;
      const onTarget = units.find(u =>
        `${u.team}:${u.groupId}` === key
        && u.tacticalHex.q === at.q && u.tacticalHex.r === at.r
      );
      lieutenantIds.add((onTarget ?? lo).id);
    } else {
      lieutenantIds.add(lo.id);
    }
  });

  // teamByKey lets the outline skip edges shared with a same-team neighbour (cluster shows
  // only its outer perimeter). Edge k ↔ neighbour at HexUtils.directions[(6 - k) % 6].
  const teamByKey = new Map<string, Team>();
  for (const u of units) teamByKey.set(HexUtils.key(u.tacticalHex), u.team);

  const isFar = ctx.worldScale < LOD_THRESHOLD;

  const visibleHexes = new Set<string>();
  if (ctx.fogOfWar) {
    for (const u of units) {
      if (u.team !== ctx.selectedTeam) continue;
      const r = u.visionRadius;
      for (let dq = -r; dq <= r; dq++) {
        for (let dr = -r; dr <= r; dr++) {
          const h = { q: u.tacticalHex.q + dq, r: u.tacticalHex.r + dr };
          if (HexUtils.distance(u.tacticalHex, h) <= r) visibleHexes.add(HexUtils.key(h));
        }
      }
    }
  }

  units.forEach(u => {
    const hexKey = HexUtils.key(u.tacticalHex);
    const tileType = tileTypeByKey.get(hexKey);
    if (!tileType) return;
    const pos = HexUtils.hexToPixel(u.tacticalHex);
    const topY = pos.y - TERRAINS[tileType].height;
    // Includes topY so world regeneration (same hex, new terrain type) re-targets the
    // container instead of leaving the unit floating at the old elevation.
    const targetKey = `${hexKey}|${Math.round(topY)}`;
    const unitType = u.unitType ?? 'infantry';
    const teamColor = TEAM_TINTS[u.team];

    let container = ctx.unitContainers.get(u.id) as UnitContainer | undefined;
    // Defensive: a destroyed container left in the map has a null .position; tweening it
    // throws inside GSAP's rAF. Drop it and rebuild fresh.
    if (container?.destroyed) {
      ctx.unitContainers.delete(u.id);
      container = undefined;
    }
    if (!container) {
      container = new PIXI.Container() as UnitContainer;
      container.label = 'unit-container';
      container.position.set(pos.x, topY);
      container.zIndex = topY;
      container._targetKey = targetKey;
      container._hexKey = hexKey;
      container._hex = u.tacticalHex;
      container._path = [];
      const tex = u.team === 'red'
        ? (unitType === 'skirmisher' ? ctx.unitTextureRedSkirmisher : unitType === 'cavalry' ? ctx.unitTextureRedCavalry : ctx.unitTextureRed)
        : (unitType === 'skirmisher' ? ctx.unitTextureBlueSkirmisher : unitType === 'cavalry' ? ctx.unitTextureBlueCavalry : ctx.unitTextureBlue);
      container._visual = createUnitVisual(container, tex, ctx.shadowTexture, teamColor, isFar);
      ctx.unitContainers.set(u.id, container);
      c.addChild(container);
    } else if (container._targetKey !== targetKey) {
      const from = { x: container.position.x, y: container.position.y };
      const movedHex = container._hexKey !== hexKey;
      container._targetKey = targetKey;
      container._hexKey = hexKey;
      container.zIndex = topY;
      const path = container._path ?? (container._path = []);
      const moveCost = getTerrainMods(tileType).moveCost;
      const oldHex = container._hex ?? u.tacticalHex;
      container._hex = u.tacticalHex;
      // Teleports (redeploy, order-drag reposition, world regen) jump farther than any single
      // tick's march/charge could — snap instead of gliding across the map.
      const tail = path.length > 0 ? path[path.length - 1] : from;
      const jump = Math.hypot(pos.x - tail.x, topY - tail.y);
      if (jump > PX_PER_HEX * 7) {
        path.length = 0;
        container.position.set(pos.x, topY);
      } else {
        // Trace the actual per-tick hex path (no corner-cutting) at the delivered speed (no
        // fast/slow pulsing on fractional speeds). Elevation per intermediate hex via tileType.
        const topPixel = (h: Hex) => {
          const t = tileTypeByKey.get(HexUtils.key(h));
          const p = HexUtils.hexToPixel(h);
          return { x: p.x, y: t != null ? p.y - TERRAINS[t].height : p.y };
        };
        const legs = planFollowerLegs(oldHex, u.tacticalHex, topPixel, moveCost);
        if (legs.length === 0) container.position.set(pos.x, topY); // same hex, new elevation
        else for (const leg of legs) path.push(leg);
      }
      const isHiddenMove = ctx.fogOfWar && u.team !== ctx.selectedTeam && !visibleHexes.has(hexKey);
      if (movedHex && !isFar && !isHiddenMove) {
        spawnMovementDust({
          movementDustGfx: ctx.movementDustGfx,
          dustTexture: ctx.dustTexture,
          from,
          to: { x: pos.x, y: topY },
          unitType,
          worldScale: ctx.worldScale,
          duration: (TICK_MS * (1 + moveCost)) / 1000,
          zIndex: topY,
          seed: `${u.id}:${hexKey}`,
        });
      }
    }

    const v = container._visual!;

    // Position keeps tweening while hidden so a fog reveal shows the unit at its current
    // location, not the last-seen one.
    const isHidden = ctx.fogOfWar && u.team !== ctx.selectedTeam && !visibleHexes.has(hexKey);
    container.visible = !isHidden;

    // Outline depends on same-team neighbours, which change as units move. clear()+redraw
    // reuses the Graphics object — no per-tick allocation.
    v.outline.clear();
    for (let k = 0; k < 6; k++) {
      const dir = HexUtils.directions[(6 - k) % 6];
      const nKey = HexUtils.key({ q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r });
      if (teamByKey.get(nKey) === u.team) continue;
      const a = UNIT_VERTS[k];
      const b = UNIT_VERTS[(k + 1) % 6];
      v.outline.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    v.outline.stroke({ color: teamColor, width: 3, alpha: 0.95 });

    // sprite/shadow/marker visibility is LOD-only and owned by the PixiApp ticker; set at
    // create. unit-detail (HP bar, ★, →) is conditional → owned here, set every tick.
    const maxHp = MAX_HP_BY_TYPE[unitType];
    const showHp = u.hp < maxHp && !isFar;
    v.hpBg.visible = showHp;
    v.hpFg.visible = showHp;
    if (showHp) {
      const ratio = Math.max(0, u.hp / maxHp);
      v.hpFg.width = HP_BAR_W * ratio;
      const r = Math.round(0xef * (1 - ratio) + 0x10 * ratio);
      const g = Math.round(0x44 * (1 - ratio) + 0xb9 * ratio);
      const b = Math.round(0x44 * (1 - ratio) + 0x81 * ratio);
      v.hpFg.tint = (r << 16) | (g << 8) | b;
    }

    const isLt = lieutenantIds.has(u.id);
    v.star.visible = isLt && !isFar;
    const order = ctx.groupOrders.get(`${u.team}:${u.groupId}`);
    const showArrow = isLt && !!order?.attackTarget && !isFar;
    v.arrow.visible = showArrow;
    if (showArrow) {
      const heading = HEADING_ARROWS[order!.heading] ?? '→';
      // Re-rasterizing Text is costly — only set .text when the glyph actually changes.
      if (heading !== v.arrowHeading) {
        v.arrow.text = heading;
        v.arrowHeading = heading;
      }
    }
  });

  // Attack target indicators per group — transient (≤ a handful per tick), recreated each
  // call. Fog of war: skip rings owned by the OTHER team so enemy intent doesn't leak.
  ctx.groupOrders.forEach(order => {
    if (!order.attackTarget) return;
    if (ctx.fogOfWar && order.team !== ctx.selectedTeam) return;
    const type = tileTypeByKey.get(HexUtils.key(order.attackTarget));
    if (!type) return;
    const pos = HexUtils.hexToPixel(order.attackTarget);
    const topY = pos.y - TERRAINS[type].height;
    const ring = new PIXI.Graphics();
    ring.circle(pos.x, topY, 22).stroke({ width: 3, color: TEAM_TINTS[order.team], alpha: 0.85 });
    ring.label = 'unit-detail';
    ring.visible = !isFar;
    ring.zIndex = topY;
    c.addChild(ring);
  });
}
