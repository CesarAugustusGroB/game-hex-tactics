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
 * Mechanical values live in src/data/terrain.json (projected by terrain-mods.ts) so the
 * sim layer doesn't import the rendering layer. The canvas side reads the same JSON via
 * src/data/terrain.ts, which also carries visual fields (color, label, height, walkable).
 */
import { HEIGHT_BONUS_PER_UNIT, HEIGHT_BONUS_CAP } from '../data/combat';
import { TERRAIN_MODS } from '../data/terrain-mods';

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

// Per-terrain mod overrides sourced from src/data/terrain.json (via terrain-mods.ts).
// Balance intent: MOUNTAIN harshest (best cover/vision, brutal move cost, heavy bleed);
// ROCKY strong cover/slow bleed; HILL strong cover/great vision/mild attrition;
// FOREST strong cover/low sight/slow; RIVER bad cover/slow/high attrition;
// SAND mildly bad cover/slow/low vision; GRASSLAND neutral (falls to defaults).
export { TERRAIN_MODS } from '../data/terrain-mods';

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

/** +1% damage per height-unit of elevation advantage, capped at +50%. Values in src/data/combat.json. */
export { HEIGHT_BONUS_PER_UNIT, HEIGHT_BONUS_CAP };

/**
 * Downhill attack bonus as a multiplier component. `heightBonus = 0.23` means +23%
 * damage; the damage formula uses `base * (1 + heightBonus) / defense`. Uphill or
 * level attacks return 0 (no bonus, no penalty).
 */
export const heightDamageBonus = (hAtt: number, hDef: number): number => {
  const raw = Math.max(0, hAtt - hDef) * HEIGHT_BONUS_PER_UNIT;
  return Math.min(raw, HEIGHT_BONUS_CAP);
};
