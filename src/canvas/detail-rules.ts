// Cutout PNGs sit in public/details/{grass,flower,rock,forest,river,sea}/.
// Old higher-volume catalogue lives in public/details/_archive for reference.
const numKeys = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}_${String(i + 1).padStart(2, '0')}`);
const GRASS_KEYS = numKeys('grass', 4);
const FLOWER_KEYS = numKeys('flower', 4);
const ROCK_KEYS = numKeys('rock', 4);
const TINY_PINE_CLUSTER_KEYS = numKeys('tiny_pine_cluster', 10);
const LOW_SHRUB_CLUSTER_KEYS = numKeys('low_shrub_cluster', 10);
const DARK_LEAF_PATCH_KEYS = numKeys('dark_leaf_patch', 10);
const DARK_UNDERGROWTH_KEYS = numKeys('dark_undergrowth', 10);
const MOSS_CLUMP_KEYS = numKeys('moss_clump', 10);
const FALLEN_NEEDLES_KEYS = numKeys('fallen_needles', 10);
const CYAN_RIPPLE_KEYS = numKeys('cyan_ripple', 10);
const SHIMMER_GLINT_KEYS = numKeys('shimmer_glint', 10);
const CURRENT_MARK_KEYS = numKeys('current_mark', 10);
const FOAM_FLECK_KEYS = numKeys('foam_fleck', 10);
const DEPTH_WISP_KEYS = numKeys('depth_wisp', 10);
const SEA_SHIMMER_KEYS = numKeys('sea_shimmer', 8);
const FOREST_DETAIL_KEYS = [
  ...TINY_PINE_CLUSTER_KEYS,
  ...LOW_SHRUB_CLUSTER_KEYS,
  ...DARK_LEAF_PATCH_KEYS,
  ...DARK_UNDERGROWTH_KEYS,
  ...MOSS_CLUMP_KEYS,
  ...FALLEN_NEEDLES_KEYS,
];
const RIVER_DETAIL_KEYS = [
  ...CYAN_RIPPLE_KEYS,
  ...SHIMMER_GLINT_KEYS,
  ...CURRENT_MARK_KEYS,
  ...FOAM_FLECK_KEYS,
  ...DEPTH_WISP_KEYS,
];
const SEA_DETAIL_KEYS = [
  ...SEA_SHIMMER_KEYS,
];
export const ALL_DETAIL_KEYS = [
  ...GRASS_KEYS,
  ...FLOWER_KEYS,
  ...ROCK_KEYS,
  ...FOREST_DETAIL_KEYS,
  ...RIVER_DETAIL_KEYS,
  ...SEA_DETAIL_KEYS,
];
export const detailAssetPath = (key: string): string => {
  if (key.startsWith('grass_')) return `/details/grass/${key}.png`;
  if (key.startsWith('flower_')) return `/details/flower/${key}.png`;
  if (FOREST_DETAIL_KEYS.includes(key)) return `/details/forest/${key}.png`;
  if (RIVER_DETAIL_KEYS.includes(key)) return `/details/river/${key}.png`;
  if (SEA_DETAIL_KEYS.includes(key)) return `/details/sea/${key}.png`;
  return `/details/rock/${key}.png`;
};

export interface WeightedSprite { key: string; weight: number }

export interface DetailLayerConfig {
  /** Base spawn chance per hex BEFORE the density-noise multiplier is applied. */
  density: number;
  /** Max sprite instances per spawn-eligible hex. */
  maxPerHex: number;
  /** Source-PNG scale range. The sprite's `scale.set` is sampled from this. */
  scaleRange: [number, number];
  /** Sprite alpha range. */
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

// Per-terrain scatter rules. New asset set (4 grass + 4 flower + 4 rock variants) used
// at full opacity. Sizes deliberately tiny across all three layers — the user asked for
// "muy pequeños y opacidad normal", so we lean on shrinking the sprite footprint rather
// than fading them. Tints set to white so the artwork's own colours come through.
export const DETAIL_RULES: Record<string, TerrainDetailRules> = {
  GRASSLAND: {
    embedded: {
      density: 0.55,
      maxPerHex: 2,
      scaleRange: [0.04, 0.07],
      alphaRange: [1.0, 1.0],
      sprites: [
        ...GRASS_KEYS.map(k => ({ key: k, weight: 5 })),
        ...FLOWER_KEYS.map(k => ({ key: k, weight: 1 })),
      ],
    },
    small: {
      density: 0.18,
      maxPerHex: 1,
      scaleRange: [0.07, 0.11],
      alphaRange: [1.0, 1.0],
      sprites: [
        ...GRASS_KEYS.map(k => ({ key: k, weight: 6 })),
        ...FLOWER_KEYS.map(k => ({ key: k, weight: 2 })),
        ...ROCK_KEYS.slice(0, 2).map(k => ({ key: k, weight: 1 })),
      ],
    },
    landmark: {
      density: 0.03,
      maxPerHex: 1,
      scaleRange: [0.10, 0.15],
      alphaRange: [1.0, 1.0],
      sprites: ROCK_KEYS.map(k => ({ key: k, weight: 1 })),
    },
    categoryStyle: {
      grass:  { tint: 0xFFFFFF },
      flower: { tint: 0xFFFFFF },
      rock:   { tint: 0xFFFFFF },
    },
  },
  HILL: {
    small: {
      density: 0.07,
      maxPerHex: 1,
      scaleRange: [0.035, 0.075],
      alphaRange: [0.22, 0.45],
      sprites: [
        ...GRASS_KEYS.map(k => ({ key: k, weight: 50 })),
        ...ROCK_KEYS.map(k => ({ key: k, weight: 18 })),
        ...FLOWER_KEYS.map(k => ({ key: k, weight: 2 })),
      ],
    },
    categoryStyle: {
      grass:  { tint: 0xFFFFFF },
      flower: { tint: 0xFFFFFF },
      rock:   { tint: 0xFFFFFF },
    },
  },
  FOREST: {
    small: {
      density: 0.22,
      maxPerHex: 1,
      scaleRange: [0.07, 0.16],
      alphaRange: [0.40, 0.70],
      sprites: [
        ...TINY_PINE_CLUSTER_KEYS.map(k => ({ key: k, weight: 55 })),
        ...LOW_SHRUB_CLUSTER_KEYS.map(k => ({ key: k, weight: 20 })),
        ...DARK_LEAF_PATCH_KEYS.map(k => ({ key: k, weight: 8 })),
        ...DARK_UNDERGROWTH_KEYS.map(k => ({ key: k, weight: 5 })),
        ...MOSS_CLUMP_KEYS.map(k => ({ key: k, weight: 8 })),
        ...FALLEN_NEEDLES_KEYS.map(k => ({ key: k, weight: 4 })),
      ],
    },
    categoryStyle: {
      pine:        { tint: 0xFFFFFF },
      shrub:       { tint: 0xFFFFFF },
      leafPatch:   { tint: 0xFFFFFF },
      undergrowth: { tint: 0xFFFFFF },
      moss:        { tint: 0xFFFFFF },
      needles:     { tint: 0xFFFFFF },
    },
  },
  RIVER: {
    small: {
      density: 0.12,
      maxPerHex: 1,
      scaleRange: [0.06, 0.14],
      alphaRange: [0.45, 0.85],
      sprites: [
        ...CYAN_RIPPLE_KEYS.map(k => ({ key: k, weight: 34 })),
        ...CURRENT_MARK_KEYS.map(k => ({ key: k, weight: 26 })),
        ...SHIMMER_GLINT_KEYS.map(k => ({ key: k, weight: 18 })),
        ...DEPTH_WISP_KEYS.map(k => ({ key: k, weight: 14 })),
        ...FOAM_FLECK_KEYS.map(k => ({ key: k, weight: 8 })),
      ],
    },
    categoryStyle: {
      ripple:    { tint: 0xFFFFFF },
      shimmer:   { tint: 0xFFFFFF },
      current:   { tint: 0xFFFFFF },
      foam:      { tint: 0xFFFFFF },
      depthWisp: { tint: 0xFFFFFF },
    },
  },
  SEA: {
    small: {
      density: 0.025,
      maxPerHex: 1,
      scaleRange: [0.07, 0.12],
      alphaRange: [0.18, 0.36],
      sprites: SEA_SHIMMER_KEYS.map(k => ({ key: k, weight: 1 })),
    },
    categoryStyle: {
      seaShimmer: { tint: 0xFFFFFF },
    },
  },
};

export const spriteCategory = (key: string): DetailCategory => {
  if (key.startsWith('flower_')) return 'flower';
  if (key.startsWith('rock_')) return 'rock';
  if (key.startsWith('tiny_pine_cluster_')) return 'pine';
  if (key.startsWith('low_shrub_cluster_')) return 'shrub';
  if (key.startsWith('dark_leaf_patch_')) return 'leafPatch';
  if (key.startsWith('dark_undergrowth_')) return 'undergrowth';
  if (key.startsWith('moss_clump_')) return 'moss';
  if (key.startsWith('fallen_needles_')) return 'needles';
  if (key.startsWith('cyan_ripple_')) return 'ripple';
  if (key.startsWith('shimmer_glint_')) return 'shimmer';
  if (key.startsWith('current_mark_')) return 'current';
  if (key.startsWith('foam_fleck_')) return 'foam';
  if (key.startsWith('depth_wisp_')) return 'depthWisp';
  if (key.startsWith('sea_shimmer_')) return 'seaShimmer';
  return 'grass';
};

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

export const GRASS_CHUNK_SIZE = 6;
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
