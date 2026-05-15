/**
 * Terrain modifier math for the battle simulator. Pure: no I/O, no engine imports
 * (in particular no React/PIXI), so the headless harness can pull it without dragging
 * in the rendering stack.
 *
 * Two exports consumed by the sim hot loop:
 *   - `getTerrainMods` resolves a terrain key to its mechanical fields, with neutral
 *     defaults for unknown / undefined / off-map terrain.
 *   - `heightDamageBonus` is the downhill attack bonus, capped to keep ridiculous
 *     elevation deltas from one-shotting defenders.
 *
 * The values live here (not in `TERRAINS` in `GameCanvas.tsx`) so the sim layer doesn't
 * import the rendering layer. `GameCanvas.tsx` extends its own `TerrainDef` with the
 * same optional fields for in-engine tooling/HUD; the sim reads through this module.
 */

/** Mechanical fields a terrain may carry. All optional in the source table; missing
 *  fields fall through to `DEFAULT_TERRAIN_MODS` when resolved by `getTerrainMods`. */
export interface TerrainMods {
  /** Defense rating; HIGHER = better cover. Damage divides by this. Default 1.0. */
  defenseMult: number;
  /** Extra ticks of movement cooldown on entry. Default 0. */
  moveCost: number;
  /** HP drained per tick while standing on this hex. Default 0. */
  attritionPerTick: number;
  /** Sight radius (hexes) for a unit on this terrain. Default 4. Data-only this pass. */
  visionRadius: number;
}

export const DEFAULT_TERRAIN_MODS: TerrainMods = {
  defenseMult: 1.0,
  moveCost: 0,
  attritionPerTick: 0,
  visionRadius: 4,
};

/**
 * Per-terrain mod overrides. Only walkable terrains with non-default values are listed —
 * any terrain key not present here resolves to `DEFAULT_TERRAIN_MODS` via `getTerrainMods`.
 * Balance intent (per plan):
 *   - MOUNTAIN: harshest walkable terrain — best cover and vision, brutal movement cost, heavy bleed.
 *   - ROCKY:    strong cover; punishes movement; slowly bleeds.
 *   - HILL:     strong cover; great vision; mild attrition.
 *   - FOREST:   strong cover; low sight; slow.
 *   - RIVER:    bad cover; slow; high attrition.
 *   - SAND:     mildly bad cover; slow; low vision; no bleed.
 *   - GRASSLAND: neutral baseline (no entry — falls through to defaults).
 */
export const TERRAIN_MODS: Record<string, Partial<TerrainMods>> = {
  SAND:      { defenseMult: 0.95, moveCost: 1, attritionPerTick: 0.00, visionRadius: 3 },
  GRASSLAND: { defenseMult: 1.00, moveCost: 0, attritionPerTick: 0.00, visionRadius: 4 },
  FOREST:    { defenseMult: 1.30, moveCost: 1, attritionPerTick: 0.00, visionRadius: 2 },
  HILL:      { defenseMult: 1.25, moveCost: 1, attritionPerTick: 0.05, visionRadius: 6 },
  ROCKY:     { defenseMult: 1.40, moveCost: 2, attritionPerTick: 0.20, visionRadius: 5 },
  MOUNTAIN:  { defenseMult: 1.50, moveCost: 3, attritionPerTick: 0.30, visionRadius: 7 },
  RIVER:     { defenseMult: 0.80, moveCost: 2, attritionPerTick: 0.25, visionRadius: 3 },
};

/**
 * Resolve a terrain key to its full mod set. Unknown / undefined types and missing
 * fields fall through to `DEFAULT_TERRAIN_MODS`, so callers don't need to guard.
 */
export const getTerrainMods = (type: string | undefined): TerrainMods => {
  if (!type) return DEFAULT_TERRAIN_MODS;
  const partial = TERRAIN_MODS[type];
  if (!partial) return DEFAULT_TERRAIN_MODS;
  return {
    defenseMult: partial.defenseMult ?? DEFAULT_TERRAIN_MODS.defenseMult,
    moveCost: partial.moveCost ?? DEFAULT_TERRAIN_MODS.moveCost,
    attritionPerTick: partial.attritionPerTick ?? DEFAULT_TERRAIN_MODS.attritionPerTick,
    visionRadius: partial.visionRadius ?? DEFAULT_TERRAIN_MODS.visionRadius,
  };
};

/** +1% damage per height-unit of elevation advantage, capped at +50%. */
export const HEIGHT_BONUS_PER_UNIT = 0.01;
export const HEIGHT_BONUS_CAP = 0.50;

/**
 * Downhill attack bonus as a multiplier component. `heightBonus = 0.23` means +23%
 * damage; the damage formula uses `base * (1 + heightBonus) / defense`. Uphill or
 * level attacks return 0 (no bonus, no penalty).
 */
export const heightDamageBonus = (hAtt: number, hDef: number): number => {
  const raw = Math.max(0, hAtt - hDef) * HEIGHT_BONUS_PER_UNIT;
  return Math.min(raw, HEIGHT_BONUS_CAP);
};
