import raw from './world-gen.json';

export type ShapePrimitive = 'radial' | 'linear' | 'flat' | 'invertedRadial';

export type MapTypeId =
  | 'island' | 'coastline' | 'archipelago' | 'plains' | 'inlandSea'
  | 'highlands' | 'forest' | 'hills';

export interface BucketConfig {
  deepSeaMult: number;
  sandOffset: number;
  forestMult: number;
  hillMult: number;
  mountainOffset: number;
}

export interface MapTypeConfig {
  shape: ShapePrimitive;
  waterLevel: number;
  mountainLevel: number;
  bucket?: Partial<BucketConfig>; // per-archetype overrides of the global thresholds
}

export interface WorldGenConfig {
  bucket: BucketConfig;
  falloff: { intercept: number; exponent: number };
  strategicResolution: number;
  diveZoom: number;
  gridRadius: number;
  mapTypes: Record<MapTypeId, MapTypeConfig>;
  defaultMapType: MapTypeId;
}

export const WORLD_GEN: WorldGenConfig = raw as WorldGenConfig;

export const STRATEGIC_RESOLUTION = WORLD_GEN.strategicResolution;
export const DIVE_ZOOM            = WORLD_GEN.diveZoom;
export const GRID_RADIUS          = WORLD_GEN.gridRadius;

export const MAP_TYPES = WORLD_GEN.mapTypes;
export const MAP_TYPE_IDS = Object.keys(WORLD_GEN.mapTypes) as MapTypeId[];
export const DEFAULT_MAP_TYPE = WORLD_GEN.defaultMapType;
