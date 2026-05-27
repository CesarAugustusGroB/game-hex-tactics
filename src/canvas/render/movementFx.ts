import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import type { UnitType } from '../../battle/simulate';
import { LOD_THRESHOLD } from '../constants';

const DUST_BY_TYPE: Record<UnitType, { count: number; size: number; alpha: number }> = {
  cavalry: { count: 7, size: 0.72, alpha: 0.2 },
  infantry: { count: 4, size: 0.54, alpha: 0.15 },
  skirmisher: { count: 2, size: 0.42, alpha: 0.11 },
};

export interface MovementDustContext {
  movementDustGfx: PIXI.Container;
  dustTexture: PIXI.Texture | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
  unitType: UnitType;
  worldScale: number;
  duration: number;
  zIndex: number;
  seed: string;
}

const stableNoise = (seed: string, n: number): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  const v = Math.sin((hash + n * 7919) * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

export const spawnMovementDust = (ctx: MovementDustContext): void => {
  if (ctx.worldScale < LOD_THRESHOLD) return;
  const spec = DUST_BY_TYPE[ctx.unitType];
  const dx = ctx.to.x - ctx.from.x;
  const dy = ctx.to.y - ctx.from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const nx = dx / len;
  const ny = dy / len;
  const px = -ny;
  const py = nx;
  const spread = ctx.unitType === 'cavalry' ? 13 : ctx.unitType === 'infantry' ? 9 : 6;
  const drift = ctx.unitType === 'cavalry' ? 12 : ctx.unitType === 'infantry' ? 8 : 5;
  const activeDuration = Math.max(0.12, ctx.duration * 0.48);

  for (let i = 0; i < spec.count; i++) {
    const along = (i + 0.35 + stableNoise(ctx.seed, i) * 0.45) / spec.count;
    const side = stableNoise(ctx.seed, i + 31) - 0.5;
    const radius = (8 + stableNoise(ctx.seed, i + 62) * 7) * spec.size;
    const dust = ctx.dustTexture ? new PIXI.Sprite(ctx.dustTexture) : new PIXI.Graphics();
    if (dust instanceof PIXI.Sprite) {
      dust.anchor.set(0.5);
      dust.width = radius * 1.7;
      dust.height = radius * 1.05;
      dust.tint = stableNoise(ctx.seed, i + 93) > 0.5 ? 0xd6b16e : 0xb9a06b;
    } else {
      dust.ellipse(0, 0, radius * 0.55, radius * 0.34).fill({ color: 0xb9a06b, alpha: spec.alpha });
    }
    dust.x = ctx.from.x + dx * along + px * side * spread;
    dust.y = ctx.from.y + dy * along + py * side * spread + 16;
    dust.alpha = 0;
    dust.rotation = Math.atan2(dy, dx) + side * 0.8;
    dust.scale.set(0.16 + stableNoise(ctx.seed, i + 124) * 0.08);
    dust.zIndex = ctx.zIndex - 1;
    dust.label = 'movement-dust';
    ctx.movementDustGfx.addChild(dust);

    const delay = along * activeDuration;
    // ONE timeline owns all of this dust's sub-tweens, so cleanup runs exactly once — after
    // EVERY sub-tween is done. Previously three independent tweens each ran, and the move
    // tween's onComplete destroyed the sprite; under frame lag GSAP completes all three in
    // the same tick, so destroying the sprite mid-tick nulled its `.position` and the still-
    // queued scale tween then set `.y` on null — throwing inside GSAP's rAF, which aborts
    // the whole tween pass (every unit's movement tween stops → freeze, then jumps →
    // teleport) and stops FX cleanup (dust leaks, compounding the lag). A timeline can't
    // destroy the target while a sibling is still pending.
    gsap.timeline({
      onComplete: () => {
        if (dust.parent) dust.parent.removeChild(dust);
        dust.destroy();
      },
    })
      .to(dust, { alpha: spec.alpha, duration: 0.05, ease: 'none' }, delay)
      .to(dust.scale, { x: 0.34 + spec.size * 0.12, y: 0.28 + spec.size * 0.1, duration: 0.28, ease: 'power2.out' }, delay)
      .to(dust, {
        x: dust.x - nx * drift + px * side * 9,
        y: dust.y - ny * drift + py * side * 5 + 3,
        alpha: 0, duration: 0.26, ease: 'power2.out',
      }, delay + 0.05);
  }
};
