import raw from './details.json';
import type {
  DetailCategory, DetailLayerConfig, TerrainDetailRules, WeightedSprite,
} from '../canvas/detail-rules';

const hexStr = (c: string): number => parseInt(c.slice(1), 16);

interface RawCatalogEntry { count: number; path: string }
interface RawSpritePoolEntry { category: string; weight: number; firstN?: number }
interface RawLayer {
  density: number;
  maxPerHex: number;
  scaleRange: [number, number];
  alphaRange: [number, number];
  spritePool: RawSpritePoolEntry[];
  centered?: boolean;
}
interface RawRule {
  embedded?: RawLayer;
  small?: RawLayer;
  landmark?: RawLayer;
  categoryStyle: Partial<Record<string, { tint: string }>>;
}
interface RawData {
  spriteCatalog: Record<string, RawCatalogEntry>;
  grassChunkSize: number;
  rules: Record<string, RawRule>;
}

const data = raw as unknown as RawData;

export const GRASS_CHUNK_SIZE = data.grassChunkSize;

const numKeys = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}_${String(i + 1).padStart(2, '0')}`);

// Sprite-key prefix → category. Catalog keys ARE the prefixes; the category union
// in DetailCategory uses shorter aliases for the composite forest/river/sea sprites
// while grass/flower/rock map to themselves.
const CATEGORY_BY_PREFIX: Record<string, DetailCategory> = {
  grass: 'grass', flower: 'flower', rock: 'rock',
  tiny_pine_cluster: 'pine',
  low_shrub_cluster: 'shrub',
  dark_leaf_patch: 'leafPatch',
  dark_undergrowth: 'undergrowth',
  moss_clump: 'moss',
  fallen_needles: 'needles',
  cyan_ripple: 'ripple',
  shimmer_glint: 'shimmer',
  current_mark: 'current',
  foam_fleck: 'foam',
  depth_wisp: 'depthWisp',
  sea_shimmer: 'seaShimmer',
};

// Build flat key list for the catalog (e.g. grass_01...grass_04 + flower_01...sea_shimmer_08).
export const ALL_DETAIL_KEYS: string[] = Object.entries(data.spriteCatalog)
  .flatMap(([prefix, { count }]) => numKeys(prefix, count));

// prefix → asset folder lookup, built once.
const PATH_BY_PREFIX: Record<string, string> = Object.fromEntries(
  Object.entries(data.spriteCatalog).map(([prefix, { path }]) => [prefix, path]),
);

// The prefix is everything before the final _NN suffix. The original implementation
// did chained startsWith() checks; this becomes O(1) lookup via PATH_BY_PREFIX /
// CATEGORY_BY_PREFIX after stripping the suffix.
const prefixOf = (key: string): string => key.replace(/_\d{2}$/, '');

export const detailAssetPath = (key: string): string => {
  const prefix = prefixOf(key);
  const path = PATH_BY_PREFIX[prefix] ?? '/details/rock';
  return `${path}/${key}.png`;
};

export const spriteCategory = (key: string): DetailCategory => {
  const prefix = prefixOf(key);
  return CATEGORY_BY_PREFIX[prefix] ?? 'grass';
};

const expandLayer = (raw: RawLayer): DetailLayerConfig => ({
  density: raw.density,
  maxPerHex: raw.maxPerHex,
  scaleRange: raw.scaleRange,
  alphaRange: raw.alphaRange,
  centered: raw.centered,
  sprites: raw.spritePool.flatMap<WeightedSprite>(({ category, weight, firstN }) => {
    const entry = data.spriteCatalog[category];
    if (!entry) throw new Error(`details.json: unknown sprite category "${category}"`);
    const count = firstN ?? entry.count;
    return numKeys(category, count).map(key => ({ key, weight }));
  }),
});

const expandRule = (raw: RawRule): TerrainDetailRules => ({
  embedded: raw.embedded ? expandLayer(raw.embedded) : undefined,
  small:    raw.small    ? expandLayer(raw.small)    : undefined,
  landmark: raw.landmark ? expandLayer(raw.landmark) : undefined,
  categoryStyle: Object.fromEntries(
    Object.entries(raw.categoryStyle).map(([cat, style]) => [cat, { tint: hexStr(style!.tint) }]),
  ) as TerrainDetailRules['categoryStyle'],
});

export const DETAIL_RULES: Record<string, TerrainDetailRules> = Object.fromEntries(
  Object.entries(data.rules).map(([terrain, rule]) => [terrain, expandRule(rule)]),
);
