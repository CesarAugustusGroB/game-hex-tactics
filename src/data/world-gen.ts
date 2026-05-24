import raw from './world-gen.json';

export interface WorldGenConfig {
  bucket: {
    deepSeaMult: number;
    sandOffset: number;
    forestMult: number;
    hillMult: number;
    mountainOffset: number;
  };
  falloff: { intercept: number; exponent: number };
  strategicResolution: number;
  diveZoom: number;
  gridRadius: number;
  defaultGenSettings: { waterLevel: number; mountainLevel: number };
}

export const WORLD_GEN: WorldGenConfig = raw;

export const STRATEGIC_RESOLUTION = WORLD_GEN.strategicResolution;
export const DIVE_ZOOM            = WORLD_GEN.diveZoom;
export const GRID_RADIUS          = WORLD_GEN.gridRadius;
export const DEFAULT_GEN_SETTINGS = WORLD_GEN.defaultGenSettings;
