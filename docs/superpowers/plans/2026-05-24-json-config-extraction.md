# JSON Config Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move balance- and content-tunable values from TypeScript source into per-domain JSON files under `src/data/`, so designers can tweak balance without touching code and the codebase has one clear separation between data and logic.

**Architecture:** Six JSON files in `src/data/` (combat, units, terrain, game, world-gen, details), each paired with a TypeScript wrapper that owns type validation, boot-time transformation (hex-color parsing, sprite-pool expansion), and legacy-shape derivations so existing call sites work unchanged. Static `import` only — no fetch, no runtime validation. Spec: `docs/superpowers/specs/2026-05-24-json-config-extraction-design.md`.

**Tech Stack:** TypeScript 5.9 + Vite 8 + tsx (for the headless sim harness). No test runner — the validation triad per task is `npm run build` (type check) + `npm run lint` + `npm run sim` (deterministic battle harness, the closest thing to a regression test in this repo) + manual visual sanity in the dev server.

**Validation philosophy:** Since there is no test runner, the harness output (`npm run sim`) is captured as a baseline before each sim-touching task and compared after. Any drift = bug. World-gen and details rely on snapshot scripts built in their respective tasks. Visual sanity is mandatory after every task.

---

## File Structure

**Created (12 new files):**
- `src/data/combat.json` + `src/data/combat.ts`
- `src/data/units.json` + `src/data/units.ts`
- `src/data/terrain.json` + `src/data/terrain.ts` (canvas-side wrapper) + `src/data/terrain-mods.ts` (sim-side wrapper, no PIXI import)
- `src/data/game.json` + `src/data/game.ts`
- `src/data/world-gen.json` + `src/data/world-gen.ts`
- `src/data/details.json` + `src/data/details.ts`
- `scripts/snapshot-worldgen.ts` (regression tool for Task 6)
- `scripts/snapshot-details.ts` (regression tool for Task 7, optional)

**Modified:**
- `tsconfig.app.json` — add `resolveJsonModule: true` and `esModuleInterop: true`
- `src/battle/simulate.ts` — replace inline constants with imports from `src/data/units.ts` and `src/data/combat.ts`
- `src/battle/terrain.ts` — replace `TERRAIN_MODS`, `HEIGHT_BONUS_*` with imports from `src/data/terrain-mods.ts` and `src/data/combat.ts`
- `src/canvas/terrain-defs.ts` — replace `TERRAINS` with re-export from `src/data/terrain.ts`
- `src/canvas/constants.ts` — replace primitives with imports from `src/data/game.ts`; keep factories (`makeInitialRosters`, `captureZoneKeys`, `deployZoneFor`)
- `src/canvas/world-gen.ts` — replace hardcoded thresholds in `bucket()` and falloff with reads from `src/data/world-gen.ts`
- `src/components/GameCanvas.tsx` — read `gridRadius` and default `genSettings` from `src/data/world-gen.ts`
- `src/canvas/detail-rules.ts` — replace `DETAIL_RULES`, all `*_KEYS` arrays, `detailAssetPath`, `spriteCategory`, `GRASS_CHUNK_SIZE` with imports from `src/data/details.ts`
- `CLAUDE.md` — add `## Data files` section

---

## Task 0: Scaffold and tsconfig

**Files:**
- Modify: `tsconfig.app.json` (lines 11-14, add two flags)
- Create: `src/data/hello.json`
- Create: `src/data/hello.ts`

- [ ] **Step 1: Add JSON import flags to tsconfig**

Edit `tsconfig.app.json`. After the `"Bundler mode"` comment block (currently `moduleResolution`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `moduleDetection`, `noEmit`, `jsx`), add `resolveJsonModule: true` and `esModuleInterop: true`. The resulting `compilerOptions` block should include:

```jsonc
    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "esModuleInterop": true,
```

- [ ] **Step 2: Create the smoke-test JSON and wrapper**

Create `src/data/hello.json`:
```json
{ "ok": true }
```

Create `src/data/hello.ts`:
```ts
import raw from './hello.json';
export const HELLO: { ok: boolean } = raw;
```

- [ ] **Step 3: Verify build accepts the JSON import**

Run: `npm run build`
Expected: PASS (compiles cleanly, Vite bundles the JSON).

- [ ] **Step 4: Verify lint accepts it**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Capture harness baseline (for later task diffs)**

Run: `npm run sim > /tmp/sim-baseline.txt 2>&1`
Expected: file written, no errors. This baseline is consulted at the end of Tasks 1, 2, 3.

Note: on Windows PowerShell use `npm run sim *> $env:TEMP\sim-baseline.txt` instead (PowerShell redirection syntax differs).

- [ ] **Step 6: Delete the smoke-test files**

Delete `src/data/hello.json` and `src/data/hello.ts`. They served their purpose.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.app.json
git commit -m "Enable JSON module imports in tsconfig"
```

---

## Task 1: combat.json

**Why first:** Smallest surface, all primitives, no parsing, no expansion. Sim-touching, so the harness directly validates correctness.

**Files:**
- Create: `src/data/combat.json`
- Create: `src/data/combat.ts`
- Modify: `src/battle/simulate.ts` (lines 156-228, replace named constants)
- Modify: `src/battle/terrain.ts` (lines 76-88, replace `HEIGHT_BONUS_*`)
- Modify: `src/canvas/constants.ts` (line 67, replace `DAMAGE_PER_TICK`)

- [ ] **Step 1: Create the JSON**

Create `src/data/combat.json`:
```json
{
  "tickDamage": 10,
  "charge":  { "durationTicks": 3, "impactRange": 2 },
  "hold":    { "reductionPerTick": 0.05, "reductionCap": 0.40, "autoIdleAfterTicks": 8 },
  "unleash": { "maxEngagers": 3 },
  "height":  { "bonusPerUnit": 0.01, "bonusCap": 0.50 }
}
```

- [ ] **Step 2: Create the wrapper**

Create `src/data/combat.ts`:
```ts
import raw from './combat.json';

export interface CombatConfig {
  tickDamage: number;
  charge:  { durationTicks: number; impactRange: number };
  hold:    { reductionPerTick: number; reductionCap: number; autoIdleAfterTicks: number };
  unleash: { maxEngagers: number };
  height:  { bonusPerUnit: number; bonusCap: number };
}

export const COMBAT: CombatConfig = raw;

// Legacy-shape exports — preserve existing call sites unchanged.
export const DAMAGE_PER_TICK            = COMBAT.tickDamage;
export const CHARGE_DURATION_TICKS      = COMBAT.charge.durationTicks;
export const CHARGE_IMPACT_RANGE        = COMBAT.charge.impactRange;
export const HOLD_REDUCTION_PER_TICK    = COMBAT.hold.reductionPerTick;
export const HOLD_REDUCTION_CAP         = COMBAT.hold.reductionCap;
export const HOLD_AUTO_IDLE_AFTER_TICKS = COMBAT.hold.autoIdleAfterTicks;
export const UNLEASH_MAX_ENGAGERS       = COMBAT.unleash.maxEngagers;
export const HEIGHT_BONUS_PER_UNIT      = COMBAT.height.bonusPerUnit;
export const HEIGHT_BONUS_CAP           = COMBAT.height.bonusCap;
```

- [ ] **Step 3: Update `src/battle/simulate.ts` to re-export from combat.ts**

Open `src/battle/simulate.ts`. Locate the constant block around lines 156-228:
- Line 157: `export const CHARGE_DURATION_TICKS = 3;`
- Line 158: `export const CHARGE_IMPACT_RANGE = 2;`
- Line 217: `export const UNLEASH_MAX_ENGAGERS = 3;`
- Line 224: `export const HOLD_REDUCTION_PER_TICK = 0.05;`
- Line 225: `export const HOLD_REDUCTION_CAP = 0.40;`
- Line 226: `export const HOLD_AUTO_IDLE_AFTER_TICKS = 8;`

Replace these six lines with a single re-export block at the same location (preserving the JSDoc comments that precede them so context is kept):

```ts
// Combat tunables sourced from src/data/combat.json. Kept as named re-exports here
// so existing call sites within simulate.ts and downstream consumers don't need to
// migrate import paths.
export {
  CHARGE_DURATION_TICKS,
  CHARGE_IMPACT_RANGE,
  UNLEASH_MAX_ENGAGERS,
  HOLD_REDUCTION_PER_TICK,
  HOLD_REDUCTION_CAP,
  HOLD_AUTO_IDLE_AFTER_TICKS,
} from '../data/combat';
```

Leave the JSDoc comments in place above each conceptual block; they still document the meaning even though the value lives in JSON.

`holdReduction()` at line 227-228 references `HOLD_REDUCTION_PER_TICK` and `HOLD_REDUCTION_CAP` — those identifiers are now imported, so the function continues to work unchanged.

- [ ] **Step 4: Update `src/battle/terrain.ts` to re-export `HEIGHT_BONUS_*`**

Open `src/battle/terrain.ts`. Replace lines 77-78:
```ts
export const HEIGHT_BONUS_PER_UNIT = 0.01;
export const HEIGHT_BONUS_CAP = 0.50;
```
with:
```ts
export { HEIGHT_BONUS_PER_UNIT, HEIGHT_BONUS_CAP } from '../data/combat';
```

`heightDamageBonus()` at lines 85-88 uses both identifiers — works unchanged.

- [ ] **Step 5: Update `src/canvas/constants.ts` to re-export `DAMAGE_PER_TICK`**

Open `src/canvas/constants.ts`. Replace line 67 (`export const DAMAGE_PER_TICK = 10;`) with:
```ts
export { DAMAGE_PER_TICK } from '../data/combat';
```

- [ ] **Step 6: Build and lint**

Run: `npm run build`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Run the harness and diff against baseline**

Run: `npm run sim > /tmp/sim-after-task1.txt 2>&1 && diff /tmp/sim-baseline.txt /tmp/sim-after-task1.txt`
Expected: zero output (empty diff). Any non-empty diff = bug, do NOT commit.

PowerShell equivalent: `npm run sim *> $env:TEMP\sim-after-task1.txt; fc.exe $env:TEMP\sim-baseline.txt $env:TEMP\sim-after-task1.txt`. `fc.exe` exits 0 and prints "no differences" when files match.

- [ ] **Step 8: Visual sanity check**

If the dev server is not running, start it: `npm run dev -- --port 5174` (background). Open http://localhost:5174/. Trigger a battle (deploy units, press SPACE). Verify:
- Units take damage at the usual rate (DAMAGE_PER_TICK).
- Charges complete in roughly the usual duration.
- Hold mode (`s` key on a group) accumulates the damage-reduction bonus as before.

If anything looks off, fix before committing.

- [ ] **Step 9: Commit**

```bash
git add src/data/combat.json src/data/combat.ts src/battle/simulate.ts src/battle/terrain.ts src/canvas/constants.ts
git commit -m "$(cat <<'EOF'
Extract combat tunables to src/data/combat.json

First migration step. Six globals (CHARGE_DURATION_TICKS, CHARGE_IMPACT_RANGE,
UNLEASH_MAX_ENGAGERS, HOLD_REDUCTION_*, HOLD_AUTO_IDLE_AFTER_TICKS,
HEIGHT_BONUS_*, DAMAGE_PER_TICK) move to JSON; the wrapper re-exports the
legacy symbol names so call sites are unchanged. Sim harness baseline diff
is empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: units.json

**Why second:** Per-type records, mechanically simple, sim-validated. Harness directly checks march/charge speeds, HP, missile parameters.

**Files:**
- Create: `src/data/units.json`
- Create: `src/data/units.ts`
- Modify: `src/battle/simulate.ts` (lines 164-205, replace `MARCH_HEXES_PER_TICK`, `CHARGE_HEXES_PER_TICK`, `CHARGE_IMPACT_DAMAGE_BY_TYPE`, `MAX_HP_BY_TYPE`, `SKIRMISHER_MISSILE_RANGE`, `SKIRMISHER_MISSILE_DAMAGE`, `SKIRMISHER_KITE_THRESHOLD`)

- [ ] **Step 1: Create the JSON**

Create `src/data/units.json`:
```json
{
  "infantry":   { "maxHp": 100, "marchSpeed": 2, "chargeSpeed": 4, "chargeImpactDamage": 10 },
  "cavalry":    { "maxHp":  60, "marchSpeed": 4, "chargeSpeed": 6, "chargeImpactDamage": 20 },
  "skirmisher": { "maxHp":  40, "marchSpeed": 3, "chargeSpeed": 4, "chargeImpactDamage":  5,
                  "missileRange": 3, "missileDamage": 5, "kiteThreshold": 2 }
}
```

- [ ] **Step 2: Create the wrapper**

Create `src/data/units.ts`:
```ts
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

// Legacy-shape derivations — preserve existing per-record exports.
const derive = <K extends keyof UnitConfig>(key: K): Record<UnitType, UnitConfig[K]> =>
  Object.fromEntries(
    Object.entries(UNITS).map(([k, v]) => [k, v[key]]),
  ) as Record<UnitType, UnitConfig[K]>;

export const MAX_HP_BY_TYPE                = derive('maxHp')              as Record<UnitType, number>;
export const MARCH_HEXES_PER_TICK          = derive('marchSpeed')         as Record<UnitType, number>;
export const CHARGE_HEXES_PER_TICK         = derive('chargeSpeed')        as Record<UnitType, number>;
export const CHARGE_IMPACT_DAMAGE_BY_TYPE  = derive('chargeImpactDamage') as Record<UnitType, number>;

// Skirmisher-only fields — the `!` is safe because the JSON guarantees skirmisher
// carries these fields; the wrapper is the single point of that guarantee.
export const SKIRMISHER_MISSILE_RANGE  = UNITS.skirmisher.missileRange!;
export const SKIRMISHER_MISSILE_DAMAGE = UNITS.skirmisher.missileDamage!;
export const SKIRMISHER_KITE_THRESHOLD = UNITS.skirmisher.kiteThreshold!;
```

- [ ] **Step 3: Replace constants in `src/battle/simulate.ts`**

Open `src/battle/simulate.ts`. Replace the four record-shaped constants (lines 164-193: `MARCH_HEXES_PER_TICK`, `CHARGE_HEXES_PER_TICK`, `CHARGE_IMPACT_DAMAGE_BY_TYPE`, `MAX_HP_BY_TYPE`) and the three skirmisher primitives (lines 197, 200, 205: `SKIRMISHER_MISSILE_RANGE`, `SKIRMISHER_MISSILE_DAMAGE`, `SKIRMISHER_KITE_THRESHOLD`) with a single re-export block. Keep the JSDoc comments above each block in place — they remain accurate.

The seven lines become:
```ts
export {
  MARCH_HEXES_PER_TICK,
  CHARGE_HEXES_PER_TICK,
  CHARGE_IMPACT_DAMAGE_BY_TYPE,
  MAX_HP_BY_TYPE,
  SKIRMISHER_MISSILE_RANGE,
  SKIRMISHER_MISSILE_DAMAGE,
  SKIRMISHER_KITE_THRESHOLD,
} from '../data/units';
```

Place this block at the position of the original `MARCH_HEXES_PER_TICK` declaration (around line 164), and delete the seven removed declarations.

- [ ] **Step 4: Build and lint**

Run: `npm run build`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Re-baseline and diff against baseline**

This task changes per-unit-type values that the harness uses directly. Diff against the baseline captured in Task 0:

Run (bash): `npm run sim > /tmp/sim-after-task2.txt 2>&1 && diff /tmp/sim-baseline.txt /tmp/sim-after-task2.txt`
Expected: zero output (empty diff).

PowerShell: `npm run sim *> $env:TEMP\sim-after-task2.txt; fc.exe $env:TEMP\sim-baseline.txt $env:TEMP\sim-after-task2.txt`. Expect "no differences".

- [ ] **Step 6: Visual sanity check**

Deploy units of each type in the dev server. Verify:
- Infantry walks 2 hexes/tick on march; cavalry 4; skirmisher 3 (alternating 1/2 if `marchSpeed` is fractional — in this JSON it's 3 = integer).
- Cavalry charges feel snappy (6 hex/tick).
- Skirmisher throws a javelin at enemies within 3 hexes.
- HP bars show 100/60/40 max for the three types.

- [ ] **Step 7: Commit**

```bash
git add src/data/units.json src/data/units.ts src/battle/simulate.ts
git commit -m "$(cat <<'EOF'
Extract per-unit-type tunables to src/data/units.json

Per-type HP, march speed, charge speed, charge impact damage, and the
skirmisher-only missile range/damage and kite threshold all move to JSON.
The wrapper rebuilds the legacy `*_BY_TYPE` records via Object.fromEntries
so simulate.ts call sites remain unchanged. Sim harness baseline diff is
empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: terrain.json (with split canvas/sim wrappers)

**Why third:** First task that crosses the canvas/sim boundary. Exercises the two-wrapper pattern (`terrain.ts` for canvas, `terrain-mods.ts` for sim). Harness validates mechanical fields; visual check validates colors.

**Files:**
- Create: `src/data/terrain.json`
- Create: `src/data/terrain.ts` (canvas-side: parses hex colors, exposes full `TerrainDef`)
- Create: `src/data/terrain-mods.ts` (sim-side: exposes `TERRAIN_MODS` only, no PIXI dependency)
- Modify: `src/canvas/terrain-defs.ts` (replace `TERRAINS` literal with re-export from `src/data/terrain.ts`)
- Modify: `src/battle/terrain.ts` (replace `TERRAIN_MODS` literal with re-export from `src/data/terrain-mods.ts`)

- [ ] **Step 1: Create the JSON**

Create `src/data/terrain.json`:
```json
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

- [ ] **Step 2: Create the sim-side wrapper**

Create `src/data/terrain-mods.ts`:
```ts
import raw from './terrain.json';
import type { TerrainMods } from '../battle/terrain';

// Read only the mechanical fields. Color/label/height/walkable are ignored here,
// keeping the sim layer free of any visual concern.
type RawTerrainEntry = {
  defenseMult?: number;
  moveCost?: number;
  attritionPerTick?: number;
  visionRadius?: number;
};

const rawTyped = raw as Record<string, RawTerrainEntry>;

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
```

Note: this file deliberately does NOT import `TERRAINS` or anything from the canvas side. The sim layer remains independent.

- [ ] **Step 3: Create the canvas-side wrapper**

Create `src/data/terrain.ts`:
```ts
import raw from './terrain.json';
import type { TerrainDef } from '../canvas/terrain-defs';

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
```

- [ ] **Step 4: Thin `src/canvas/terrain-defs.ts`**

Open `src/canvas/terrain-defs.ts`. Replace lines 21-32 (the `TERRAINS` const literal):
```ts
export const TERRAINS: Record<string, TerrainDef> = { ... };
```
with a re-export:
```ts
export { TERRAINS } from '../data/terrain';
```

Also remove the now-unused import on line 1 (`import { TERRAIN_MODS } from '../battle/terrain';`). The `TerrainDef` interface declaration (lines 3-17) stays — `src/data/terrain.ts` imports it back.

- [ ] **Step 5: Thin `src/battle/terrain.ts`**

Open `src/battle/terrain.ts`. Replace lines 49-58 (the `TERRAIN_MODS` const literal):
```ts
export const TERRAIN_MODS: Record<string, Partial<TerrainMods>> = { ... };
```
with a re-export:
```ts
export { TERRAIN_MODS } from '../data/terrain-mods';
```

`DEFAULT_TERRAIN_MODS` (lines 30-35) and `getTerrainMods()` (lines 64-74) stay — they consume `TERRAIN_MODS` which is now imported.

- [ ] **Step 6: Build and lint**

Run: `npm run build`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Re-baseline and diff against baseline**

Run (bash): `npm run sim > /tmp/sim-after-task3.txt 2>&1 && diff /tmp/sim-baseline.txt /tmp/sim-after-task3.txt`
Expected: zero output.

PowerShell: `npm run sim *> $env:TEMP\sim-after-task3.txt; fc.exe $env:TEMP\sim-baseline.txt $env:TEMP\sim-after-task3.txt`. Expect "no differences".

- [ ] **Step 8: Visual sanity check**

Open the dev server. Regenerate the world (if needed). Verify:
- Every terrain renders with its expected color (no black tiles — black means a hex-color typo, fix in `terrain.json`).
- Labels in the HUD/tooltip (if shown) match.
- Heights look right: snow tallest, deep sea lowest.
- Walkable check: try to issue an order onto a `SEA` hex — should reject.
- Try a battle on a HILL — defense bonus should still apply (cover the unit takes less damage).

- [ ] **Step 9: Commit**

```bash
git add src/data/terrain.json src/data/terrain.ts src/data/terrain-mods.ts src/canvas/terrain-defs.ts src/battle/terrain.ts
git commit -m "$(cat <<'EOF'
Extract terrain defs and mods to src/data/terrain.json

Single source of truth for both visual fields (color, label, height,
walkable) and mechanical fields (defenseMult, moveCost, attritionPerTick,
visionRadius). Two wrappers project different views: terrain.ts is
canvas-side and parses hex-color strings to numbers; terrain-mods.ts is
sim-side and exposes only the mechanical fields with no PIXI dependency.
The architectural rule that sim does not import canvas is preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: game.json

**Why fourth:** High entry count, mechanically simple, canvas-only (sim doesn't depend on it). The most "designer-facing" file — tunes the broad game feel.

**Files:**
- Create: `src/data/game.json`
- Create: `src/data/game.ts`
- Modify: `src/canvas/constants.ts` (replace primitives and tables, keep factories)

- [ ] **Step 1: Create the JSON**

Create `src/data/game.json`:
```json
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

- [ ] **Step 2: Create the wrapper**

Create `src/data/game.ts`:
```ts
import raw from './game.json';
import type { Team, UnitType, FormationType } from '../battle/simulate';

const hexStr = (c: string): number => parseInt(c.slice(1), 16);

export interface GameConfig {
  tickMs: number;
  lodThreshold: number;
  dragThresholdPx: number;
  deployZoneFrac: number;
  retreatRefundFrac: number;
  initialRoster: Record<UnitType, number>;
  cohortSize: number;
  capture: { ticksToWin: number; center: { q: number; r: number } };
  teams: Record<Team, { tint: string }>;
  formations: { cycle: FormationType[]; labels: Record<FormationType, string> };
  headingArrows: Record<string, string>;
}

export const GAME: GameConfig = raw as GameConfig;

// Legacy-shape exports
export const TICK_MS              = GAME.tickMs;
export const LOD_THRESHOLD        = GAME.lodThreshold;
export const DRAG_THRESHOLD_PX    = GAME.dragThresholdPx;
export const DEPLOY_ZONE_FRAC     = GAME.deployZoneFrac;
export const RETREAT_REFUND_FRAC  = GAME.retreatRefundFrac;
export const INITIAL_ROSTER       = GAME.initialRoster;
export const COHORT_SIZE          = GAME.cohortSize;
export const CAPTURE_TICKS_TO_WIN = GAME.capture.ticksToWin;
export const CAPTURE_CENTER       = GAME.capture.center;
export const FORMATION_CYCLE      = GAME.formations.cycle;
export const FORMATION_LABELS     = GAME.formations.labels;

export const TEAM_TINTS: Record<Team, number> = Object.fromEntries(
  Object.entries(GAME.teams).map(([team, v]) => [team, hexStr(v.tint)]),
) as Record<Team, number>;

// Re-key the heading arrows from string-keyed (JSON) to number-keyed (consumer-facing).
export const HEADING_ARROWS: Record<number, string> = Object.fromEntries(
  Object.entries(GAME.headingArrows).map(([k, v]) => [Number(k), v]),
);
```

- [ ] **Step 3: Thin `src/canvas/constants.ts`**

Open `src/canvas/constants.ts`. Replace the primitive/table declarations with re-exports, keeping the factories and the private `DEPLOY_ZONE_FRAC`-aware helpers.

Lines to delete (declarations):
- Line 9-11: `HEADING_ARROWS` literal
- Line 27: `INITIAL_ROSTER`
- Line 28: `COHORT_SIZE`
- Line 33: `RETREAT_REFUND_FRAC`
- Line 39: `CAPTURE_TICKS_TO_WIN`
- Line 40: `CAPTURE_CENTER`
- Line 54-60: `FORMATION_CYCLE`, `FORMATION_LABELS`
- Line 62-65: `TEAM_TINTS`
- Line 68: `TICK_MS` (`DAMAGE_PER_TICK` was already re-exported from `combat` in Task 1; leave that line in place)
- Line 75: `LOD_THRESHOLD`
- Line 83: `DEPLOY_ZONE_FRAC` (was private `const`, will be re-imported)

Add a single re-export block near the top of the file (after the imports, before `DRAG_THRESHOLD_PX`):
```ts
export {
  HEADING_ARROWS,
  INITIAL_ROSTER,
  COHORT_SIZE,
  RETREAT_REFUND_FRAC,
  CAPTURE_TICKS_TO_WIN,
  CAPTURE_CENTER,
  FORMATION_CYCLE,
  FORMATION_LABELS,
  TEAM_TINTS,
  TICK_MS,
  LOD_THRESHOLD,
  DRAG_THRESHOLD_PX,
} from '../data/game';

import { DEPLOY_ZONE_FRAC } from '../data/game';
```

Delete the existing `export const DRAG_THRESHOLD_PX = 24;` at line 4.

`captureZoneKeys()` (line 41-45) and `CAPTURE_ZONE_HEXES` (line 46) reference the imported `CAPTURE_CENTER` — they keep working.

`makeInitialRosters()` (line 48-52) spreads `INITIAL_ROSTER` per team — keep as-is.

`deployZoneFor()` (line 87-103) references the locally-imported `DEPLOY_ZONE_FRAC` — keep as-is.

The `Roster`, `Rosters`, `Armies`, `GroupOrders`, `GroupFormations`, `GroupDepths`, `InputMode` type aliases (lines 16-26) and `groupOrderKey()` (line 77) all stay.

- [ ] **Step 4: Build and lint**

Run: `npm run build`
Expected: PASS.
Run: `npm run lint`
Expected: PASS. If `noUnusedLocals` fires on the `import { DEPLOY_ZONE_FRAC }` (because it's only used in `deployZoneFor`), confirm `deployZoneFor` references it — it does, at line 96 (`const depthPx = (maxY - minY) * DEPLOY_ZONE_FRAC;`).

- [ ] **Step 5: Visual sanity check**

Open the dev server. No need to run the sim harness — this task doesn't touch `src/battle/`. Verify:
- Tick cadence feels the same (500 ms = 2 ticks/sec).
- Red units are red `#ef4444`, blue units are blue `#3b82f6`.
- Initial rosters show 50/50/50.
- Cohort size = 4 units per deploy click.
- Capture ticks bar fills/empties at the expected rate; flag occupies the central 7-hex flower.
- Heading arrows rendered on units match their direction.
- Formation cycling (e.g. via key `f`) goes line → wedge → column → hex with the correct labels.
- Deploy zone (visible band at each end of the tactical map) covers ~28% of the screen height per side.

- [ ] **Step 6: Commit**

```bash
git add src/data/game.json src/data/game.ts src/canvas/constants.ts
git commit -m "$(cat <<'EOF'
Extract app-level game tunables to src/data/game.json

TICK_MS, LOD_THRESHOLD, DRAG_THRESHOLD_PX, DEPLOY_ZONE_FRAC,
RETREAT_REFUND_FRAC, INITIAL_ROSTER, COHORT_SIZE, capture config, team
tints, formation cycle/labels, and heading arrows all move to JSON.
Wrapper re-exports the legacy symbol names; constants.ts keeps the
factories (makeInitialRosters, captureZoneKeys, CAPTURE_ZONE_HEXES,
deployZoneFor, groupOrderKey) and the type aliases unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: world-gen.json (snapshot-gated)

**Why fifth:** First task that *renames* magic numbers embedded in formulas. Highest risk for visual drift in the procedurally-generated map. A snapshot script is built first to gate the change.

**Files:**
- Create: `scripts/snapshot-worldgen.ts` (deterministic dump of `gridData` for a fixed seed)
- Create: `src/data/world-gen.json`
- Create: `src/data/world-gen.ts`
- Modify: `src/canvas/world-gen.ts` (read bucket thresholds and falloff from JSON)
- Modify: `src/canvas/constants.ts` (re-export `STRATEGIC_RESOLUTION`, `DIVE_ZOOM` from `src/data/world-gen.ts`)
- Modify: `src/components/GameCanvas.tsx` (read `gridRadius` and default `genSettings` from JSON)

- [ ] **Step 1: Build the snapshot script and capture the baseline**

Create `scripts/snapshot-worldgen.ts`:
```ts
/**
 * Deterministic dump of `generateWorldData` output for regression-testing the
 * world-gen JSON extraction (Task 5). Uses a seeded mulberry32 RNG so simplex
 * noise produces identical output across runs. Outputs JSON-Lines on stdout;
 * compare runs with `diff` (bash) or `fc.exe` (PowerShell).
 *
 * Run with: npx tsx scripts/snapshot-worldgen.ts
 */
import { createNoise2D } from 'simplex-noise';
import { generateWorldData } from '../src/canvas/world-gen';

const mulberry32 = (seed: number): () => number => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const noise = createNoise2D(mulberry32(0xC0FFEE));

const runStrategic = () => generateWorldData({
  settings: { waterLevel: 0.4, mountainLevel: 0.85, noiseOffset: { q: 0, r: 0 }, resolution: 40 },
  gridRadius: 35,
  viewMode: 'STRATEGIC',
  noise,
});

const runTactical = () => generateWorldData({
  settings: { waterLevel: 0.4, mountainLevel: 0.85, noiseOffset: { q: 7, r: -3 }, resolution: 40 / 4.5 },
  gridRadius: 35,
  viewMode: 'TACTICAL',
  noise,
});

// Sort by hex key so the output is order-stable.
const dump = (label: string, data: { gridData: { hex: { q: number; r: number }; type: string }[] }) => {
  const sorted = [...data.gridData].sort((a, b) =>
    a.hex.q - b.hex.q || a.hex.r - b.hex.r,
  );
  for (const { hex, type } of sorted) {
    console.log(`${label}\t${hex.q},${hex.r}\t${type}`);
  }
};

dump('STRATEGIC', runStrategic());
dump('TACTICAL',  runTactical());
```

Run BEFORE editing world-gen.ts:
- Bash: `npx tsx scripts/snapshot-worldgen.ts > /tmp/worldgen-baseline.txt`
- PowerShell: `npx tsx scripts/snapshot-worldgen.ts > $env:TEMP\worldgen-baseline.txt`

Verify the file has content (~thousands of lines, one per hex per view).

- [ ] **Step 2: Create the JSON**

Create `src/data/world-gen.json`:
```json
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
    "waterLevel":    0.4,
    "mountainLevel": 0.85
  }
}
```

(Values for `waterLevel` and `mountainLevel` are taken from `src/components/GameCanvas.tsx:132-133` as of this writing.)

- [ ] **Step 3: Create the wrapper**

Create `src/data/world-gen.ts`:
```ts
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
```

- [ ] **Step 4: Update `src/canvas/world-gen.ts` to read thresholds from JSON**

Open `src/canvas/world-gen.ts`. At the top of the file, change:
```ts
import { DIVE_ZOOM } from './constants';
```
to:
```ts
import { WORLD_GEN, DIVE_ZOOM } from '../data/world-gen';
```

Update the `bucket()` function (lines 40-49). Replace:
```ts
const bucket = (e: number): string => {
  if (e < w * 0.7) return 'DEEP_SEA';
  if (e < w) return 'SEA';
  if (e < w + 0.03) return 'SAND';
  if (e < m * 0.7) return 'GRASSLAND';
  if (e < m * 0.9) return 'FOREST';
  if (e < m) return 'HILL';
  if (e < m + 0.1) return 'MOUNTAIN';
  return 'SNOW';
};
```
with:
```ts
const b = WORLD_GEN.bucket;
const bucket = (e: number): string => {
  if (e < w * b.deepSeaMult)    return 'DEEP_SEA';
  if (e < w)                    return 'SEA';
  if (e < w + b.sandOffset)     return 'SAND';
  if (e < m * b.forestMult)     return 'GRASSLAND';
  if (e < m * b.hillMult)       return 'FOREST';
  if (e < m)                    return 'HILL';
  if (e < m + b.mountainOffset) return 'MOUNTAIN';
  return 'SNOW';
};
```

Update the falloff in `tacticalElevationMult` (lines 58-68). The line:
```ts
return Math.max(0, 1.1 - Math.pow(d, 2.5));
```
becomes:
```ts
return Math.max(0, WORLD_GEN.falloff.intercept - Math.pow(d, WORLD_GEN.falloff.exponent));
```

Update the strategic falloff inside `sampleElevation` (lines 74-79). The block:
```ts
if (viewMode === 'STRATEGIC') {
  const d = Math.sqrt(q*q + r*r + q*r) / gridRadius;
  e *= Math.max(0, 1.1 - Math.pow(d, 2.5));
}
```
becomes:
```ts
if (viewMode === 'STRATEGIC') {
  const d = Math.sqrt(q*q + r*r + q*r) / gridRadius;
  e *= Math.max(0, WORLD_GEN.falloff.intercept - Math.pow(d, WORLD_GEN.falloff.exponent));
}
```

- [ ] **Step 5: Update `src/canvas/constants.ts` to re-export `STRATEGIC_RESOLUTION` and `DIVE_ZOOM`**

Open `src/canvas/constants.ts`. Replace lines 13-14:
```ts
export const STRATEGIC_RESOLUTION = 40;
export const DIVE_ZOOM = 4.5;
```
with:
```ts
export { STRATEGIC_RESOLUTION, DIVE_ZOOM } from '../data/world-gen';
```

- [ ] **Step 6: Update `src/components/GameCanvas.tsx` to read defaults from JSON**

Open `src/components/GameCanvas.tsx`. Add `GRID_RADIUS` and `DEFAULT_GEN_SETTINGS` to the existing import from `../canvas/constants` if you prefer, OR import directly from `../data/world-gen`. The cleaner path is direct import (no extra re-export):

Add near other data imports (after line 20):
```ts
import { GRID_RADIUS, DEFAULT_GEN_SETTINGS } from '../data/world-gen';
```

Replace lines 131-136 (the `useState<GenSettings>` initializer):
```ts
const [genSettings, setSettings] = useState<GenSettings>({
  waterLevel: 0.4,
  mountainLevel: 0.85,
  noiseOffset: { q: 0, r: 0 },
  resolution: STRATEGIC_RESOLUTION
});
```
with:
```ts
const [genSettings, setSettings] = useState<GenSettings>({
  ...DEFAULT_GEN_SETTINGS,
  noiseOffset: { q: 0, r: 0 },
  resolution: STRATEGIC_RESOLUTION,
});
```

Replace line 138:
```ts
const gridRadius = 35;
```
with:
```ts
const gridRadius = GRID_RADIUS;
```

- [ ] **Step 7: Re-snapshot and diff**

Re-run the snapshot script and diff against the baseline:
- Bash: `npx tsx scripts/snapshot-worldgen.ts > /tmp/worldgen-after.txt && diff /tmp/worldgen-baseline.txt /tmp/worldgen-after.txt`
- PowerShell: `npx tsx scripts/snapshot-worldgen.ts > $env:TEMP\worldgen-after.txt; fc.exe $env:TEMP\worldgen-baseline.txt $env:TEMP\worldgen-after.txt`

Expected: empty diff. Any drift means a threshold was mistyped in `world-gen.json` — fix and rerun.

- [ ] **Step 8: Build, lint, and sim**

Run: `npm run build`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.
Run: `npm run sim` (no diff needed — world-gen doesn't affect sim, but the harness must still run cleanly).
Expected: PASS (same final tallies as previous runs).

- [ ] **Step 9: Visual sanity check**

Open the dev server. Regenerate the world repeatedly. Verify:
- Strategic view: island-shaped landmass with the same general distribution (water around the edges, mountains in the middle).
- Tactical dive on a forest/grassland/mountain: the dive should look like a zoomed patch of the same place, not a wholly different biome distribution.
- No "ghost mountains" appearing in formerly-flat areas, no SEA bleeding into expected land.

- [ ] **Step 10: Commit**

```bash
git add scripts/snapshot-worldgen.ts src/data/world-gen.json src/data/world-gen.ts src/canvas/world-gen.ts src/canvas/constants.ts src/components/GameCanvas.tsx
git commit -m "$(cat <<'EOF'
Extract world-gen thresholds and falloff to src/data/world-gen.json

Approach-B core change: bucket thresholds (deepSeaMult, sandOffset,
forestMult, hillMult, mountainOffset) and the radial-falloff parameters
(intercept, exponent) are pulled out of inline literals and named in JSON.
Also extracted: STRATEGIC_RESOLUTION, DIVE_ZOOM, GRID_RADIUS, and the
default GenSettings (waterLevel, mountainLevel).

A new scripts/snapshot-worldgen.ts dumps gridData for a fixed mulberry32
seed; the pre/post-task diff is empty, confirming the rename is value-
preserving.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: details.json (largest, most invasive)

**Why last:** Largest and most invasive — rewrites `spriteCategory`, `detailAssetPath`, expands compact sprite pools. Validation is visual (deterministic via the existing `seededRandom`) plus an optional snapshot.

**Files:**
- Create: `src/data/details.json`
- Create: `src/data/details.ts`
- Modify: `src/canvas/detail-rules.ts` (replace `DETAIL_RULES`, all `*_KEYS` arrays, `detailAssetPath`, `spriteCategory`, `GRASS_CHUNK_SIZE` with imports; keep `numKeys`, `pickWeighted`, `seededRandom`, `getHexSeed`, `grassChunkPatch`)

- [ ] **Step 1: Create the JSON**

Create `src/data/details.json`:
```json
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
    },
    "HILL": {
      "small": {
        "density": 0.07, "maxPerHex": 1,
        "scaleRange": [0.035, 0.075], "alphaRange": [0.22, 0.45],
        "spritePool": [
          { "category": "grass",  "weight": 50 },
          { "category": "rock",   "weight": 18 },
          { "category": "flower", "weight":  2 }
        ]
      },
      "categoryStyle": {
        "grass":  { "tint": "#FFFFFF" },
        "flower": { "tint": "#FFFFFF" },
        "rock":   { "tint": "#FFFFFF" }
      }
    },
    "FOREST": {
      "small": {
        "density": 0.22, "maxPerHex": 1,
        "scaleRange": [0.07, 0.16], "alphaRange": [0.40, 0.70],
        "spritePool": [
          { "category": "tiny_pine_cluster", "weight": 55 },
          { "category": "low_shrub_cluster", "weight": 20 },
          { "category": "dark_leaf_patch",   "weight":  8 },
          { "category": "dark_undergrowth",  "weight":  5 },
          { "category": "moss_clump",        "weight":  8 },
          { "category": "fallen_needles",    "weight":  4 }
        ]
      },
      "categoryStyle": {
        "pine":        { "tint": "#FFFFFF" },
        "shrub":       { "tint": "#FFFFFF" },
        "leafPatch":   { "tint": "#FFFFFF" },
        "undergrowth": { "tint": "#FFFFFF" },
        "moss":        { "tint": "#FFFFFF" },
        "needles":     { "tint": "#FFFFFF" }
      }
    },
    "RIVER": {
      "small": {
        "density": 0.12, "maxPerHex": 1,
        "scaleRange": [0.06, 0.14], "alphaRange": [0.45, 0.85],
        "spritePool": [
          { "category": "cyan_ripple",   "weight": 34 },
          { "category": "current_mark",  "weight": 26 },
          { "category": "shimmer_glint", "weight": 18 },
          { "category": "depth_wisp",    "weight": 14 },
          { "category": "foam_fleck",    "weight":  8 }
        ]
      },
      "categoryStyle": {
        "ripple":    { "tint": "#FFFFFF" },
        "shimmer":   { "tint": "#FFFFFF" },
        "current":   { "tint": "#FFFFFF" },
        "foam":      { "tint": "#FFFFFF" },
        "depthWisp": { "tint": "#FFFFFF" }
      }
    },
    "SEA": {
      "small": {
        "density": 0.025, "maxPerHex": 1,
        "scaleRange": [0.07, 0.12], "alphaRange": [0.18, 0.36],
        "spritePool": [
          { "category": "sea_shimmer", "weight": 1 }
        ]
      },
      "categoryStyle": {
        "seaShimmer": { "tint": "#FFFFFF" }
      }
    }
  }
}
```

The `firstN` field is present only in the GRASSLAND `small` rock entry — it preserves the original `ROCK_KEYS.slice(0, 2)` behavior.

- [ ] **Step 2: Create the wrapper**

Create `src/data/details.ts`:
```ts
import raw from './details.json';
import type {
  DetailCategory, DetailLayerConfig, TerrainDetailRules, WeightedSprite,
} from '../canvas/detail-rules';

const hexStr = (c: string): number => parseInt(c.slice(1), 16);

interface RawCatalogEntry { count: number; path: string }
interface RawSpritePoolEntry { category: string; weight: number; firstN?: number }
interface RawLayer {
  density: number;
  maxPerHex: number;
  scaleRange: [number, number];
  alphaRange: [number, number];
  spritePool: RawSpritePoolEntry[];
  centered?: boolean;
}
interface RawRule {
  embedded?: RawLayer;
  small?: RawLayer;
  landmark?: RawLayer;
  categoryStyle: Partial<Record<string, { tint: string }>>;
}
interface RawData {
  spriteCatalog: Record<string, RawCatalogEntry>;
  grassChunkSize: number;
  rules: Record<string, RawRule>;
}

const data = raw as RawData;

export const GRASS_CHUNK_SIZE = data.grassChunkSize;

const numKeys = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}_${String(i + 1).padStart(2, '0')}`);

// Sprite-key prefix → category. The category name IS the prefix in JSON.
// Special case: the `grass`, `flower`, `rock` prefixes map to themselves; the
// composite forest/river/sea categories also map straight from prefix. The
// downstream consumer needs DetailCategory values, which match the prefixes.
const CATEGORY_BY_PREFIX: Record<string, DetailCategory> = {
  grass: 'grass', flower: 'flower', rock: 'rock',
  tiny_pine_cluster: 'pine',
  low_shrub_cluster: 'shrub',
  dark_leaf_patch: 'leafPatch',
  dark_undergrowth: 'undergrowth',
  moss_clump: 'moss',
  fallen_needles: 'needles',
  cyan_ripple: 'ripple',
  shimmer_glint: 'shimmer',
  current_mark: 'current',
  foam_fleck: 'foam',
  depth_wisp: 'depthWisp',
  sea_shimmer: 'seaShimmer',
};

// Build flat key list for the catalog.
export const ALL_DETAIL_KEYS: string[] = Object.entries(data.spriteCatalog)
  .flatMap(([prefix, { count }]) => numKeys(prefix, count));

// prefix → asset folder lookup, built once.
const PATH_BY_PREFIX: Record<string, string> = Object.fromEntries(
  Object.entries(data.spriteCatalog).map(([prefix, { path }]) => [prefix, path]),
);

// O(prefixes) prefix-match. The prefix is everything before the final `_NN`.
const prefixOf = (key: string): string => key.replace(/_\d{2}$/, '');

export const detailAssetPath = (key: string): string => {
  const prefix = prefixOf(key);
  const path = PATH_BY_PREFIX[prefix] ?? '/details/rock';
  return `${path}/${key}.png`;
};

export const spriteCategory = (key: string): DetailCategory => {
  const prefix = prefixOf(key);
  return CATEGORY_BY_PREFIX[prefix] ?? 'grass';
};

const expandLayer = (raw: RawLayer): DetailLayerConfig => ({
  density: raw.density,
  maxPerHex: raw.maxPerHex,
  scaleRange: raw.scaleRange,
  alphaRange: raw.alphaRange,
  centered: raw.centered,
  sprites: raw.spritePool.flatMap<WeightedSprite>(({ category, weight, firstN }) => {
    const entry = data.spriteCatalog[category];
    if (!entry) throw new Error(`details.json: unknown sprite category "${category}"`);
    const count = firstN ?? entry.count;
    return numKeys(category, count).map(key => ({ key, weight }));
  }),
});

const expandRule = (raw: RawRule): TerrainDetailRules => ({
  embedded: raw.embedded ? expandLayer(raw.embedded) : undefined,
  small:    raw.small    ? expandLayer(raw.small)    : undefined,
  landmark: raw.landmark ? expandLayer(raw.landmark) : undefined,
  categoryStyle: Object.fromEntries(
    Object.entries(raw.categoryStyle).map(([cat, style]) => [cat, { tint: hexStr(style!.tint) }]),
  ) as TerrainDetailRules['categoryStyle'],
});

export const DETAIL_RULES: Record<string, TerrainDetailRules> = Object.fromEntries(
  Object.entries(data.rules).map(([terrain, rule]) => [terrain, expandRule(rule)]),
);
```

- [ ] **Step 3: Thin `src/canvas/detail-rules.ts`**

Open `src/canvas/detail-rules.ts`. Replace the deleted blocks:

Lines 1-53 (the `numKeys` helper, all `*_KEYS` arrays, `ALL_DETAIL_KEYS`, `detailAssetPath`) — DELETE.

Replace with a re-export from the data wrapper at the top of the file (after any necessary type imports):
```ts
export {
  ALL_DETAIL_KEYS,
  detailAssetPath,
  GRASS_CHUNK_SIZE,
  spriteCategory,
  DETAIL_RULES,
} from '../data/details';
```

Lines 55-89 (the `WeightedSprite`, `DetailLayerConfig`, `CategoryStyle`, `TerrainDetailRules`, `DetailCategory` interfaces/types) — KEEP. The data wrapper imports these names back.

Lines 95-207 (the `DETAIL_RULES` const literal) — DELETE.

Line 209-225 (the `spriteCategory` function) — DELETE.

Lines 227-244 (`pickWeighted`, `seededRandom`, `getHexSeed`) — KEEP. These are pure logic.

Lines 246-256 (`grassChunkPatch`) — KEEP. It uses `GRASS_CHUNK_SIZE` which is now imported.

After the edit, `src/canvas/detail-rules.ts` should be roughly half its current size: the type interfaces + four utility functions + a single re-export block at the top.

- [ ] **Step 4: Build and lint**

Run: `npm run build`
Expected: PASS. If `noUnusedLocals` fires on any of the interface types in `detail-rules.ts`, confirm they are exported (they were originally) — the export keeps them in use.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Visual sanity check (the gate for this task)**

Open the dev server. Regenerate the world. Walk through each terrain type and visually compare to a pre-task snapshot if available, or just verify:
- GRASSLAND has dense grass/flower scatter, plus occasional rocks at small/landmark layers.
- HILL has very sparse grass + rocks + occasional flowers, all faded (alpha 0.22-0.45).
- FOREST has pine clusters dominant, with shrubs, leaf patches, undergrowth, moss, and needles at decreasing density.
- RIVER has cyan ripples dominant with shimmer/current/foam/depth-wisp scatter.
- SEA has very faint sea-shimmer details (alpha 0.18-0.36).
- No console errors about "unknown sprite category" — that's the wrapper's safeguard.
- No "missing PNG" requests in the browser network tab.

If anything looks off (e.g. a sprite category is missing or a tint changed), check the JSON entry against the original `DETAIL_RULES` table for that terrain.

- [ ] **Step 6: Commit**

```bash
git add src/data/details.json src/data/details.ts src/canvas/detail-rules.ts
git commit -m "$(cat <<'EOF'
Extract sprite catalog and scatter rules to src/data/details.json

The sprite catalog (categories + counts + asset paths) and the per-terrain
scatter rules (density, scale, alpha, weighted pools) move to JSON. Pools
use a compact {category, weight, firstN?} form; the wrapper expands them
to flat per-key entries using numKeys() at boot. spriteCategory and
detailAssetPath are now table-driven from the catalog, replacing the chain
of startsWith checks. Adding a new sprite asset is now a one-line catalog
edit instead of TS code changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Cleanup and CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` (add `## Data files` section)

This task does NOT remove the legacy-shape exports from the wrappers. They are part of the API surface; removing them is a separate decision (out of scope per spec). Leave them in place.

- [ ] **Step 1: Update CLAUDE.md**

Open `CLAUDE.md`. Insert a new section after the existing `## Architecture` section and before `## Worktree note`:

```markdown
## Data files

All balance- and content-tunable values live in `src/data/`. Each `.json` file is paired with a `.ts` wrapper that owns the type declaration and any boot-time transformation (hex-color parsing, sprite-pool expansion). Consumers import from the `.ts`, never from the `.json` directly.

- `combat.json` / `combat.ts` — `DAMAGE_PER_TICK`, charge (`durationTicks`, `impactRange`), hold (`reductionPerTick`, `reductionCap`, `autoIdleAfterTicks`), `UNLEASH_MAX_ENGAGERS`, height bonus (`bonusPerUnit`, `bonusCap`).
- `units.json` / `units.ts` — per-unitType `maxHp`, `marchSpeed`, `chargeSpeed`, `chargeImpactDamage`, plus skirmisher-only `missileRange`, `missileDamage`, `kiteThreshold`.
- `terrain.json` / `terrain.ts` (canvas) + `terrain-mods.ts` (sim) — single source for both visual (`color`, `label`, `height`, `walkable`) and mechanical fields (`defenseMult`, `moveCost`, `attritionPerTick`, `visionRadius`). Two wrappers project different views so `src/battle/` does not import canvas.
- `game.json` / `game.ts` — `TICK_MS`, `LOD_THRESHOLD`, `DRAG_THRESHOLD_PX`, deploy zone fraction, retreat refund, initial roster, cohort size, capture (`ticksToWin`, `center`), team tints, formation cycle/labels, heading arrows.
- `world-gen.json` / `world-gen.ts` — `bucket` thresholds (deepSeaMult, sandOffset, forestMult, hillMult, mountainOffset), falloff (intercept, exponent), `STRATEGIC_RESOLUTION`, `DIVE_ZOOM`, `GRID_RADIUS`, default `GenSettings`.
- `details.json` / `details.ts` — sprite catalog (categories, counts, asset paths) and per-terrain scatter rules. Pools use compact `{category, weight, firstN?}` form; the wrapper expands to flat per-key entries.

**Adding a new tunable:** add the field to the JSON, declare it in the wrapper's `interface`, and re-export. If a consumer wants the legacy `UPPER_SNAKE_CASE` symbol shape, derive it in the wrapper (see e.g. `units.ts` for the pattern).

**What stays inline (not in JSON):** pure math constants (hash multipliers `73856093`/`19349663`, `Math.sin(seed) * 10000`), structural playfield geometry (`TACTICAL_HALF_W/H`, `TACTICAL_BBOX_*`), and noise-mixing weights (`0.4 * noise(nx * 2.2, ny * 2.2)`). These are program structure, not balance.

**Regression scripts:** `scripts/snapshot-worldgen.ts` dumps `gridData` for a fixed mulberry32 seed; run before/after any world-gen change and diff to confirm value-preservation. The headless battle harness (`npm run sim`) gates any change to `combat`, `units`, or `terrain` JSON.
```

- [ ] **Step 2: Confirm build, lint, sim, and visual are all still green**

Run: `npm run build && npm run lint && npm run sim`
Expected: all PASS, sim output matches baseline.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Document the src/data/ JSON-config layout in CLAUDE.md

Adds a Data files section explaining the per-domain JSON layout, the
JSON/TS wrapper pattern, what stays inline vs gets extracted, and the
regression scripts (sim harness, world-gen snapshot) that gate changes
to each file.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Summary

- **Spec coverage:** Each of the six JSON files in the spec has a task (1, 2, 3, 4, 5, 6). The split canvas/sim wrappers for terrain are explicit in Task 3. The legacy-shape exports pattern is implemented in every wrapper. The snapshot-script gate for world-gen is implemented in Task 5. The CLAUDE.md update is Task 7.
- **Placeholders:** Default `genSettings` values were placeholders in the spec; the plan reads the current values from `GameCanvas.tsx:131-136` (`waterLevel: 0.4`, `mountainLevel: 0.85`) and embeds them in `world-gen.json`. No remaining TBDs.
- **Type consistency:** `UnitConfig`, `CombatConfig`, `GameConfig`, `WorldGenConfig`, and the `RawTerrainEntry`/`RawCatalogEntry`/`RawSpritePoolEntry`/`RawLayer`/`RawRule` interface families are each defined exactly once in their owning wrapper. Identifier casing matches between JSON keys (camelCase) and TypeScript fields. Legacy `UPPER_SNAKE_CASE` exports preserve the existing symbol names with no spelling drift.
- **Validation:** Every sim-touching task (1, 2, 3) has a baseline-diff step. World-gen has its own snapshot tool. Canvas-only tasks (4, 6) rely on visual sanity, which is mandatory per step.
