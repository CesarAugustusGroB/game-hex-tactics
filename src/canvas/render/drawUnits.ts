import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { MAX_HP_BY_TYPE } from '../../battle/simulate';
import type { Unit, Team } from '../../battle/simulate';
import { getTerrainMods } from '../../battle/terrain';
import { TERRAINS } from '../terrain-defs';
import { TEAM_TINTS, HEADING_ARROWS, LOD_THRESHOLD, TICK_MS, type Armies, type GroupOrders } from '../constants';

export interface UnitsRenderContext {
  unitsGfx: PIXI.Container;
  unitContainers: Map<string, PIXI.Container>;
  // textures per (team, unit type)
  unitTextureRed: PIXI.Texture;
  unitTextureBlue: PIXI.Texture;
  unitTextureRedCavalry: PIXI.Texture;
  unitTextureBlueCAvalry: PIXI.Texture;
  unitTextureRedSkirmisher: PIXI.Texture;
  unitTextureBlueSkirmisher: PIXI.Texture;
  armyTexture: PIXI.Texture;
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

export function drawUnits(ctx: UnitsRenderContext): void {
  const c = ctx.unitsGfx;
  const armyTex = ctx.armyTexture;
  const unitTex = ctx.unitTextureRed;
  const unitTexBlue = ctx.unitTextureBlue;
  const unitTexRedCav = ctx.unitTextureRedCavalry;
  const unitTexBlueCav = ctx.unitTextureBlueCAvalry;
  const unitTexRedSkir = ctx.unitTextureRedSkirmisher;
  const unitTexBlueSkir = ctx.unitTextureBlueSkirmisher;

  // Kill GSAP tweens before destroy so they don't touch a freed object next frame.
  const destroyAllUnitContainers = () => {
    ctx.unitContainers.forEach(cont => {
      gsap.killTweensOf(cont);
      gsap.killTweensOf(cont.position);
      cont.destroy({ children: true });
    });
    ctx.unitContainers.clear();
  };

  if (ctx.viewMode === 'STRATEGIC') {
    destroyAllUnitContainers();
    c.removeChildren();
    ctx.armies.forEach((_units, key) => {
      const strategicHex = HexUtils.fromKey(key);
      const tile = ctx.gridData.find(d => d.hex.q === strategicHex.q && d.hex.r === strategicHex.r);
      if (!tile) return;
      const pos = HexUtils.hexToPixel(strategicHex);
      const sprite = new PIXI.Sprite(armyTex);
      sprite.anchor.set(0.5, 1);
      sprite.x = pos.x;
      sprite.y = pos.y - TERRAINS[tile.type].height - 6;
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
      gsap.killTweensOf(cont);
      gsap.killTweensOf(cont.position);
      cont.destroy({ children: true });
      ctx.unitContainers.delete(id);
    }
  });
  for (let i = c.children.length - 1; i >= 0; i--) {
    if (c.children[i].label !== 'unit-container') c.removeChildAt(i);
  }

  // Lieutenant per (team, groupId): the unit at the attack target if an order is
  // active, else the lowest-id live unit so a marker still appears between orders.
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

  // teamByKey is used by the team-outline edge filter below to skip edges shared with
  // a same-team neighbour (so a cluster shows only its outer perimeter). Mapping:
  // edge k ↔ neighbour at HexUtils.directions[(6 - k) % 6].
  const teamByKey = new Map<string, Team>();
  for (const u of units) teamByKey.set(HexUtils.key(u.tacticalHex), u.team);

  // Read scale directly — zoom.current is stale during a GSAP dive tween.
  const isFar = ctx.worldScale < LOD_THRESHOLD;

  const visibleHexes = new Set<string>();
  if (ctx.fogOfWar) {
    for (const u of units) {
      if (u.team !== ctx.selectedTeam) continue;
      const r = u.visionRadius;
      for (let dq = -r; dq <= r; dq++) {
        for (let dr = -r; dr <= r; dr++) {
          const h = { q: u.tacticalHex.q + dq, r: u.tacticalHex.r + dr };
          if (HexUtils.distance(u.tacticalHex, h) <= r) {
            visibleHexes.add(HexUtils.key(h));
          }
        }
      }
    }
  }

  units.forEach(u => {
    const tile = ctx.gridData.find(d => d.hex.q === u.tacticalHex.q && d.hex.r === u.tacticalHex.r);
    if (!tile) return;
    const pos = HexUtils.hexToPixel(u.tacticalHex);
    const topY = pos.y - TERRAINS[tile.type].height;
    const hexKey = HexUtils.key(u.tacticalHex);
    // Includes topY so world regeneration (same hex, new terrain type) re-targets
    // the container instead of leaving the unit floating at the old elevation.
    const targetKey = `${hexKey}|${Math.round(topY)}`;

    // Compare against the last TARGET key (not container.position, which is mid-tween)
    // so non-movement re-renders (fog toggle, hover) don't restart the animation.
    let container = ctx.unitContainers.get(u.id);
    if (!container) {
      container = new PIXI.Container();
      container.label = 'unit-container';
      container.position.set(pos.x, topY);
      (container as unknown as { _targetKey: string })._targetKey = targetKey;
      ctx.unitContainers.set(u.id, container);
      c.addChild(container);
    } else if ((container as unknown as { _targetKey?: string })._targetKey !== targetKey) {
      (container as unknown as { _targetKey: string })._targetKey = targetKey;
      // Stretch the tween over the destination terrain's cooldown so the unit GLIDES
      // across rough hexes instead of teleporting in TICK_MS and then sitting idle for
      // the moveCost cooldown ticks. The sim's discrete steps remain — only the
      // visual interpolation changes. By the time the tween finishes the cooldown is
      // also up, so the next step engages immediately → smooth and slow.
      const moveCost = getTerrainMods(tile.type).moveCost;
      gsap.to(container.position, {
        x: pos.x,
        y: topY,
        duration: (TICK_MS * (1 + moveCost)) / 1000,
        ease: 'linear',
        overwrite: true,
      });
    }

    // Position keeps tweening while hidden so a fog reveal shows the unit at its
    // current location, not the last-seen one. Children rebuild every frame so HP
    // bars / lieutenant markers stay current.
    const isHidden = ctx.fogOfWar && u.team !== ctx.selectedTeam && !visibleHexes.has(hexKey);
    container.visible = !isHidden;

    container.removeChildren();

    const teamColor = TEAM_TINTS[u.team];
    const s = HexUtils.size;
    const verts: { x: number; y: number }[] = [];
    for (let k = 0; k < 6; k++) {
      const ang = Math.PI / 180 * (60 * k);
      verts.push({ x: s * Math.cos(ang), y: s * Math.sin(ang) });
    }

    // Strategic-view team marker; drawn before the outline so strokes sit on top.
    const marker = new PIXI.Graphics();
    marker.poly(verts.flatMap(v => [v.x, v.y])).fill({ color: teamColor, alpha: 0.7 });
    marker.label = 'unit-marker';
    marker.visible = isFar;
    container.addChild(marker);

    const outline = new PIXI.Graphics();
    for (let k = 0; k < 6; k++) {
      const dir = HexUtils.directions[(6 - k) % 6];
      const nKey = HexUtils.key({ q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r });
      if (teamByKey.get(nKey) === u.team) continue;
      const a = verts[k];
      const b = verts[(k + 1) % 6];
      outline.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    outline.stroke({ color: teamColor, width: 3, alpha: 0.95 });
    container.addChild(outline);

    const unitType = u.unitType ?? 'infantry';
    const tex = u.team === 'red'
      ? (unitType === 'skirmisher' ? unitTexRedSkir : unitType === 'cavalry' ? unitTexRedCav : unitTex)
      : (unitType === 'skirmisher' ? unitTexBlueSkir : unitType === 'cavalry' ? unitTexBlueCav : unitTexBlue);
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5, 1);
    sprite.x = 0;
    sprite.y = 32;
    // Red cavalry/skirmisher art has more empty bbox margin than the infantry sprite,
    // so render bigger to match the visible silhouette.
    const isOversizedRedSprite = u.team === 'red' && (unitType === 'cavalry' || unitType === 'skirmisher');
    const spriteSize = isOversizedRedSprite ? 100 : 72;
    sprite.width = spriteSize;
    sprite.height = spriteSize;
    sprite.label = 'unit-sprite';
    sprite.visible = !isFar;
    container.addChild(sprite);

    // Per-type denominator so cavalry's 30/60 fills 50% (not the 30% an infantry would).
    const maxHp = MAX_HP_BY_TYPE[unitType];
    if (u.hp < maxHp) {
      const barW = 26;
      const barH = 4;
      const barX = -barW / 2;
      const barY = -40;
      const ratio = Math.max(0, u.hp / maxHp);
      const bg = new PIXI.Graphics();
      bg.rect(barX, barY, barW, barH).fill({ color: 0x000000, alpha: 0.6 });
      bg.label = 'unit-detail';
      bg.visible = !isFar;
      container.addChild(bg);
      const fg = new PIXI.Graphics();
      const r = Math.round(0xef * (1 - ratio) + 0x10 * ratio);
      const g = Math.round(0x44 * (1 - ratio) + 0xb9 * ratio);
      const b = Math.round(0x44 * (1 - ratio) + 0x81 * ratio);
      const color = (r << 16) | (g << 8) | b;
      fg.rect(barX, barY, barW * ratio, barH).fill({ color });
      fg.label = 'unit-detail';
      fg.visible = !isFar;
      container.addChild(fg);
    }

    if (lieutenantIds.has(u.id)) {
      const star = new PIXI.Text({
        text: '★',
        style: { fontSize: 14, fontWeight: '900', fill: 0xfacc15, stroke: { color: 0x000000, width: 2 } },
      });
      star.anchor.set(0.5);
      star.x = 0;
      star.y = -44;
      star.label = 'unit-detail';
      star.visible = !isFar;
      container.addChild(star);

      const order = ctx.groupOrders.get(`${u.team}:${u.groupId}`);
      if (order?.attackTarget) {
        const arrow = new PIXI.Text({
          text: HEADING_ARROWS[order.heading] ?? '→',
          style: { fontSize: 14, fontWeight: '900', fill: 0xfacc15, stroke: { color: 0x000000, width: 2 } },
        });
        arrow.anchor.set(0.5);
        arrow.x = 14;
        arrow.y = -44;
        arrow.label = 'unit-detail';
        arrow.visible = !isFar;
        container.addChild(arrow);
      }
    }
  });

  // Attack target indicators per group. Tagged 'unit-detail' for LOD hiding.
  // Fog of war: skip rings owned by the OTHER team — they would otherwise leak
  // enemy intent through fog (you'd see where they're charging without seeing them).
  ctx.groupOrders.forEach(order => {
    if (!order.attackTarget) return;
    if (ctx.fogOfWar && order.team !== ctx.selectedTeam) return;
    const tile = ctx.gridData.find(d => d.hex.q === order.attackTarget!.q && d.hex.r === order.attackTarget!.r);
    if (!tile) return;
    const pos = HexUtils.hexToPixel(order.attackTarget);
    const topY = pos.y - TERRAINS[tile.type].height;
    const ring = new PIXI.Graphics();
    ring.circle(pos.x, topY, 22).stroke({ width: 3, color: TEAM_TINTS[order.team], alpha: 0.85 });
    ring.label = 'unit-detail';
    ring.visible = !isFar;
    c.addChild(ring);
  });
}
