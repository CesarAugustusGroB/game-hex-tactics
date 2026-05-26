# Map types — design

## Problem

World generation only ever produces an **island**: the `STRATEGIC` branch of
`sampleElevation` (`src/canvas/world-gen.ts`) multiplies elevation by a radial
falloff (`max(0, intercept − d^exponent)`, `d` = normalized radial distance from
center), which sinks the edges into sea. Everything else — noise, buckets,
cohesion, rivers — is shape-agnostic. We want a selectable set of macro shapes,
a HUD selector with a Random option, and a visible/editable seed for
reproducible maps.

Scope is the **macro shape** (the `STRATEGIC` elevation shaping). Tactical
battlefield variety is explicitly out of scope; the tactical dive must stay
consistent with the strategic patch it dives into.

## Approach

Approach A from brainstorming: a small registry of **shaping primitives**,
data-driven in `world-gen.json`. Each archetype = one primitive + per-archetype
`waterLevel`/`mountainLevel` overrides. Five archetypes come from four
primitives.

## Archetypes & shaping primitives

`d` = `sqrt(q² + r² + q·r) / gridRadius` (existing radial distance). All
falloff primitives reuse the existing `falloff { intercept, exponent }` block.

| archetype     | primitive        | `mult` formula                                  | effect |
|---------------|------------------|-------------------------------------------------|--------|
| `island`      | `radial`         | `max(0, intercept − d^exp)`                     | **byte-identical to current** — center high, edges sea |
| `coastline`   | `linear`         | `max(0, intercept − (1 − tNorm)^exp)`           | sea on one edge, rising to the opposite; `tNorm` = position along a seed-chosen axis |
| `archipelago` | `flat`           | `1`                                             | no shaping; high water level → scattered noise-peak islands |
| `plains`      | `flat`           | `1`                                             | no shaping; low water level → continuous land, few/no lakes |
| `inlandSea`   | `invertedRadial` | `max(0, intercept − (1 − min(d,1))^exp)`        | center low (sea), edges high — inverse of island |

`linear` detail: a coast angle `θ` is derived from the seed (see Determinism).
Project axial coords onto the unit axis `(cos θ, sin θ)`:
`proj = q·cos θ + r·sin θ`, `tNorm = clamp((proj / gridRadius + 1) / 2, 0, 1)`.
`tNorm → 1` (land side) gives `mult ≈ intercept`; `tNorm → 0` (sea side) gives
`mult ≈ intercept − 1` (≤ water).

**Invariant:** the `radial` formula stays numerically identical to today, so
the island archetype preserves current behavior.

## Data model (`src/data/world-gen.json` + `world-gen.ts`)

New JSON keys:

```jsonc
"mapTypes": {
  "island":      { "shape": "radial",         "waterLevel": 0.40, "mountainLevel": 0.85 },
  "coastline":   { "shape": "linear",         "waterLevel": 0.42, "mountainLevel": 0.85 },
  "archipelago": { "shape": "flat",           "waterLevel": 0.55, "mountainLevel": 0.88 },
  "plains":      { "shape": "flat",           "waterLevel": 0.25, "mountainLevel": 0.90 },
  "inlandSea":   { "shape": "invertedRadial", "waterLevel": 0.45, "mountainLevel": 0.88 }
},
"defaultMapType": "island"
```

`falloff { intercept, exponent }` stays as-is and is reused by all falloff
primitives. `defaultGenSettings.waterLevel`/`mountainLevel` are removed — those
values now live per-archetype in `mapTypes`.

Wrapper (`world-gen.ts`) adds and exports:
- `type ShapePrimitive = 'radial' | 'linear' | 'flat' | 'invertedRadial'`
- `type MapTypeId` (keys of `mapTypes`)
- `interface MapTypeConfig { shape: ShapePrimitive; waterLevel: number; mountainLevel: number }`
- `MAP_TYPES: Record<MapTypeId, MapTypeConfig>`
- `MAP_TYPE_IDS: MapTypeId[]`
- `DEFAULT_MAP_TYPE: MapTypeId`

## Pure function (`src/canvas/world-gen.ts`)

`GenSettings` becomes `{ mapType: MapTypeId; seed: number; noiseOffset; resolution }`
(`waterLevel`/`mountainLevel` removed).

Signature drops the external `noise`: `generateWorldData({ settings, gridRadius, viewMode })`.
Seed is consumed inside via three independent mulberry32 streams (independent so
the consumption order of one does not perturb another):

```
noise    = createNoise2D(mulberry32(seed))   // elevation field
shapeRng = mulberry32(seed ^ SHAPE_SALT)     // coast angle θ for linear
riverRng = mulberry32(seed ^ RIVER_SALT)     // river starts + tactical thickening
```

- River pass `Math.random()` calls → `riverRng()`.
- `mulberry32` extracted to `src/utils/rng.ts` (imported by the pure function and
  the snapshot script; currently duplicated in the script).
- The hardcoded radial falloff is replaced by `shapeMult(shape, q, r, ctx)`,
  dispatching on `MAP_TYPES[mapType].shape`. `ctx` carries `gridRadius`,
  `intercept`, `exponent`, and the seed-derived coast angle.
- `sampleElevation` reads `waterLevel`/`mountainLevel` from
  `MAP_TYPES[settings.mapType]` for `bucket`.

### Tactical dive consistency

`tacticalElevationMult` generalizes to `shapeMult(shape, diveStrategicQ,
diveStrategicR, ctx)` evaluated once at the clicked point, using the active
primitive. `flat` → `1` (tactical = strategic exactly); `linear`/`invertedRadial`
evaluate with the same seed-derived angle, so the patch stays consistent.
Because `mapType` persists across the dive, water/mountain thresholds match
between views.

## UI (`src/canvas/HUD.tsx`)

A "WORLD" section (shown only in `STRATEGIC`, above the regenerate button):
- **Type selector:** six chips in the existing team/group button-row style —
  `Island · Coastline · Archipelago · Plains · Inland Sea · Random`. Active one
  highlighted. When `Random`, shows the resolved choice (e.g. `RANDOM → COASTLINE`).
- **Seed:** `<input type="number">` bound to the current seed (editable) plus a
  small `🎲 NEW SEED` button.
- **`REGENERATE ECOSYSTEM`** (existing): generates with the shown `mapType` and
  `seed` (deterministic — same pair ⇒ same map). `🎲` randomizes the seed then
  regenerates.

New `HUDProps`: `mapTypeChoice`, `seed`, `resolvedMapType`, `setMapTypeChoice`,
`setSeed`. (`regenerateWorld` already exists.)

## Integration (`src/components/GameCanvas.tsx`)

- `genSettings` initial: `mapType: DEFAULT_MAP_TYPE`, `seed: <random at boot>`.
- `mapTypeChoice` (may be `'random'`) is separate state from the concrete
  `mapType` passed to the pure function.
- `regenerateWorld`: resolve `random → concrete` via a hash of the seed (so the
  resolved archetype is reproducible and displayable), set `resolvedMapType`,
  pass the concrete `mapType` to the pure function. Existing reset logic
  (armies, `tickCounterRef = 0`, rosters, command points, etc.) is unchanged.
  Remove `noiseRef.current = null`.
- `returnToStrategic`: keeps `mapType` and `seed` (same world); resets only
  `noiseOffset`/`resolution` as today.
- `noiseRef` is no longer used for world-gen (the pure function builds noise from
  `seed`; strategic↔dive share the seed ⇒ identical noise). `detailDensityNoiseRef`
  is untouched.

## Regression / testing

- **`scripts/snapshot-worldgen.ts`:** rewritten to import `mulberry32` from
  `src/utils/rng.ts`, iterate `MAP_TYPE_IDS` at a fixed seed, and dump `gridData`
  (strategic + one dive) per archetype. Removes the `Math.random` override and
  external `createNoise2D`. Re-baseline once after the change; thereafter diffs
  catch regressions.
- **Island sanity:** confirm the `island` archetype at the fixed seed yields a
  coherent island (the `radial` formula did not change).
- **Visual:** `npm run dev`, cycle the 5 archetypes + Random, dive into each to
  confirm the tactical field matches the strategic patch.
- **Build:** `npm run build` (tsc) must pass with the `GenSettings`/wrapper type
  changes. `sim-formations` is unaffected (no `combat`/`units`/`terrain` JSON
  change).

## Out of scope

- Tactical-battlefield archetypes (chokepoints, river-crossing maps).
- Seeding the decoration scatter (`detailDensityNoiseRef`) — cosmetic only.
- Per-archetype tuning beyond the initial `waterLevel`/`mountainLevel` values
  (those are starting points, tunable in JSON later).
