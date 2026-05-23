import { TERRAIN_MODS } from '../battle/terrain';

export interface TerrainDef {
  color: number;
  label: string;
  height: number;
  /** Whether units can stand on this terrain. Used by the rigid-block march for validation. */
  walkable: boolean;
  /** Defense rating; HIGHER = better cover. Damage divides by this. Default 1.0. */
  defenseMult?: number;
  /** Extra ticks of movement cooldown on entry. Default 0. */
  moveCost?: number;
  /** HP drained per tick while standing on this hex. Default 0. */
  attritionPerTick?: number;
  /** Sight radius (hexes) for a unit on this terrain. Default 4. */
  visionRadius?: number;
}

// Mechanical fields (defenseMult, moveCost, attritionPerTick, visionRadius) live in
// `src/battle/terrain.ts` so the headless sim harness can import them without React/PIXI.
export const TERRAINS: Record<string, TerrainDef> = {
  DEEP_SEA: { color: 0x1a2a3a, label: 'Deep Water', height: 2, walkable: false },
  SEA: { color: 0x2a3a4a, label: 'Shallows', height: 5, walkable: false },
  SAND: { color: 0xbdaa8a, label: 'Shoreline', height: 8, walkable: true, ...TERRAIN_MODS.SAND },
  GRASSLAND: { color: 0x5a7a4a, label: 'Lowlands', height: 12, walkable: true, ...TERRAIN_MODS.GRASSLAND },
  FOREST: { color: 0x3a5a3a, label: 'Thicket', height: 18, walkable: true, ...TERRAIN_MODS.FOREST },
  HILL: { color: 0x6b5d44, label: 'Ridgeline', height: 35, walkable: true, ...TERRAIN_MODS.HILL },
  ROCKY: { color: 0x4a4a4a, label: 'Plateau', height: 55, walkable: true, ...TERRAIN_MODS.ROCKY },
  MOUNTAIN: { color: 0x6a6a72, label: 'Summit', height: 85, walkable: true, ...TERRAIN_MODS.MOUNTAIN },
  SNOW: { color: 0xf0f0f0, label: 'Glacier', height: 110, walkable: true, ...TERRAIN_MODS.SNOW },
  RIVER: { color: 0x3a8fb7, label: 'Waterway', height: 10, walkable: true, ...TERRAIN_MODS.RIVER },
};
