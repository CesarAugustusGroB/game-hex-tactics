# JSON Config Extraction — Design

**Date:** 2026-05-24
**Goal:** Extract balance- and content-tunable values from TS source into JSON files under `src/data/`. Establish a single home for "things a designer would tweak" without coupling rendering to balance to world-generation.

## Scope

Approach **B** (per brainstorm): move named tables and primitives, *and* extract+name the magic numbers embedded in world-generation formulas. Pure math constants (hash multipliers, noise mixing weights) and structural geometry (tactical playfield extents) stay inline.

Loading: **static `import` only** — no fetch, no runtime validation, no HMR-of-state. Vite bundles JSON; TS resolves types via `resolveJsonModule`.

Granularity: **per-domain**, 6 JSON files in `src/data/`.

## File layout

```
src/data/
  units.json        units.ts
  terrain.json      terrain.ts          ← canvas-side wrapper (parses hex colors, full TerrainDef)
                    terrain-mods.ts     ← sim-side wrapper (TerrainMods only, no PIXI dependency)
  world-gen.json    world-gen.ts
  details.json      details.ts
  combat.json       combat.ts
  game.json         game.ts
```

`terrain.json` is the single source; two `.ts` wrappers project different views so the sim layer still doesn't import canvas. See *Per-file contents → `terrain.json`* for details.

Each `.json` is the raw data. Each `.ts`:
1. `import raw from './x.json'`
2. Declares the `interface XConfig` the data conforms to.
3. Exports a typed constant (`export const X: XConfig = raw`).
4. Optionally derives **legacy-shape exports** so existing consumers keep working without simultaneous renames.

Consumers import from the `.ts`, never from the `.json` directly. The wrapper is the single point of:
- Type validation (a JSON typo fails the build at the wrapper line).
- Boot-time transformation (hex-string → number, compact sprite-pool → expanded, etc.).
- Future migration (e.g. if we ever swap to async fetch, only the wrappers change).

## Per-file contents

### `units.json` — per-unit-type tunables

```jsonc
{
  "infantry":   { "maxHp": 100, "marchSpeed": 2, "chargeSpeed": 4, "chargeImpactDamage": 10 },
  "cavalry":    { "maxHp":  60, "marchSpeed": 4, "chargeSpeed": 6, "chargeImpactDamage": 20 },
  "skirmisher": { "maxHp":  40, "marchSpeed": 3, "chargeSpeed": 4, "chargeImpactDamage":  5,
                  "missileRange": 3, "missileDamage": 5, "kiteThreshold": 2 }
}
```

Replaces (in `src/battle/simulate.ts`):
- `MAX_HP_BY_TYPE`
- `MARCH_HEXES_PER_TICK`
- `CHARGE_HEXES_PER_TICK`
- `CHARGE_IMPACT_DAMAGE_BY_TYPE`
- `SKIRMISHER_MISSILE_RANGE`, `SKIRMISHER_MISSILE_DAMAGE`, `SKIRMISHER_KITE_THRESHOLD`

Skirmisher-only fields (`missileRange`, `missileDamage`, `kiteThreshold`) are optional in the interface.

### `terrain.json` — visual defs + mechanical mods consolidated

```jsonc
{
  "DEEP_SEA":  { "color": "#1a2a3a", "label": "Deep Water", "height":   2, "walkable": false },
  "SEA":       { "color": "#2a3a4a", "label": "Shallows",   "height":   5, "walkable": false },
  "SAND":      { "color": "#bdaa8a", "label": "Shoreline",  "height":   8, "walkable": true,
                 "defenseMult": 0.95, "moveCost": 1, "attritionPerTick": 0.00, "visionRadius": 3 },
  "GRASSLAND": { "color": "#5a7a4a", "label": "Lowlands",   "height":  12, "walkable": true,
                 "defenseMult": 1.00, "moveCost": 0, "attritionPerTick": 0.00, "visionRadius": 4 },
  "FOREST":    { "color": "#3a5a3a", "label": "Thicket",    "height":  18, "walkable": true,
                 "defenseMult": 1.30, "moveCost": 1, "attritionPerTick": 0.00, "visionRadius": 2 },
  "HILL":      { "color": "#6b5d44", "label": "Ridgeline",  "height":  35, "walkable": true,
                 "defenseMult": 1.25, "moveCost": 1, "attritionPerTick": 0.05, "visionRadius": 6 },
  "ROCKY":     { "color": "#4a4a4a", "label": "Plateau",    "height":  55, "walkable": true,
                 "defenseMult": 1.40, "moveCost": 2, "attritionPerTick": 0.20, "visionRadius": 5 },
  "MOUNTAIN":  { "color": "#6a6a72", "label": "Summit",     "height":  85, "walkable": true,
                 "defenseMult": 1.50, "moveCost": 3, "attritionPerTick": 0.30, "visionRadius": 7 },
  "SNOW":      { "color": "#f0f0f0", "label": "Glacier",    "height": 110, "walkable": true,
                 "defenseMult": 1.20, "moveCost": 4, "attritionPerTick": 0.60, "visionRadius": 5 },
  "RIVER":     { "color": "#3a8fb7", "label": "Waterway",   "height":  10, "walkable": true,
                 "defenseMult": 0.80, "moveCost": 2, "attritionPerTick": 0.25, "visionRadius": 3 }
}
```

Consolidates `TERRAINS` (`src/canvas/terrain-defs.ts`) and `TERRAIN_MODS` (`src/battle/terrain.ts`) into one source of truth. **Two wrappers** preserve the existing layered architecture:

- `src/data/terrain.ts` — canvas-friendly view, parses `"#rrggbb"` strings to PIXI-ready `number`. Used by render layer.
- `src/data/terrain-mods.ts` (or kept at `src/battle/terrain.ts`) — sim-only view, exposes `TERRAIN_MODS: Record<string, Partial<TerrainMods>>` and `getTerrainMods(type)`. **Does not import from canvas-side wrapper** — reads JSON directly, ignoring the visual fields. The "sim doesn't import render" rule stays intact.

Defaults (`defenseMult: 1.0, moveCost: 0, attritionPerTick: 0, visionRadius: 4`) remain the responsibility of `getTerrainMods()`.

### `world-gen.json` — generation thresholds and falloff (Approach B core)

```jsonc
{
  "bucket": {
    "deepSeaMult":    0.70,
    "sandOffset":     0.03,
    "forestMult":     0.70,
    "hillMult":       0.90,
    "mountainOffset": 0.10
  },
  "falloff": {
    "intercept": 1.10,
    "exponent":  2.50
  },
  "strategicResolution": 40,
  "diveZoom":            4.5,
  "gridRadius":          35,
  "defaultGenSettings": {
    "waterLevel":    0.35,
    "mountainLevel": 0.75
  }
}
```

Replaces:
- Hardcoded thresholds in `bucket()` (`src/canvas/world-gen.ts`): `w * 0.7` → `w * deepSeaMult`, `w + 0.03` → `w + sandOffset`, `m * 0.7` → `m * forestMult`, `m * 0.9` → `m * hillMult`, `m + 0.1` → `m + mountainOffset`.
- Falloff in `sampleElevation` and `tacticalElevationMult`: `1.1 - Math.pow(d, 2.5)` → `falloff.intercept - Math.pow(d, falloff.exponent)`.
- `STRATEGIC_RESOLUTION`, `DIVE_ZOOM` in `src/canvas/constants.ts`.
- `gridRadius` (currently a literal `35` in `GameCanvas.tsx`) and the default `GenSettings` (`waterLevel`, `mountainLevel`). Exact current default values to be confirmed against `GameCanvas.tsx` at implementation time; the spec values above are placeholders to be verified.

Stays inline (not extracted):
- Hash multipliers in `getHexSeed` (`73856093`, `19349663`).
- `Math.sin(seed) * 10000` in `seededRandom`.
- Noise mixing weights (`0.4 * noise(nx * 2.2, ny * 2.2)` etc.) — these are structural choices of the generator, not balance.
- `TACTICAL_HALF_W/H`, `TACTICAL_BBOX_Q/R` — geometry of the playfield.

### `details.json` — sprite catalog + scatter rules

Sprite catalog declared once; pools reference categories with a single weight (not duplicated per filename):

```jsonc
{
  "spriteCatalog": {
    "grass":              { "count":  4, "path": "/details/grass" },
    "flower":             { "count":  4, "path": "/details/flower" },
    "rock":               { "count":  4, "path": "/details/rock" },
    "tiny_pine_cluster":  { "count": 10, "path": "/details/forest" },
    "low_shrub_cluster":  { "count": 10, "path": "/details/forest" },
    "dark_leaf_patch":    { "count": 10, "path": "/details/forest" },
    "dark_undergrowth":   { "count": 10, "path": "/details/forest" },
    "moss_clump":         { "count": 10, "path": "/details/forest" },
    "fallen_needles":     { "count": 10, "path": "/details/forest" },
    "cyan_ripple":        { "count": 10, "path": "/details/river" },
    "shimmer_glint":      { "count": 10, "path": "/details/river" },
    "current_mark":       { "count": 10, "path": "/details/river" },
    "foam_fleck":         { "count": 10, "path": "/details/river" },
    "depth_wisp":         { "count": 10, "path": "/details/river" },
    "sea_shimmer":        { "count":  8, "path": "/details/sea" }
  },
  "grassChunkSize": 6,
  "rules": {
    "GRASSLAND": {
      "embedded": {
        "density": 0.55, "maxPerHex": 2,
        "scaleRange": [0.04, 0.07], "alphaRange": [1.0, 1.0],
        "spritePool": [
          { "category": "grass",  "weight": 5 },
          { "category": "flower", "weight": 1 }
        ]
      },
      "small": {
        "density": 0.18, "maxPerHex": 1,
        "scaleRange": [0.07, 0.11], "alphaRange": [1.0, 1.0],
        "spritePool": [
          { "category": "grass",  "weight": 6 },
          { "category": "flower", "weight": 2 },
          { "category": "rock",   "weight": 1, "firstN": 2 }
        ]
      },
      "landmark": {
        "density": 0.03, "maxPerHex": 1,
        "scaleRange": [0.10, 0.15], "alphaRange": [1.0, 1.0],
        "spritePool": [{ "category": "rock", "weight": 1 }]
      },
      "categoryStyle": {
        "grass":  { "tint": "#FFFFFF" },
        "flower": { "tint": "#FFFFFF" },
        "rock":   { "tint": "#FFFFFF" }
      }
    }
    // HILL, FOREST, RIVER, SEA omitted here; same shape as today
  }
}
```

**Notes:**
- `spritePool` items use `{ category, weight }`. The `details.ts` wrapper expands each to per-key entries `{ key, weight }` using `numKeys(category, count)`.
- `firstN` (optional) handles the current `ROCK_KEYS.slice(0, 2)` case for GRASSLAND `small`. If absent, expand the full count.
- `spriteCategory(key)` and `detailAssetPath(key)` become table-driven: the wrapper builds `prefix → category` and `prefix → path` lookups from `spriteCatalog`, replacing the chain of `startsWith` checks.
- `ALL_DETAIL_KEYS` derives from the catalog (`flatMap` over categories).

Replaces (in `src/canvas/detail-rules.ts`): `numKeys` call sites, all `*_KEYS` arrays, `ALL_DETAIL_KEYS`, `detailAssetPath`, `spriteCategory`, `DETAIL_RULES`, `GRASS_CHUNK_SIZE`. The `numKeys`, `pickWeighted`, `seededRandom`, `getHexSeed`, and `grassChunkPatch` functions stay (logic, not data).

### `combat.json` — global combat tunables

```jsonc
{
  "tickDamage": 10,
  "charge":  { "durationTicks": 3, "impactRange": 2 },
  "hold":    { "reductionPerTick": 0.05, "reductionCap": 0.40, "autoIdleAfterTicks": 8 },
  "unleash": { "maxEngagers": 3 },
  "height":  { "bonusPerUnit": 0.01, "bonusCap": 0.50 }
}
```

Replaces: `DAMAGE_PER_TICK` (from `constants.ts`), `CHARGE_DURATION_TICKS`, `CHARGE_IMPACT_RANGE`, `HOLD_REDUCTION_PER_TICK`, `HOLD_REDUCTION_CAP`, `HOLD_AUTO_IDLE_AFTER_TICKS`, `UNLEASH_MAX_ENGAGERS` (from `simulate.ts`), `HEIGHT_BONUS_PER_UNIT`, `HEIGHT_BONUS_CAP` (from `terrain.ts`).

`holdReduction()` and `heightDamageBonus()` stay as functions, reading from `COMBAT`.

### `game.json` — everything else that's app-level

```jsonc
{
  "tickMs":            500,
  "lodThreshold":      0.25,
  "dragThresholdPx":   24,
  "deployZoneFrac":    0.28,
  "retreatRefundFrac": 0.80,
  "initialRoster":     { "infantry": 50, "cavalry": 50, "skirmisher": 50 },
  "cohortSize":        4,
  "capture": {
    "ticksToWin": 20,
    "center":     { "q": 0, "r": 0 }
  },
  "teams": {
    "red":  { "tint": "#ef4444" },
    "blue": { "tint": "#3b82f6" }
  },
  "formations": {
    "cycle":  ["line", "wedge", "column", "hex"],
    "labels": {
      "hex":    "⬢ HEX",
      "line":   "─ LINE",
      "wedge":  "△ WDGE",
      "column": "│ COL"
    }
  },
  "headingArrows": {
    "0": "↘", "1": "↗", "2": "↑", "3": "↖", "4": "↙", "5": "↓"
  }
}
```

Replaces (mostly from `src/canvas/constants.ts`): `TICK_MS`, `LOD_THRESHOLD`, `DRAG_THRESHOLD_PX`, the private `DEPLOY_ZONE_FRAC`, `RETREAT_REFUND_FRAC`, `INITIAL_ROSTER`, `COHORT_SIZE`, `CAPTURE_TICKS_TO_WIN`, `CAPTURE_CENTER`, `TEAM_TINTS`, `FORMATION_CYCLE`, `FORMATION_LABELS`, `HEADING_ARROWS`.

The derived helpers stay in TS:
- `makeInitialRosters()` — factory cloning `GAME.initialRoster` per team.
- `captureZoneKeys()`, `CAPTURE_ZONE_HEXES` — computed from `GAME.capture.center` via `HexUtils.getNeighbors`.
- `deployZoneFor(team, gridData)` — pixel-y computation, reads `GAME.deployZoneFrac`.
- `groupOrderKey(team, groupId)` — pure key formatter, no data dependency.

`HEADING_ARROWS` is re-cast from `Record<string, string>` (JSON) to `Record<number, string>` (consumer-facing) inside the wrapper.

## Loading mechanism

### Wrapper template

```ts
// src/data/units.ts
import raw from './units.json';
import type { UnitType } from '../battle/simulate';

export interface UnitConfig {
  maxHp: number;
  marchSpeed: number;
  chargeSpeed: number;
  chargeImpactDamage: number;
  missileRange?: number;
  missileDamage?: number;
  kiteThreshold?: number;
}

export const UNITS: Record<UnitType, UnitConfig> = raw;

// Legacy-shape derivations — existing call sites keep working unchanged.
export const MAX_HP_BY_TYPE: Record<UnitType, number> = Object.fromEntries(
  Object.entries(UNITS).map(([k, v]) => [k, v.maxHp])
) as Record<UnitType, number>;

export const MARCH_HEXES_PER_TICK: Record<UnitType, number> = Object.fromEntries(
  Object.entries(UNITS).map(([k, v]) => [k, v.marchSpeed])
) as Record<UnitType, number>;
// ... CHARGE_HEXES_PER_TICK, CHARGE_IMPACT_DAMAGE_BY_TYPE similarly.

// Skirmisher-only fields exposed flat to preserve the existing exports.
export const SKIRMISHER_MISSILE_RANGE  = UNITS.skirmisher.missileRange!;
export const SKIRMISHER_MISSILE_DAMAGE = UNITS.skirmisher.missileDamage!;
export const SKIRMISHER_KITE_THRESHOLD = UNITS.skirmisher.kiteThreshold!;
```

### Hex-color parsing

```ts
const hexStr = (c: string): number => parseInt(c.slice(1), 16);
// in terrain.ts: color: hexStr(raw.GRASSLAND.color)
```

### Sprite-pool expansion

```ts
const expandPool = (
  pool: { category: string; weight: number; firstN?: number }[],
  catalog: SpriteCatalog,
): WeightedSprite[] =>
  pool.flatMap(({ category, weight, firstN }) => {
    const { count } = catalog[category];
    const keys = numKeys(category, firstN ?? count);
    return keys.map(key => ({ key, weight }));
  });
```

### `tsconfig` requirements

`resolveJsonModule: true` and `esModuleInterop: true` in `tsconfig.app.json`. If missing, add as part of step 0.

### Sim harness

`scripts/sim-formations.ts` runs under `tsx`, which respects `resolveJsonModule`. The harness imports from `src/battle/simulate.ts` and `src/battle/terrain.ts`; those files start importing from the data wrappers transitively. Each migration step must keep the harness green.

## Migration order

Each step = one commit. After each: `npm run build` + `npx tsx scripts/sim-formations.ts` + visual sanity in the dev server.

| Step | Scope | Why this order |
|------|-------|----------------|
| 0 | Scaffold `src/data/`, confirm `tsconfig`, add a smoke-test JSON import. | Validates the toolchain before touching real data. |
| 1 | `combat.json` | Smallest surface, all primitives, no parsing, no expansion. "Hello world" of the migration. |
| 2 | `units.json` | Per-type records. Harness directly validates HP/speed/damage. |
| 3 | `terrain.json` (+ split wrapper) | Crosses the canvas/sim boundary — exercises the two-wrapper pattern. Harness validates mechanical fields; visual sanity validates colors. |
| 4 | `game.json` | High entry count but mechanically simple. Visual sanity validates capture flower, deploy zones, tints. |
| 5 | `world-gen.json` | First step that *renames* magic numbers. Highest risk for visual drift. **Add `scripts/snapshot-worldgen.ts`** that dumps `gridData` for a fixed seed; diff before/after must be empty. |
| 6 | `details.json` | Largest and most invasive — rewrites `spriteCategory`, `detailAssetPath`, expands sprite pools. Snapshot strategy analogous to step 5 if rigor is wanted. |
| 7 | Cleanup | Optionally drop legacy-shape exports once all consumers use the new API. Update `CLAUDE.md` with a `## Data files` section describing `src/data/` and the "balance-tunable lives here" rule. |

## Out of scope

- Runtime validation (Zod). Out per "clean separation" objective.
- Async / fetch loading. Out for the same reason.
- Replacing math constants (hash multipliers, noise mixing). Inline.
- Renaming consumers wholesale. The legacy-shape exports preserve current call sites; consumer renames can be a follow-up if/when desired.
- Visual extents (`TACTICAL_HALF_W/H`, `TACTICAL_BBOX_*`, `DRAG_THRESHOLD_PX` if reconsidered). `DRAG_THRESHOLD_PX` is included in `game.json` per the inventory; the others stay inline as structural.

## Risk audit

- **Drift between legacy-shape exports and JSON:** impossible — the shims derive from the JSON at module init.
- **Build size:** JSON is bundled via static import; Vite treats it as a module. No runtime overhead beyond the existing `const` exports.
- **HMR:** Vite recompiles on JSON change. Same UX as editing a TS constant today.
- **World-gen visual drift in step 5:** mitigated by snapshot diff against a fixed seed.
- **Hex string typos in `terrain.json`:** caught at runtime (`NaN` color) — visible as black tiles on first load. Mitigation: visual sanity gate is mandatory for step 3.
- **Off-by-one in sprite-pool expansion (especially `firstN`):** mitigated by visual sanity in step 6. Snapshot-based testing optional.
