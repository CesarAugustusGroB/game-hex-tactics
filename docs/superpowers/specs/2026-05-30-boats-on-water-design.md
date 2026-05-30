# Boats on water — design

**Date:** 2026-05-30
**Status:** approved

## Summary

A unit standing on open water (`SEA` / `DEEP_SEA`) is a **boat**: it renders as a boat
(placeholder art for now) and uses a single uniform "boat" stat block regardless of its real
unit type. On land it is its normal unit again. Boat-ness is **derived from the unit's hex** —
no stored state, no transition event; the unit's `unitType` never changes, so reverting on
landing is automatic.

## Mechanic

- **Water = `SEA` + `DEEP_SEA`.** Both become `walkable: true`. `RIVER` is unchanged (still
  land-with-attrition). Movement is directional (no A*), so units only enter the sea if ordered
  toward it.
- **Naval terrain mods** added to `SEA`/`DEEP_SEA` (they have none today):
  `defenseMult 0.85`, `moveCost 1`, `attritionPerTick 0`, `visionRadius 5`.
- **Uniform boat profile** (`BOAT` in `units.json`): `maxHp 60`, `marchSpeed 2`.
  While afloat a unit: cannot charge (no lance impact), cannot throw missiles (skirmishers
  row instead), navigates at the boat `marchSpeed`. Per-tick melee damage is already global
  (`tickDamage`), so it is uniform automatically.
- **HP across transition:** current HP carries; on a unit's hex becoming water its HP is
  clamped to the boat `maxHp` (60). Returning to land keeps that HP (≤ 60 ≤ any unit max, so
  no upward clamp). Net: a round trip through water caps a unit at 60 HP — intentional
  (boats are fragile and uniform).

## Implementation touch points

- `src/data/terrain.json` — `SEA`/`DEEP_SEA`: `walkable: true` + the four mechanical fields.
- `src/data/units.json` + `units.ts` — new `BOAT` profile (`maxHp`, `marchSpeed`); wrapper
  exports `BOAT_STATS`.
- `src/battle/terrain.ts` — `isWaterType(type)` predicate (sim-safe, single source).
- `src/battle/simulate.ts` — effective-stat resolution when a unit's hex is water:
  per-unit march speed uses boat speed; charge impact skipped for afloat units; skirmisher
  missile branch skipped for afloat units; end-of-tick HP clamp to boat max for afloat units.
- `src/canvas/render/drawUnits.ts` — afloat units render the boat placeholder (distinct tint
  / shape) instead of the soldier sprite; reverts on land. Re-exports `isWaterType` usage.

## Out of scope (YAGNI)

- Real boat art (placeholder only; logic ready to plug the asset).
- Embark/disembark orders, naval-only combat rules, transport capacity, RIVER boats.

## Test plan

New `scripts/test-boats.ts` (tsx harness, asserts like the others):
- An afloat unit's effective maxHp is the boat value; HP clamps to it on water.
- An afloat skirmisher throws no missiles (no projectile emitted).
- An afloat unit deals no charge impact.
- A unit on land keeps its real stats (control).
- `sim-formations.ts` baseline diff: land-only scenarios unchanged.
