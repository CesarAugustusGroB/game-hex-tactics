import raw from './terrain.json';

/** All fields a terrain entry may carry. Visual fields (`color`, `label`, `height`,
 *  `walkable`) are required; mechanical fields are optional and fall through to
 *  `DEFAULT_TERRAIN_MODS` when resolved by `getTerrainMods` in src/battle/terrain.ts. */
export interface TerrainDef {
  color: number;
  label: string;
  height: number;
  walkable: boolean;
  // Mechanical fields duplicate TerrainMods (src/battle/terrain.ts) intentionally —
  // extending TerrainMods would force data/ to import battle/, but battle/ already
  // imports data/ (via the terrain-mods wrapper), creating a cycle.
  defenseMult?: number;
  moveCost?: number;
  attritionPerTick?: number;
  visionRadius?: number;
}

const hexStr = (c: string): number => parseInt(c.slice(1), 16);

type RawTerrainEntry = {
  color: string;
  label: string;
  height: number;
  walkable: boolean;
  defenseMult?: number;
  moveCost?: number;
  attritionPerTick?: number;
  visionRadius?: number;
};

const rawTyped = raw as Record<string, RawTerrainEntry>;

export const TERRAINS: Record<string, TerrainDef> = Object.fromEntries(
  Object.entries(rawTyped).map(([k, v]) => [k, {
    color: hexStr(v.color),
    label: v.label,
    height: v.height,
    walkable: v.walkable,
    ...(v.defenseMult      !== undefined ? { defenseMult:      v.defenseMult } : {}),
    ...(v.moveCost         !== undefined ? { moveCost:         v.moveCost } : {}),
    ...(v.attritionPerTick !== undefined ? { attritionPerTick: v.attritionPerTick } : {}),
    ...(v.visionRadius     !== undefined ? { visionRadius:     v.visionRadius } : {}),
  }]),
);
