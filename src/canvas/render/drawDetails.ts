import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { TERRAINS } from '../terrain-defs';
import {
  DETAIL_RULES, spriteCategory, pickWeighted, seededRandom, getHexSeed,
} from '../detail-rules';

export interface DetailRenderContext {
  detailsGfx: PIXI.Container;
  detailTextures: Map<string, PIXI.Texture>;
  gridData: { hex: Hex; type: string }[];
  detailDensityNoise: (x: number, y: number) => number;
  viewMode: 'STRATEGIC' | 'TACTICAL';
}

// Three-layer scatter (embedded / small / landmark), deterministic per hex via seeded
// RNG, with density modulated by a 2D simplex noise.
export function drawDetails(ctx: DetailRenderContext): void {
  const { detailsGfx: dg, detailTextures, gridData, detailDensityNoise } = ctx;
  for (const child of dg.children.slice()) {
    dg.removeChild(child);
    child.destroy();
  }
  // Decorations are sub-pixel in the zoomed-out STRATEGIC island view — scattering
  // thousands of Sprites across ~3.8k hexes there is pure cost for no visible gain.
  if (ctx.viewMode === 'STRATEGIC') return;
  if (detailTextures.size === 0 || gridData.length === 0) return;
  const worldSeed = 1;
  const hexR = HexUtils.size;
  // Maps simplex's [-1,1] to a density multiplier in [0.3, 1.7] over ~10-hex-wide zones.
  const densityMultAt = (q: number, r: number): number => {
    return 1 + detailDensityNoise(q * 0.08, r * 0.08) * 0.7;
  };
  // Per-layer seed offsets so the three layers' RNGs don't correlate.
  const LAYER_ORDER: Array<'embedded' | 'small' | 'landmark'> = ['embedded', 'small', 'landmark'];
  const LAYER_SEED_OFFSET: Record<string, number> = { embedded: 11, small: 23, landmark: 41 };

  for (const item of gridData) {
    const rules = DETAIL_RULES[item.type];
    if (!rules) continue;
    const pos = HexUtils.hexToPixel(item.hex);
    const hexH = (TERRAINS[item.type] ?? TERRAINS.SEA).height;
    const topY = pos.y - hexH;
    const densityMult = densityMultAt(item.hex.q, item.hex.r);

    for (const layerName of LAYER_ORDER) {
      const layer = rules[layerName];
      if (!layer) continue;
      const hexSeed = getHexSeed(item.hex.q, item.hex.r, worldSeed + LAYER_SEED_OFFSET[layerName]);
      const effDensity = Math.min(1, layer.density * densityMult);
      if (seededRandom(hexSeed) > effDensity) continue;

      const countRng = seededRandom(hexSeed + 1);
      const count = 1 + Math.floor(countRng * layer.maxPerHex); // 1..maxPerHex

      for (let i = 0; i < count; i++) {
        const spriteKey = pickWeighted(layer.sprites, seededRandom(hexSeed + i * 10 + 2));
        const tex = detailTextures.get(spriteKey);
        if (!tex) continue;

        const angle = seededRandom(hexSeed + i * 20 + 3) * Math.PI * 2;
        const radius = layer.centered ? 0 : seededRandom(hexSeed + i * 30 + 4) * hexR * 0.35;
        const xOff = Math.cos(angle) * radius;
        const yOff = Math.sin(angle) * radius;

        const [scaleLo, scaleHi] = layer.scaleRange;
        const scale = scaleLo + seededRandom(hexSeed + i * 40 + 5) * (scaleHi - scaleLo);
        const [alphaLo, alphaHi] = layer.alphaRange;
        const alpha = alphaLo + seededRandom(hexSeed + i * 60 + 7) * (alphaHi - alphaLo);

        const category = spriteCategory(spriteKey);
        const tint = rules.categoryStyle[category]?.tint ?? 0xFFFFFF;
        const isWaterDetail = item.type === 'RIVER' || item.type === 'SEA';
        const rotation = 0;

        const sprite = new PIXI.Sprite(tex);
        sprite.anchor.set(0.5, isWaterDetail ? 0.5 : 0.85);
        sprite.x = pos.x + xOff;
        sprite.y = topY + yOff;
        sprite.scale.set(scale, scale);
        sprite.rotation = rotation;
        sprite.alpha = category === 'rock' ? 1.0 : alpha;
        sprite.tint = tint;
        dg.addChild(sprite);
      }
    }
  }
}
