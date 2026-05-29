# Hex-Grid Generation & Painting Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bugs and quirks found in the deep review of hex generation (`world-gen.ts`), hex math (`HexUtils.ts`) and terrain painting (`drawTerrain.ts`), with regression coverage where the toolchain allows.

**Architecture:** Pure functions throughout. World generation is a deterministic pipeline (elevation → cohesion → rivers) verified by the existing JSON-Lines snapshot (`scripts/snapshot-worldgen.ts`) and the assertion harness (`scripts/test-worldgen.ts`). Hex math is verified by a new assertion harness. Rendering changes (`drawTerrain.ts`) have no headless test harness and are gated on `tsc` + ESLint, with visual verification deferred to the user.

**Tech Stack:** TypeScript, Vite, PIXI.js v8, `tsx` (assertion scripts run via `npx tsx`), `node:assert/strict`.

**Branch:** All work lands on `feature/hexgrid-fixes` (cut from `feature/presentation`). **Do not merge to `master` or `feature/presentation`** — leave the branch for the user to review. **Do not remove this worktree.**

**Verification commands (Windows / PowerShell):**
- Build: `npm run build`
- Lint: `npm run lint`
- Worldgen assertions: `npx tsx scripts/test-worldgen.ts`
- Hexutils assertions: `npx tsx scripts/test-hexutils.ts`
- Formation regression: `npx tsx scripts/sim-formations.ts`
- Worldgen snapshot: `npx tsx scripts/snapshot-worldgen.ts | Out-File -Encoding utf8 <path>`

**Snapshot discipline for the worldgen tasks (1, 2, 3):** Each worldgen task changes river output, so re-snapshot and diff against the **previous task's** snapshot, not the original. Baselines live in `docs/nightly/hexgrid-snaps/` (gitignored scratch — create the dir, do not commit the dumps).

---

## File map

| File | Responsibility | Tasks |
|------|----------------|-------|
| `src/canvas/world-gen.ts` | Generation pipeline; river pass | 1, 2, 3, 6 |
| `src/hex-engine/HexUtils.ts` | `hexLine` epsilon nudge | 4 |
| `scripts/test-worldgen.ts` | Add `canThickenToRiver` + invariant assertions | 1 |
| `scripts/test-hexutils.ts` | **New** — hexLine property/regression tests | 4 |
| `package.json` | Wire `test:worldgen`, `test:hexutils` scripts | 1, 4 |
| `CLAUDE.md` | Correct stale Pass-1/Pass-2 wall description | 6 |
| `src/canvas/render/drawTerrain.ts` | Z-order of earth/water cliff faces | 5 |

---

## Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the working branch off the current presentation HEAD**

```powershell
git checkout -b feature/hexgrid-fixes
git status -sb
```
Expected: `## feature/hexgrid-fixes` and a working tree that still shows the pre-existing `M src/canvas/render/drawTerrain.ts` change (the user's WIP water-depth blend — leave it untouched; it gets committed as part of Task 5's file or stashed if it conflicts; see Task 5 note).

- [ ] **Step 2: Create the gitignored snapshot scratch dir and capture the ORIGINAL baseline**

```powershell
New-Item -ItemType Directory -Force docs/nightly/hexgrid-snaps
npx tsx scripts/snapshot-worldgen.ts | Out-File -Encoding utf8 docs/nightly/hexgrid-snaps/00-original.txt
(Get-Content docs/nightly/hexgrid-snaps/00-original.txt | Measure-Object -Line).Lines
```
Expected: a non-zero line count (thousands of lines). Confirm `docs/nightly/` is gitignored (`git status` should NOT list the snap files; `.worktrees/` and `.playwright-mcp/` are gitignored, and `docs/nightly/` diagnostics are committed elsewhere — if `git status` shows the snap files, add `docs/nightly/hexgrid-snaps/` to `.git/info/exclude`).

---

## Task 1: River thickening must not flood water/beach tiles

**Bug:** In TACTICAL view, river thickening (`world-gen.ts`) converts *any* in-map neighbour to `RIVER` — including `SEA`/`DEEP_SEA`/`SAND`. Because `RIVER` is `walkable: true` and `SEA`/`DEEP_SEA` are `walkable: false`, and `isWalkable` is consulted by `simulateTick` (`useBattleTick.ts:120-123`), this drops **walkable tiles into open water** — a gameplay bug, not just cosmetic.

**Files:**
- Modify: `src/canvas/world-gen.ts` (add predicate near top; edit thickening loop ~`:179-184`)
- Test: `scripts/test-worldgen.ts`
- Modify: `package.json` (wire `test:worldgen`)

- [ ] **Step 1: Wire the `test:worldgen` npm script**

In `package.json` `scripts`, add after `"test:follower"`:
```json
    "test:worldgen": "tsx scripts/test-worldgen.ts",
```

- [ ] **Step 2: Confirm the existing worldgen suite passes (baseline green)**

Run: `npx tsx scripts/test-worldgen.ts`
Expected: `all worldgen tests passed`

- [ ] **Step 3: Write the failing test for the new predicate**

At the END of `scripts/test-worldgen.ts`, BEFORE the final `console.log(...)` line, add:
```ts
// river thickening predicate: never flood water or beach into walkable river
{
  assert.equal(canThickenToRiver('SEA'), false, 'SEA stays sea');
  assert.equal(canThickenToRiver('DEEP_SEA'), false, 'DEEP_SEA stays deep sea');
  assert.equal(canThickenToRiver('SAND'), false, 'SAND beach not flooded');
  assert.equal(canThickenToRiver('GRASSLAND'), true, 'land can thicken');
  assert.equal(canThickenToRiver('FOREST'), true, 'land can thicken');
  assert.equal(canThickenToRiver('MOUNTAIN'), true, 'land can thicken');
  assert.equal(canThickenToRiver('RIVER'), true, 'river stays river');
}

// integration: no RIVER hex is fully enclosed by open water (would imply a flooded sea tile)
{
  const water = new Set(['SEA', 'DEEP_SEA']);
  for (let seed = 1; seed <= 12; seed++) {
    const grid = generateWorldData({
      settings: { mapType: 'island', seed, noiseOffset: { q: 7 * 4.5, r: -3 * 4.5 }, resolution: STRATEGIC_RESOLUTION / 4.5 },
      gridRadius: GRID_RADIUS,
      viewMode: 'TACTICAL',
    }).gridData;
    const typeAt = new Map(grid.map(d => [`${d.hex.q},${d.hex.r}`, d.type]));
    for (const d of grid) {
      if (d.type !== 'RIVER') continue;
      const nbrs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]
        .map(([dq,dr]) => typeAt.get(`${d.hex.q+dq},${d.hex.r+dr}`))
        .filter((t): t is string => t !== undefined);
      const allWater = nbrs.length > 0 && nbrs.every(t => water.has(t));
      assert.ok(!allWater, `RIVER hex ${d.hex.q},${d.hex.r} (seed ${seed}) is surrounded by open water`);
    }
  }
}
```
Add the import to the top of the file (extend the existing import from `../src/canvas/world-gen`):
```ts
import { generateWorldData, resolveMapType, canThickenToRiver } from '../src/canvas/world-gen';
```
(`STRATEGIC_RESOLUTION` and `GRID_RADIUS` are already imported.)

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx tsx scripts/test-worldgen.ts`
Expected: FAIL — a `SyntaxError`/`undefined` for `canThickenToRiver` (it doesn't exist yet). This is the red state.

- [ ] **Step 5: Add the predicate and wire it into the thickening loop**

In `src/canvas/world-gen.ts`, add near the other module constants (after the `*_SALT` block, ~`:48`):
```ts
// Tactical river thickening must never convert water or beach into walkable river —
// RIVER is walkable while SEA/DEEP_SEA are not, so flooding them creates passable
// "bridges" across open water (the sim consults isWalkable per hex).
export const canThickenToRiver = (type: string): boolean =>
  type !== 'SEA' && type !== 'DEEP_SEA' && type !== 'SAND';
```

Replace the thickening block (currently ~`:179-184`):
```ts
      // Rivers thicken in TACTICAL view so they're walkable but visually substantial.
      if (viewMode === 'TACTICAL') {
        HexUtils.getNeighbors(curr).forEach(n => {
          if (smoothedMap.has(HexUtils.key(n)) && riverRng() > 0.3) smoothedMap.set(HexUtils.key(n), 'RIVER');
        });
      }
```
with (note: the `riverRng()` draw is kept unconditional-per-in-map-neighbour to preserve the RNG sequence, so the snapshot diff is limited to un-flooded water/sand):
```ts
      // Rivers thicken in TACTICAL view so they're walkable but visually substantial.
      if (viewMode === 'TACTICAL') {
        HexUtils.getNeighbors(curr).forEach(n => {
          const nk = HexUtils.key(n);
          if (!smoothedMap.has(nk)) return;
          const roll = riverRng() > 0.3; // drawn unconditionally to preserve RNG order
          if (roll && canThickenToRiver(smoothedMap.get(nk)!)) smoothedMap.set(nk, 'RIVER');
        });
      }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx scripts/test-worldgen.ts`
Expected: `all worldgen tests passed`

- [ ] **Step 7: Snapshot-diff to confirm a minimal, correct change**

```powershell
npx tsx scripts/snapshot-worldgen.ts | Out-File -Encoding utf8 docs/nightly/hexgrid-snaps/01-river-flood.txt
Compare-Object (Get-Content docs/nightly/hexgrid-snaps/00-original.txt) (Get-Content docs/nightly/hexgrid-snaps/01-river-flood.txt) | Select-Object -First 40
```
Expected: ONLY `TACTICAL:*` lines change, and every change is a hex going FROM `RIVER` TO `SEA`/`DEEP_SEA`/`SAND` (i.e. the original snapshot had `RIVER` where the new one has water/sand). Zero `STRATEGIC:*` changes. If any other terrain type changes, the RNG order was disturbed — STOP and re-check Step 5.

- [ ] **Step 8: Build + lint**

Run: `npm run build`  →  Expected: completes, no type errors.
Run: `npm run lint`  →  Expected: no errors.

- [ ] **Step 9: Commit**

```powershell
git add src/canvas/world-gen.ts scripts/test-worldgen.ts package.json
git commit -m @'
fix(worldgen): river thickening no longer floods water/beach tiles

Tactical river thickening converted any neighbour to RIVER, including
SEA/DEEP_SEA/SAND. RIVER is walkable and the sim consults isWalkable, so
this created passable bridges across open water. Skip water/beach via
canThickenToRiver; RNG draw order preserved so only flooded hexes change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: River sources picked without replacement

**Quirk:** River sources are sampled WITH replacement (`world-gen.ts:166`), so the same MOUNTAIN/HILL/SNOW hex can seed multiple rivers (and a source already converted to RIVER can be re-picked), yielding fewer than `riverCount` distinct rivers.

**Files:**
- Modify: `src/canvas/world-gen.ts` (river source loop ~`:164-166`)

- [ ] **Step 1: Switch source selection to sample without replacement**

Replace (currently ~`:164-166`):
```ts
  for (let i = 0; i < riverCount; i++) {
    if (starts.length === 0) break;
    let curr = starts[Math.floor(riverRng() * starts.length)];
```
with:
```ts
  for (let i = 0; i < riverCount; i++) {
    if (starts.length === 0) break;
    const startIdx = Math.floor(riverRng() * starts.length);
    let curr = starts.splice(startIdx, 1)[0]; // without replacement: distinct sources
```
(The `riverRng()` draw count is unchanged — one per river — so the FIRST source is identical; later sources differ because the pool shrinks. `curr` must stay `let`: it is reassigned during descent.)

- [ ] **Step 2: Confirm determinism + invariants still hold**

Run: `npx tsx scripts/test-worldgen.ts`
Expected: `all worldgen tests passed` (the "same seed → identical map" assertion still holds; the Task 1 flood invariant still holds).

- [ ] **Step 3: Snapshot-diff against Task 1's snapshot**

```powershell
npx tsx scripts/snapshot-worldgen.ts | Out-File -Encoding utf8 docs/nightly/hexgrid-snaps/02-river-sources.txt
(Compare-Object (Get-Content docs/nightly/hexgrid-snaps/01-river-flood.txt) (Get-Content docs/nightly/hexgrid-snaps/02-river-sources.txt)).Count
```
Expected: a non-zero count (river paths differ, both views). Spot-check a handful: changes should be `RIVER`↔(land/water) flips consistent with different river courses — no archetype should lose all its land or turn entirely to one type.

- [ ] **Step 4: Build + lint**

Run: `npm run build`  →  Expected: no type errors.
Run: `npm run lint`  →  Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add src/canvas/world-gen.ts
git commit -m @'
fix(worldgen): pick river sources without replacement

Sources were sampled with replacement, so one peak could seed several
rivers (or a source already turned to RIVER could be re-picked), giving
fewer distinct rivers than riverCount. Splice the chosen source out.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: Rivers stop in basins instead of climbing uphill

**Quirk:** The river walk picks the lowest *neighbour* unconditionally — even when it is higher than the current hex — so in a closed basin a river climbs the least-high ridge instead of pooling. Add a guard: stop when the lowest neighbour is not strictly lower than the current hex.

**Files:**
- Modify: `src/canvas/world-gen.ts` (descent step ~`:186-189`)

- [ ] **Step 1: Add the downhill guard**

Replace (currently ~`:186-189`):
```ts
      const neighbors = HexUtils.getNeighbors(curr).filter(n => smoothedMap.has(HexUtils.key(n)));
      if (neighbors.length === 0) break;
      const next = neighbors.sort((a, b) => (elevationCache.get(HexUtils.key(a))||0) - (elevationCache.get(HexUtils.key(b))||0))[0];
      curr = next;
```
with:
```ts
      const neighbors = HexUtils.getNeighbors(curr).filter(n => smoothedMap.has(HexUtils.key(n)));
      if (neighbors.length === 0) break;
      const next = neighbors.sort((a, b) => (elevationCache.get(HexUtils.key(a))||0) - (elevationCache.get(HexUtils.key(b))||0))[0];
      // Rivers flow downhill: stop pooling in a basin rather than climbing the lowest ridge.
      const currElev = elevationCache.get(k) ?? Infinity;
      const nextElev = elevationCache.get(HexUtils.key(next)) ?? Infinity;
      if (nextElev >= currElev) break;
      curr = next;
```
(`k` is the current hex key already computed at the top of the loop body, ~`:171`.)

- [ ] **Step 2: Confirm tests still pass**

Run: `npx tsx scripts/test-worldgen.ts`
Expected: `all worldgen tests passed`.

- [ ] **Step 3: Snapshot-diff against Task 2's snapshot**

```powershell
npx tsx scripts/snapshot-worldgen.ts | Out-File -Encoding utf8 docs/nightly/hexgrid-snaps/03-river-basin.txt
(Compare-Object (Get-Content docs/nightly/hexgrid-snaps/02-river-sources.txt) (Get-Content docs/nightly/hexgrid-snaps/03-river-basin.txt)).Count
```
Expected: a SMALL non-zero count (only closed-basin rivers shorten; most rivers already descend to the coast and are unaffected). All changes are `RIVER` → (its underlying land/water type).

- [ ] **Step 4: Build + lint**

Run: `npm run build`  →  Expected: no type errors.
Run: `npm run lint`  →  Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add src/canvas/world-gen.ts
git commit -m @'
fix(worldgen): rivers stop in basins instead of climbing uphill

The descent always took the lowest neighbour even when it was higher than
the current hex, so basin rivers crawled up the least-high ridge. Break
when the lowest neighbour is not strictly lower.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: `hexLine` epsilon nudge + property regression test

**Issue:** `hexLine` (`HexUtils.ts:100`) lerps without the Red Blob "epsilon" nudge, so a sample landing exactly on a hex boundary rounds ambiguously and direction-dependently. `hexLine` builds rigid formation blocks in `simulate.ts` (`:497, :572-573, :591, :604`) and movement traces in `followerPath.ts:33`, so inconsistent lines can produce lopsided ranks. The nudge is tiny (1e-6); most integer-endpoint lines are unaffected, so formation drift should be minimal — but it touches combat geometry, so **run the formation regression and report any drift.**

**Files:**
- Modify: `src/hex-engine/HexUtils.ts` (`hexLine`, `:100-112`)
- Test: `scripts/test-hexutils.ts` (**new**)
- Modify: `package.json` (wire `test:hexutils`)

- [ ] **Step 1: Wire the `test:hexutils` npm script**

In `package.json` `scripts`, add after `"test:worldgen"`:
```json
    "test:hexutils": "tsx scripts/test-hexutils.ts",
```

- [ ] **Step 2: Write the property/regression test**

Create `scripts/test-hexutils.ts`:
```ts
import assert from 'node:assert/strict';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';

// hexLine: endpoints exact, length == distance+1, consecutive adjacency, no duplicates
{
  const pairs: [Hex, Hex][] = [
    [{ q: 0, r: 0 }, { q: 3, r: 0 }],
    [{ q: 0, r: 0 }, { q: 0, r: 3 }],
    [{ q: 0, r: 0 }, { q: 3, r: -3 }],
    [{ q: 0, r: 0 }, { q: -2, r: 5 }],
    [{ q: 1, r: 1 }, { q: 4, r: -2 }],
    [{ q: -3, r: 2 }, { q: 5, r: -1 }],
    [{ q: 0, r: 0 }, { q: 6, r: -3 }],
    [{ q: 2, r: -4 }, { q: -3, r: 6 }],
  ];
  for (const [a, b] of pairs) {
    const line = HexUtils.hexLine(a, b);
    const d = HexUtils.distance(a, b);
    const tag = `${a.q},${a.r}->${b.q},${b.r}`;
    assert.equal(line.length, d + 1, `length == distance+1 (${tag})`);
    assert.deepEqual(line[0], a, `starts at a (${tag})`);
    assert.deepEqual(line[line.length - 1], b, `ends at b (${tag})`);
    const seen = new Set<string>();
    for (let i = 0; i < line.length; i++) {
      const key = HexUtils.key(line[i]);
      assert.ok(!seen.has(key), `no duplicate hex (${tag})`);
      seen.add(key);
      if (i > 0) assert.equal(HexUtils.distance(line[i - 1], line[i]), 1, `consecutive adjacency (${tag})`);
    }
  }
}

// direction symmetry: line(a,b) reversed equals line(b,a)
{
  const cases: [Hex, Hex][] = [
    [{ q: 0, r: 0 }, { q: 4, r: -2 }],
    [{ q: -2, r: 3 }, { q: 5, r: -4 }],
    [{ q: 1, r: 1 }, { q: -3, r: 4 }],
  ];
  for (const [a, b] of cases) {
    const fwd = HexUtils.hexLine(a, b).map(HexUtils.key);
    const rev = HexUtils.hexLine(b, a).map(HexUtils.key).reverse();
    assert.deepEqual(fwd, rev, `hexLine direction-symmetric (${a.q},${a.r}<->${b.q},${b.r})`);
  }
}

console.log('all hexutils tests passed');
```

- [ ] **Step 3: Run the test against the CURRENT implementation**

Run: `npx tsx scripts/test-hexutils.ts`
Expected: it either FAILS on a symmetry case (red — the nudge fixes it) OR passes (the chosen lines happen to be unaffected). **Record which.** Either way proceed: the test is the regression lock and the nudge is the correctness hardening.

- [ ] **Step 4: Add the epsilon nudge**

Replace `hexLine` (`HexUtils.ts:100-112`):
```ts
  static hexLine(a: Hex, b: Hex): Hex[] {
    const n = this.distance(a, b);
    if (n === 0) return [a];
    const result: Hex[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      result.push(this.hexRound({
        q: a.q * (1 - t) + b.q * t,
        r: a.r * (1 - t) + b.r * t,
      }));
    }
    return result;
  }
```
with:
```ts
  static hexLine(a: Hex, b: Hex): Hex[] {
    const n = this.distance(a, b);
    if (n === 0) return [a];
    // Red Blob "epsilon" nudge: shift both endpoints off exact hex boundaries (in cube
    // space q+e, r+e, s-2e) so a sample landing on an edge rounds consistently instead
    // of direction-dependently. eps is tiny — integer endpoints still round to a and b.
    const eps = 1e-6;
    const aq = a.q + eps, ar = a.r + eps;
    const bq = b.q + eps, br = b.r + eps;
    const result: Hex[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      result.push(this.hexRound({
        q: aq * (1 - t) + bq * t,
        r: ar * (1 - t) + br * t,
      }));
    }
    return result;
  }
```

- [ ] **Step 5: Run the hexutils test to verify it passes**

Run: `npx tsx scripts/test-hexutils.ts`
Expected: `all hexutils tests passed`.

- [ ] **Step 6: Run the formation regression and report drift**

Run: `npx tsx scripts/sim-formations.ts`
Expected: completes and prints per-scenario results. Compare against the description in the script header / known-good output. **If any scenario's outcome shifts, do NOT treat it as a failure — record the before/after in the commit body and the final report so the user can sign off.** If the harness throws or a scenario errors out, STOP and report.

- [ ] **Step 7: Build + lint**

Run: `npm run build`  →  Expected: no type errors.
Run: `npm run lint`  →  Expected: no errors.

- [ ] **Step 8: Commit**

```powershell
git add src/hex-engine/HexUtils.ts scripts/test-hexutils.ts package.json
git commit -m @'
fix(hex): epsilon-nudge hexLine to avoid ambiguous boundary rounding

hexLine lerped without the Red Blob epsilon, so samples landing exactly on
a hex edge rounded direction-dependently — lopsided formation ranks built
via hexLine in simulate.ts. Nudge both endpoints by 1e-6; add a property
regression test (length, endpoints, adjacency, no-dups, direction symmetry).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: Earth/water cliff faces drawn in height order (no over-paint of taller biomes)

**Bug:** `seaDepthBlend`, `riverSeaCliffs`, `grassEarthCliffs`, and `forestEarthCliffs` are `addChild`-ed to `overlay` AFTER the height-sorted layer loop (which already added MOUNTAIN/SNOW). In the 2.5D view a short biome's south cliff face can paint over a taller MOUNTAIN/SNOW hex in front of it. Fix: emit each special-cliff Graphics right after its biome's base layer inside the height-ordered loop, via an `afterLayer` hook, so it sits between its biome and the next-taller one.

**Note on the pre-existing WIP:** `seaDepthBlend` is the user's uncommitted water-depth blend in the working tree. This task relocates that block into the loop. Treat the current `drawTerrain.ts` working-tree content as the source of truth and refactor it in place; the resulting commit will include the user's WIP blend (now correctly z-ordered). Do not revert their alpha tweaks.

**Files:**
- Modify: `src/canvas/render/drawTerrain.ts`

**Verification:** No headless render harness exists. Gate on `tsc` + ESLint. Attempt a Playwright before/after screenshot (best-effort); if the dev server / browser cannot be driven, commit anyway (branch is for review) and mark **VISUAL UNVERIFIED** in the report.

- [ ] **Step 1: Add the `afterLayer` hook to the `OverlayLayer` interface**

In the `OverlayLayer` interface (~`:149-165`), add after the `waterFilter?` field:
```ts
    /** Emitted to `overlay` immediately after this layer (in height order) — used for
     *  height-specific cliff/blend faces so they don't over-paint taller biomes. */
    afterLayer?: () => PIXI.Graphics;
```

- [ ] **Step 2: Extract the four end-of-function passes into builder functions**

Define these builders ABOVE the `globalUvOverlays` array (after `isSeaNotNextToSand`, ~`:171`). Move the bodies VERBATIM from the current end-of-function blocks (`seaDepthBlend` ~`:528-555`, `riverSeaCliffs` ~`:557-585`, `grassEarthCliffs` ~`:586-612`, `forestEarthCliffs` ~`:613-639`), wrapping each in a function that returns the `PIXI.Graphics` it builds. Each builder must declare its own `waterBlendEdges`/`cliffEdges` local exactly as the moved code uses (note `cliffEdges` is defined later at `:385`; the builders need their own local copy of `[[1,2,5],[0,1,0],[2,3,4]]`). Template (fill bodies from the moved code):
```ts
  const buildSeaDepthBlend = (): PIXI.Graphics => {
    const g = new PIXI.Graphics();
    const waterBlendEdges: [number, number, number][] = [
      [5, 0, 1], [0, 1, 0], [1, 2, 5], [2, 3, 4], [3, 4, 3], [4, 5, 2],
    ];
    // ...body of the current seaDepthBlend loop, writing to `g` instead of `seaDepthBlend`...
    return g;
  };
  const cliffEdgesLocal: [number, number, number][] = [[1, 2, 5], [0, 1, 0], [2, 3, 4]];
  const buildRiverSeaCliffs = (): PIXI.Graphics => {
    const g = new PIXI.Graphics();
    // ...body of the current riverSeaCliffs loop (uses cliffEdgesLocal), writing to `g`...
    return g;
  };
  const buildGrassEarthCliffs = (): PIXI.Graphics => {
    const g = new PIXI.Graphics();
    // ...body of the current grassEarthCliffs loop (uses cliffEdgesLocal), writing to `g`...
    return g;
  };
  const buildForestEarthCliffs = (): PIXI.Graphics => {
    const g = new PIXI.Graphics();
    // ...body of the current forestEarthCliffs loop (uses cliffEdgesLocal), writing to `g`...
    return g;
  };
```

- [ ] **Step 3: Attach each builder to its biome's BASE layer**

In `globalUvOverlays`, add the matching `afterLayer` to the base (first, un-filtered) layer of each biome:
- base SEA layer (`type:'SEA'`, `texture: ctx.seaTex`, ~`:184`): add `afterLayer: buildSeaDepthBlend,`
- base RIVER layer (`{ type: 'RIVER', texture: ctx.riverTex, ... }`, ~`:233`): add `afterLayer: buildRiverSeaCliffs,`
- base GRASSLAND layer (`{ type: 'GRASSLAND', texture: ctx.grassTex, ... }`, ~`:266`): add `afterLayer: buildGrassEarthCliffs,`
- base FOREST layer (`{ type: 'FOREST', texture: ctx.forestTex, ... }`, ~`:304`): add `afterLayer: buildForestEarthCliffs,`

Attaching to the base layer (always present when the biome exists) means the cliffs render just above the biome's base texture and below any taller biome. The biome's own decoration layers are top-only masks and never touch the cliff-face region, so they do not cover these faces.

- [ ] **Step 4: Invoke `afterLayer` inside the loop**

At the END of the `for (const layer of globalUvOverlays)` body, AFTER `layerContainer.mask = mask;` (~`:523`), add:
```ts
    if (layer.afterLayer) overlay.addChild(layer.afterLayer());
```
The base layers have a texture and a non-empty hex set, so the loop does not `continue` past them before this line.

- [ ] **Step 5: Delete the four relocated end-of-function blocks**

Remove the now-duplicated trailing blocks: the `seaDepthBlend` block and its `overlay.addChild(seaDepthBlend)`, the `riverSeaCliffs` block + add, the `grassEarthCliffs` block + add, the `forestEarthCliffs` block + add (everything from the `// SEA <-> DEEP_SEA depth transition.` comment through `overlay.addChild(forestEarthCliffs);`). The deploy-zone / capture-zone / grid sections below them stay.

- [ ] **Step 6: Build + lint**

Run: `npm run build`  →  Expected: no type errors (watch for an unused `cliffEdges` or duplicate-declaration error — the later `cliffEdges` at the mask loop is still used there; the builders use `cliffEdgesLocal`).
Run: `npm run lint`  →  Expected: no errors (no unused vars).

- [ ] **Step 7: Best-effort visual verification (Playwright)**

If feasible: start the dev server (`npm run dev -- --port 5174`), navigate Playwright to `http://localhost:5174`, dive into a TACTICAL map with adjacent water + tall terrain, screenshot. Compare against a screenshot taken from `feature/presentation` (pre-change). Confirm cliff faces look the same or better and no biome texture vanished. If the browser/server cannot be driven, SKIP and mark **VISUAL UNVERIFIED** in the report. Do not block the commit on this.

- [ ] **Step 8: Commit**

```powershell
git add src/canvas/render/drawTerrain.ts
git commit -m @'
fix(render): draw earth/water cliff faces in height order

seaDepthBlend, river/grass/forest cliff faces were appended after the
height-sorted layer loop, so a short biome's south cliff could paint over a
taller mountain/snow hex in front of it. Emit each via an afterLayer hook
right after its biome base layer, between it and the next-taller biome.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: Documentation corrections

**Issues:** (a) `CLAUDE.md` Pass-1 description claims walls are drawn for `SAND, RIVER, SEA, DEEP_SEA, ROCKY`, but the code (`isTexturedBiome`, `drawTerrain.ts:71-72,132`) draws Pass-1 walls only for `SAND` and `ROCKY` — RIVER/SEA/DEEP_SEA are textured and get cliffs elsewhere. (b) The cohesion comment in `world-gen.ts` oversells ("Remove single-hex noise"). (c) `ROCKY` is never produced by `bucket()` — it is paint-mode-only, which is undocumented.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/canvas/world-gen.ts`

- [ ] **Step 1: Fix the CLAUDE.md Pass-1 wall list**

In `CLAUDE.md`, in the "Rendering pipeline" section, find the Pass-1 sentence containing:
> Walls are drawn **only for non-textured biomes** (`SAND`, `RIVER`, `SEA`, `DEEP_SEA`, `ROCKY`); textured biomes get their cliff faces from Pass 2 instead.

Replace that sentence with:
> Walls are drawn **only for the non-textured biomes** `SAND` and `ROCKY` (`isTexturedBiome` in `drawTerrain.ts`); `RIVER`/`SEA`/`DEEP_SEA` are textured and get their cliff faces from the filtered water parents and dedicated cliff passes, and the other textured land biomes get theirs from Pass 2.

- [ ] **Step 2: Fix the cohesion comment**

In `src/canvas/world-gen.ts`, replace the comment (~`:144`):
```ts
  // 2. Cohesion Pass: Remove single-hex noise
```
with:
```ts
  // 2. Cohesion Pass: snap a hex to its neighbours' majority type when >3 of 6 agree.
  //    Smooths isolated specks and ragged biome edges (not only single-hex islands).
```

- [ ] **Step 3: Document ROCKY as paint-only**

In `src/canvas/world-gen.ts`, immediately above the `const bucket = (e: number): string => {` line (~`:90`), add:
```ts
  // Note: bucketing never emits ROCKY — it exists only as a paint-mode terrain.
```

- [ ] **Step 4: Build (docs change to a .ts comment shouldn't break, but verify)**

Run: `npm run build`  →  Expected: no type errors.

- [ ] **Step 5: Commit**

```powershell
git add CLAUDE.md src/canvas/world-gen.ts
git commit -m @'
docs: correct stale wall list, cohesion comment, note ROCKY is paint-only

CLAUDE.md claimed Pass-1 walls cover SAND/RIVER/SEA/DEEP_SEA/ROCKY; the code
draws them only for SAND and ROCKY. Reword the cohesion comment (it smooths
edges, not just single specks) and note that bucketing never emits ROCKY.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Deferred (NOT in this plan — recorded for the user)

- **drawTerrain `byType` index (#9 in review):** `drawTerrain` rescans `gridData` ~30× per regen. Output-preserving perf refactor; deferred because it conflicts with Task 5 in the same file and `drawTerrain` is not on the per-frame path.
- **Integer-packed hex keys (#10):** replacing `HexUtils.key` string allocation with a packed int touches the whole codebase; marginal at radius 35.

---

## Self-Review

**Spec coverage** (against the deep-review findings):
- #1 river floods water → Task 1 ✓
- #2 z-order of cliffs → Task 5 ✓
- #3 hexLine epsilon → Task 4 ✓
- #4 rivers uphill → Task 3 ✓
- #5 river sources w/ replacement → Task 2 ✓
- #6 ROCKY undocumented → Task 6 ✓
- #7 cohesion comment → Task 6 ✓
- #8 CLAUDE.md wall list → Task 6 ✓
- #9, #10 perf → Deferred (documented) ✓

**Type/name consistency:** `canThickenToRiver` exported from `world-gen.ts` and imported in `test-worldgen.ts` (Task 1). `afterLayer` added to `OverlayLayer` (Task 5 Step 1) and consumed (Step 4); builders return `PIXI.Graphics`. `cliffEdgesLocal` introduced to avoid colliding with the existing `cliffEdges` (`:385`). npm scripts `test:worldgen` (Task 1) and `test:hexutils` (Task 4) wired before use.

**Placeholder scan:** Task 5 Steps 2 deliberately references "body of the current X loop" because that code already exists verbatim in the file and must be moved, not rewritten — the executing agent copies the existing block into the builder. All other code steps contain complete code.
