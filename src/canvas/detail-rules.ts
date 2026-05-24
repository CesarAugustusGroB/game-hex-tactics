import { GRASS_CHUNK_SIZE } from '../data/details';

export {
  ALL_DETAIL_KEYS,
  detailAssetPath,
  GRASS_CHUNK_SIZE,
  spriteCategory,
  DETAIL_RULES,
} from '../data/details';

export interface WeightedSprite { key: string; weight: number }

export interface DetailLayerConfig {
  /** Base spawn chance per hex BEFORE the density-noise multiplier is applied. */
  density: number;
  /** Max sprite instances per spawn-eligible hex. */
  maxPerHex: number;
  /** Source-PNG scale range. The sprite's `scale.set` is sampled from this. */
  scaleRange: [number, number];
  alphaRange: [number, number];
  /** Pool the per-hex sprite is drawn from, by weight (higher = more likely). */
  sprites: WeightedSprite[];
  /** Draw at hex center instead of sampling a small random offset. */
  centered?: boolean;
}

export interface CategoryStyle {
  /** Multiplicative tint applied to every sprite of this category. Pulls saturated
   *  source-PNG colour into the terrain palette so details feel embedded. */
  tint: number;
}

export interface TerrainDetailRules {
  embedded?: DetailLayerConfig;
  small?: DetailLayerConfig;
  landmark?: DetailLayerConfig;
  /** Per-sprite-category tint, looked up by sprite-key prefix. Alpha/scale belong to
   *  the layer; only tint varies by category to keep this table small. */
  categoryStyle: Partial<Record<DetailCategory, CategoryStyle>>;
}

export type DetailCategory =
  | 'grass' | 'flower' | 'rock'
  | 'pine' | 'shrub' | 'leafPatch' | 'undergrowth' | 'moss' | 'needles'
  | 'ripple' | 'shimmer' | 'current' | 'foam' | 'depthWisp' | 'seaShimmer';

export const pickWeighted = (pool: WeightedSprite[], rng: number): string => {
  let total = 0;
  for (const s of pool) total += s.weight;
  let acc = rng * total;
  for (const s of pool) {
    acc -= s.weight;
    if (acc <= 0) return s.key;
  }
  return pool[pool.length - 1].key;
};

export const seededRandom = (seed: number): number => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};
export const getHexSeed = (q: number, r: number, worldSeed: number): number =>
  (q * 73856093) ^ (r * 19349663) ^ worldSeed;

export type GrassPatch = 'NONE' | 'DRY' | 'DENSE' | 'FLOWERY';
export const grassChunkPatch = (q: number, r: number, worldSeed: number): GrassPatch => {
  const chunkQ = Math.floor(q / GRASS_CHUNK_SIZE);
  const chunkR = Math.floor(r / GRASS_CHUNK_SIZE);
  const seed = (chunkQ * 73856093) ^ (chunkR * 19349663) ^ (worldSeed + 7);
  const rng = seededRandom(seed);
  if (rng < 0.50) return 'NONE';
  if (rng < 0.67) return 'DRY';
  if (rng < 0.84) return 'DENSE';
  return 'FLOWERY';
};
