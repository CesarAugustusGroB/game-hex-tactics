import * as PIXI from 'pixi.js';

// Deterministic [0,1) hash of (seed, n). The multiplier decorrelates independent FX
// systems (melee vs movement) so their particle scatters don't line up — bind one per
// system via the factory and reuse it.
export const makeStableNoise = (mult: number) => (seed: string, n: number): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  const v = Math.sin((hash + n * mult) * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

// One dust particle: a tinted Sprite when the dust texture loaded, else a plain ellipse
// Graphics fallback. Callers own positioning, rotation, scale and the tween.
export const makeDustParticle = (
  tex: PIXI.Texture | null,
  opts: { width: number; height: number; tint: number; ellipseRx: number; ellipseRy: number; ellipseAlpha: number },
): PIXI.Sprite | PIXI.Graphics => {
  if (tex) {
    const s = new PIXI.Sprite(tex);
    s.anchor.set(0.5);
    s.width = opts.width;
    s.height = opts.height;
    s.tint = opts.tint;
    return s;
  }
  return new PIXI.Graphics()
    .ellipse(0, 0, opts.ellipseRx, opts.ellipseRy)
    .fill({ color: 0xb9a06b, alpha: opts.ellipseAlpha });
};
