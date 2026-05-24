import raw from './terrain.json';
import type { TerrainMods } from '../battle/terrain';

type RawTerrainEntry = {
  defenseMult?: number;
  moveCost?: number;
  attritionPerTick?: number;
  visionRadius?: number;
};

const rawTyped = raw as Record<string, RawTerrainEntry>;

// Only walkable terrains with non-default mods are listed in the resolved table —
// callers go through getTerrainMods() which falls back to DEFAULT_TERRAIN_MODS for
// keys not present here. Filter out entries with no mechanical fields.
export const TERRAIN_MODS: Record<string, Partial<TerrainMods>> = Object.fromEntries(
  Object.entries(rawTyped)
    .filter(([, v]) =>
      v.defenseMult !== undefined || v.moveCost !== undefined ||
      v.attritionPerTick !== undefined || v.visionRadius !== undefined,
    )
    .map(([k, v]) => [k, {
      ...(v.defenseMult      !== undefined ? { defenseMult:      v.defenseMult } : {}),
      ...(v.moveCost         !== undefined ? { moveCost:         v.moveCost } : {}),
      ...(v.attritionPerTick !== undefined ? { attritionPerTick: v.attritionPerTick } : {}),
      ...(v.visionRadius     !== undefined ? { visionRadius:     v.visionRadius } : {}),
    }]),
);
