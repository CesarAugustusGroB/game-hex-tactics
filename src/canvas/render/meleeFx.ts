import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import type { MeleeEvent } from '../../battle/simulate';
import { TEAM_TINTS, LOD_THRESHOLD } from '../constants';

const MAX_FULL_EVENTS_PER_TICK = 24;
const BASE_DURATION = 0.34;
const STAGGER_STEP = 0.035;

type UnitContainer = PIXI.Container & { _targetKey?: string };

export interface MeleeFxContext {
  combatFxGfx: PIXI.Container;
  unitContainers: Map<string, PIXI.Container>;
  dustTexture: PIXI.Texture | null;
  events: MeleeEvent[];
  worldScale: number;
}

const eventRank = (a: MeleeEvent, b: MeleeEvent): number => {
  if (a.killed !== b.killed) return a.killed ? -1 : 1;
  if (a.damage !== b.damage) return b.damage - a.damage;
  return `${a.attackerId}:${a.targetId}`.localeCompare(`${b.attackerId}:${b.targetId}`);
};

const stableNoise = (seed: string, n: number): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  const v = Math.sin((hash + n * 9973) * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

// A small, smooth lean-in of the attacker's sprite toward its target on impact. Deliberately
// gentle + attacker-only: the original version also knocked the target back AND hard-reset
// the sprite to (0,0) on every hit, which during sustained melee read as a per-tick
// jitter/teleport. Here we tween from the sprite's CURRENT offset (no snap), so rapid
// repeated hits retarget smoothly. (The sprite is a child of the unit container, so the
// offset is ≤`amount` px and rides along with the container's own position.)
const lungeAttacker = (container: UnitContainer, dx: number, dy: number, amount: number, delay: number): void => {
  const sprite = container.children.find(c => c.label === 'unit-sprite') as PIXI.Sprite | undefined;
  if (!sprite || !sprite.visible) return;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (dx / len) * amount;
  const oy = (dy / len) * amount;
  gsap.killTweensOf(sprite);
  gsap.timeline({ delay })
    .to(sprite, { x: ox, y: oy, duration: 0.08, ease: 'power2.out' })
    .to(sprite, { x: 0, y: 0, duration: 0.18, ease: 'power2.inOut' });
};

const addDust = (
  layer: PIXI.Container,
  dustTexture: PIXI.Texture | null,
  seed: string,
  backX: number,
  backY: number,
  delay: number,
): void => {
  const count = 6;
  for (let i = 0; i < count; i++) {
    const side = stableNoise(seed, i) - 0.5;
    const along = stableNoise(seed, i + 21);
    const size = 15 + stableNoise(seed, i + 42) * 14;
    const dust = dustTexture ? new PIXI.Sprite(dustTexture) : new PIXI.Graphics();
    if (dust instanceof PIXI.Sprite) {
      dust.anchor.set(0.5);
      dust.width = size * 1.35;
      dust.height = size * 0.92;
      dust.tint = stableNoise(seed, i + 84) > 0.5 ? 0xd7b46f : 0xbda36f;
    } else {
      dust.ellipse(0, 0, size * 0.5, size * 0.32).fill({ color: 0xb9a06b, alpha: 0.42 });
    }
    const x = backX * (8 + along * 10) + -backY * side * 16;
    const y = backY * (8 + along * 10) + backX * side * 10 + 4;
    dust.x = x;
    dust.y = y;
    dust.alpha = 0;
    dust.rotation = side * 1.2;
    dust.scale.set(0.18 + stableNoise(seed, i + 126) * 0.1);
    layer.addChild(dust);
    gsap.to(dust, {
      alpha: 0.18,
      duration: 0.05,
      delay: delay + i * 0.008,
      ease: 'none',
    });
    gsap.to(dust, {
      x: x + backX * (9 + along * 12),
      y: y + backY * (7 + along * 8) + 3,
      alpha: 0,
      duration: 0.26,
      delay: delay + 0.05 + i * 0.008,
      ease: 'power2.out',
    });
    gsap.to(dust.scale, {
      x: 0.42,
      y: 0.34,
      duration: 0.28,
      delay,
      ease: 'power2.out',
    });
  }
};

const addSlash = (
  layer: PIXI.Container,
  color: number,
  killed: boolean,
  heightBonus: number,
  delay: number,
): void => {
  const slash = new PIXI.Graphics();
  const length = killed ? 42 : 34;
  const width = killed ? 5 : 3;
  slash.moveTo(-length / 2, -8).quadraticCurveTo(0, -18, length / 2, 8);
  slash.stroke({ color, width, alpha: killed ? 0.96 : 0.82 });
  slash.alpha = 0;
  slash.scale.set(0.72);
  layer.addChild(slash);
  gsap.to(slash, {
    alpha: 1,
    duration: 0.04,
    delay,
    ease: 'none',
  });
  gsap.to(slash, {
    alpha: 0,
    duration: 0.22,
    delay: delay + 0.06,
    ease: 'power2.out',
  });
  gsap.to(slash.scale, {
    x: 1.18,
    y: 1.18,
    duration: 0.22,
    delay,
    ease: 'power2.out',
  });

  if (heightBonus <= 0) return;
  const drop = new PIXI.Graphics();
  drop.moveTo(-5, -28).lineTo(5, -10).lineTo(0, -5);
  drop.stroke({ color: 0xfacc15, width: 3, alpha: 0.75 });
  drop.alpha = 0;
  layer.addChild(drop);
  gsap.to(drop, { alpha: 0.9, y: 7, duration: 0.08, delay, ease: 'power2.out' });
  gsap.to(drop, { alpha: 0, duration: 0.18, delay: delay + 0.09, ease: 'power2.out' });
};

const addKillPop = (layer: PIXI.Container, teamColor: number, delay: number): void => {
  const ring = new PIXI.Graphics();
  ring.circle(0, 0, 16).stroke({ color: teamColor, width: 4, alpha: 0.95 });
  ring.alpha = 0;
  ring.scale.set(0.55);
  layer.addChild(ring);
  gsap.to(ring, { alpha: 0.95, duration: 0.04, delay, ease: 'none' });
  gsap.to(ring, { alpha: 0, duration: 0.32, delay: delay + 0.04, ease: 'power2.out' });
  gsap.to(ring.scale, { x: 1.9, y: 1.9, duration: 0.32, delay, ease: 'power2.out' });
};

export const spawnMeleeEffects = (ctx: MeleeFxContext): void => {
  if (ctx.events.length === 0 || ctx.worldScale < LOD_THRESHOLD) return;

  const events = [...ctx.events].sort(eventRank).slice(0, MAX_FULL_EVENTS_PER_TICK);
  events.forEach((event, idx) => {
    const attacker = ctx.unitContainers.get(event.attackerId) as UnitContainer | undefined;
    const target = ctx.unitContainers.get(event.targetId) as UnitContainer | undefined;
    if (!attacker || !target || !attacker.visible || !target.visible) return;

    const ax = attacker.position.x;
    const ay = attacker.position.y;
    const tx = target.position.x;
    const ty = target.position.y;
    const dx = tx - ax;
    const dy = ty - ay;
    const delay = (idx % 8) * STAGGER_STEP;
    const teamColor = TEAM_TINTS[event.attackerTeam];

    lungeAttacker(attacker, dx, dy, event.attackerType === 'cavalry' ? 8 : 5, delay);

    const layer = new PIXI.Container();
    layer.x = ax + dx * 0.55;
    layer.y = ay + dy * 0.55 - 8;
    layer.rotation = Math.atan2(dy, dx);
    layer.zIndex = Math.max(ay, ty) + 2;
    layer.label = 'combat-fx';
    ctx.combatFxGfx.addChild(layer);

    addSlash(layer, event.killed ? 0xffffff : teamColor, event.killed, event.heightBonus, delay + 0.045);
    addDust(layer, ctx.dustTexture, `${event.attackerId}:${event.targetId}`, -1, 0, delay + 0.04);
    if (event.killed) addKillPop(layer, TEAM_TINTS[event.targetTeam], delay + 0.03);

    gsap.delayedCall(delay + BASE_DURATION + 0.22, () => {
      for (const child of layer.children) {
        gsap.killTweensOf(child);
        if ('scale' in child) gsap.killTweensOf(child.scale);
      }
      if (layer.parent) layer.parent.removeChild(layer);
      layer.destroy({ children: true });
    });
  });
};
