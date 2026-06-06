# Rolling Front-Lines Doctrine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `test` AI's combined-arms *chunk* deployment with a symmetric front-line builder — horizontal lines filled centre→flanks, one unit type per line (cycling infantry/skirmisher/cavalry), all feeding ONE attack group that rolls forward, with a reserve group defending the back line reactively.

**Architecture:** A new pure planner `planFrontLines` (in `src/battle/ai/deploy.ts`) replaces `planCombinedArmsWave`. The per-tick controller (`src/battle/ai/controller.ts`) gains a `frontLines` flag that routes the whole standing force into the single attack group `GROUP_IDS[0]` (other groups dormant; reserve filled only by the existing reactive `defend` block). Config moves `test` from `combinedArms` to `frontLines`. Validated by a new headless test on the planner plus the AI-vs-AI `--study` matrix.

**Tech Stack:** TypeScript, pure functions (no React/PIXI in `src/battle/`), `tsx` headless test scripts, flat-top axial hex math via `HexUtils`.

**Key facts the engineer needs:**
- `COHORT_SIZE` is imported from `../../data/game` in `deploy.ts` (already in scope).
- `HexUtils.hexToPixel({q,r})` → `{x,y}`; flat-top, `size=40`. `fwd = frontSign * y` is depth toward the enemy (higher = more forward). `frontSign` is `+1` for blue, `-1` for red.
- Cells sharing the same pixel-`y` form one horizontal line; in axial terms they are 120px apart in `x` (Δq=2, Δr=−1), so cohort anchors in a row never collide.
- `Placement` type (already exported from `deploy.ts`): `{ groupId: GroupId; anchorHex: { q: number; r: number }; unitType: UnitType }`.
- Tests follow the existing `scripts/test-ai-*.ts` pattern: a local `check(name, cond, extra)` helper, tally `pass`/`fail`, `process.exit(fail > 0 ? 1 : 0)`.
- `npm run test:ai` chains the test scripts with `&&`; it currently stops at a PRE-EXISTING `test-ai-groups` 4/6 failure, so run new tests directly with `npx tsx`.

---

### Task 1: Add `planFrontLines` planner (alongside the old one)

Add the new planner without deleting `planCombinedArmsWave` yet, so every commit compiles. Cleanup happens in Task 4.

**Files:**
- Modify: `src/battle/ai/deploy.ts` (append after `planCombinedArmsWave`, before EOF)
- Create: `scripts/test-ai-frontlines.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-ai-frontlines.ts`:

```ts
// One attack group built as horizontal lines: filled front→back, each line centre-out, one unit
// type per line cycling [infantry, skirmisher, cavalry]. Run: npx tsx scripts/test-ai-frontlines.ts
import { planFrontLines } from '../src/battle/ai/deploy';
import type { UnitType, GroupId } from '../src/battle/simulate';
import { HexUtils } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// Wide, deep deploy strip (blue side → frontSign +1, front = high y).
const freeHexes: { q: number; r: number; key: string }[] = [];
for (let q = -12; q <= 12; q++) for (let r = -6; r <= 0; r++)
  freeHexes.push({ q, r, key: HexUtils.key({ q, r }) });

const gid = 1 as GroupId;
const roster: Record<UnitType, number> = { infantry: 200, cavalry: 200, skirmisher: 200 };
const plan = planFrontLines({ groupId: gid, freeHexes, roster, frontSign: 1, waveCohorts: 40 });

const lat = (q: number, r: number) => HexUtils.hexToPixel({ q, r }).x;
const fwd = (q: number, r: number) => HexUtils.hexToPixel({ q, r }).y; // frontSign +1
const xs = freeHexes.map(h => lat(h.q, h.r));
const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
const mean = (ns: number[]) => ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;

check('placed something', plan.length > 0, `n=${plan.length}`);
check('all placements share one groupId', plan.every(p => p.groupId === gid));
check('anchors are distinct', new Set(plan.map(p => HexUtils.key(p.anchorHex))).size === plan.length);

// Lines = maximal contiguous same-type runs in plan order (the planner emits one full line, then
// cycles type for the next).
type Run = { type: UnitType; fwds: number[]; lats: number[] };
const runs: Run[] = [];
for (const p of plan) {
  const f = fwd(p.anchorHex.q, p.anchorHex.r);
  const l = Math.abs(lat(p.anchorHex.q, p.anchorHex.r) - midX);
  const last = runs[runs.length - 1];
  if (last && last.type === p.unitType) { last.fwds.push(f); last.lats.push(l); }
  else runs.push({ type: p.unitType, fwds: [f], lats: [l] });
}
check('forms at least 3 lines', runs.length >= 3, `lines=${runs.length}`);

const cycle: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];
check('type cycles per line (inf→skir→cav…)',
  runs.every((r, i) => r.type === cycle[i % cycle.length]),
  runs.map(r => r.type[0]).join(''));

// Lines fill front→back: each line's mean depth ≤ the line ahead of it (1px float tolerance).
let monotonic = true;
for (let i = 1; i < runs.length; i++) if (mean(runs[i].fwds) > mean(runs[i - 1].fwds) + 1) monotonic = false;
check('lines fill front→back (depth non-increasing)', monotonic,
  runs.map(r => mean(r.fwds).toFixed(0)).join(' → '));

// First line is laid centre-out: lateral offset from centre is non-decreasing in placement order.
const l0 = runs[0].lats;
let centreOut = true;
for (let i = 1; i < l0.length; i++) if (l0[i] < l0[i - 1] - 1) centreOut = false;
check('first line is placed centre-out', centreOut, l0.map(x => x.toFixed(0)).join(','));

// Roster fallback: when the cycle's type is exhausted, the line still builds from remaining stock.
const scarce = planFrontLines({ groupId: gid, freeHexes, frontSign: 1, waveCohorts: 40,
  roster: { infantry: 0, cavalry: 200, skirmisher: 0 } });
check('falls back when a line type is exhausted',
  scarce.length > 0 && scarce.every(p => p.unitType === 'cavalry'), `n=${scarce.length}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-ai-frontlines.ts`
Expected: FAIL — `planFrontLines` is not exported yet (import error / runtime "not a function").

- [ ] **Step 3: Implement `planFrontLines`**

Append to `src/battle/ai/deploy.ts` (after the existing `planCombinedArmsWave`, which stays for now):

```ts
export interface FrontLinesInput {
  /** The single attack group this rolling front is built into. */
  groupId: GroupId;
  /** Free deploy-zone hexes (unoccupied), any order. */
  freeHexes: { q: number; r: number; key: string }[];
  /** Undeployed roster by type. */
  roster: Readonly<Record<UnitType, number>>;
  /** +1 if the enemy is on the larger-py side (blue), -1 otherwise (red). */
  frontSign: number;
  /** Max cohorts to place this plan. */
  waveCohorts: number;
  /** Unit type cycle, one type per successive line. Default [infantry, skirmisher, cavalry]. */
  lineTypes?: UnitType[];
}

const DEFAULT_LINE_TYPES: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];

/**
 * Build ONE group as a symmetric rolling front of horizontal lines:
 * - Cells are bucketed into rows by forward-depth (cells sharing a pixel-y are one line) and filled
 *   front (highest fwd) → back.
 * - Each row is filled CENTRE-OUT (closest to the lateral midpoint first), claiming each cohort's
 *   footprint so lines stay spaced and never overlap.
 * - One unit type per line, cycling `lineTypes` (line 1 infantry = front wall, line 2 skirmishers,
 *   line 3 cavalry, line 4 infantry…). If a line's type is out of stock, fall back to any remaining
 *   type so the build never stalls. Pure.
 */
export function planFrontLines(input: FrontLinesInput): Placement[] {
  const { groupId, freeHexes, roster, frontSign, waveCohorts, lineTypes = DEFAULT_LINE_TYPES } = input;
  if (freeHexes.length === 0 || waveCohorts <= 0) return [];

  const pts = freeHexes.map(h => {
    const p = HexUtils.hexToPixel(h);
    return { q: h.q, r: h.r, lat: p.x, fwd: frontSign * p.y };
  });
  const xs = pts.map(p => p.lat);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;

  // Bucket cells into rows by forward-depth (rounded — distinct rows are ~35px apart, never collide),
  // ordered front → back.
  const rows = new Map<number, typeof pts>();
  for (const p of pts) {
    const k = Math.round(p.fwd);
    const arr = rows.get(k);
    if (arr) arr.push(p); else rows.set(k, [p]);
  }
  const rowKeys = [...rows.keys()].sort((a, b) => b - a);

  const remaining: Record<UnitType, number> = { ...roster };
  const used = new Set<string>();
  const placements: Placement[] = [];
  const claim = (q: number, r: number) => {
    used.add(HexUtils.key({ q, r }));
    for (const n of HexUtils.getNeighbors({ q, r })) used.add(HexUtils.key(n));
  };
  const pickType = (lineIdx: number): UnitType | null => {
    const want = lineTypes[lineIdx % lineTypes.length];
    if (remaining[want] > 0) return want;
    return (['infantry', 'cavalry', 'skirmisher'] as UnitType[]).find(t => remaining[t] > 0) ?? null;
  };

  let lineIdx = 0;
  for (const rk of rowKeys) {
    if (placements.length >= waveCohorts) break;
    const type = pickType(lineIdx);
    if (type == null) break;                       // roster fully exhausted
    const row = rows.get(rk)!.slice().sort((a, b) => Math.abs(a.lat - midX) - Math.abs(b.lat - midX));
    let placedThisRow = 0;
    for (const c of row) {
      if (placements.length >= waveCohorts || remaining[type] <= 0) break;
      if (used.has(HexUtils.key({ q: c.q, r: c.r }))) continue;
      placements.push({ groupId, anchorHex: { q: c.q, r: c.r }, unitType: type });
      claim(c.q, c.r);
      remaining[type] -= Math.min(COHORT_SIZE, remaining[type]);
      placedThisRow++;
    }
    if (placedThisRow > 0) lineIdx++;              // a line was laid → next line cycles type
  }
  return placements;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-ai-frontlines.ts`
Expected: PASS — `8/8 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/battle/ai/deploy.ts scripts/test-ai-frontlines.ts
git commit -m "feat(ai): add planFrontLines — symmetric centre-out rolling line builder"
```

---

### Task 2: Add the `frontLines` config field and switch `test` to it

**Files:**
- Modify: `src/data/ai.ts` (the `DifficultyConfig` interface)
- Modify: `src/data/ai.json` (the `test` difficulty entry)
- Test: `scripts/test-ai-config.ts` (existing — must still pass)

- [ ] **Step 1: Add the `frontLines` field to `DifficultyConfig`**

In `src/data/ai.ts`, inside `interface DifficultyConfig`, add this field (place it right after the `combinedArms?` field, which stays until Task 4):

```ts
  /** Rolling front-lines doctrine: ONE attack group is built as successive horizontal lines, each
   *  filled centre→flanks, one unit type per line cycling [infantry, skirmisher, cavalry], and
   *  marched forward as a continuous rolling front. The other front groups stay dormant; the reserve
   *  group defends the back line reactively. Replaces the combined-arms chunk layout for `test`. */
  frontLines?: boolean;
```

- [ ] **Step 2: Point `test` at the new doctrine**

In `src/data/ai.json`, replace the `test` line in `difficulties` with:

```json
    "test":   { "reactionTicks": 10, "cpBudgetFrac": 1.0, "forceScale": 0.7, "capabilities": ["defend"], "frontLines": true, "fastDeploy": true }
```

(Drops `raid`, `serialWaves`, `horizontalFront`, `combinedArms`; keeps `defend` for the reactive rearguard and `fastDeploy` so lines brush down as fast as CP allows.)

- [ ] **Step 3: Verify config test still passes**

Run: `npx tsx scripts/test-ai-config.ts`
Expected: PASS — still 4 difficulties; no assertion references the removed flags. If any assertion checks `test` for `combinedArms`/`serialWaves`/`horizontalFront`, update it to expect `frontLines: true` instead.

- [ ] **Step 4: Commit**

```bash
git add src/data/ai.ts src/data/ai.json
git commit -m "feat(ai): add frontLines flag; switch test difficulty to it"
```

---

### Task 3: Wire `frontLines` into the controller (single rolling attack group)

**Files:**
- Modify: `src/battle/ai/controller.ts`

Routes the whole standing force into `GROUP_IDS[0]` via `planFrontLines`; the other front groups go dormant (cap 0); the reserve is still filled only by the existing reactive `defend` block (unchanged).

- [ ] **Step 1: Swap the import**

In `src/battle/ai/controller.ts`, change line 9:

```ts
import { planDeployment, planCombinedArmsWave } from './deploy';
```
to:
```ts
import { planDeployment, planFrontLines } from './deploy';
```

- [ ] **Step 2: Replace the `combinedArms` flag with `frontLines`**

Change the flag declaration (around line 69):

```ts
  const combinedArms = diff.combinedArms ?? false;
```
to:
```ts
  const frontLines = diff.frontLines ?? false;
```

- [ ] **Step 3: Route the whole force into one attack group in `bandCap`**

Replace the `bandCap` definition (around lines 220-222):

```ts
    const BIG_WAVE_MULT = 2.5;
    const bandCap = (g: GroupId): number =>
      serial && !horizontal && g === GROUP_IDS[0] ? Math.ceil(bandShare * BIG_WAVE_MULT) : bandShare;
```
with:
```ts
    const BIG_WAVE_MULT = 2.5;
    // frontLines routes the WHOLE standing force into ONE attack group (the rolling front); the other
    // groups stay dormant (cap 0) and the reserve is filled only reactively by the defend block above.
    const bandCap = (g: GroupId): number => {
      if (frontLines) return g === GROUP_IDS[0] ? targetUnits : 0;
      return serial && !horizontal && g === GROUP_IDS[0] ? Math.ceil(bandShare * BIG_WAVE_MULT) : bandShare;
    };
```

- [ ] **Step 4: Update the `activeFillGid` eligibility check**

In the `activeFillGid` expression (around lines 233-236), replace `combinedArms` with `frontLines`:

```ts
    const activeFillGid = serial
      ? groups.find(g => !g.sealed && g.size < bandCap(g.g)
          && (frontLines ? rosterTotal > 0 : (roster[typeOfGroup(g.g)] ?? 0) > 0))?.g
      : undefined;
```

- [ ] **Step 5: Switch the amass plan source to `planFrontLines`**

Replace the plan-source block (around lines 252-264):

```ts
      const plan = combinedArms
        ? planCombinedArmsWave({
            groupId: grp.g, freeHexes, roster, frontSign,
            waveCohorts: Math.ceil(bandCap(grp.g) / COHORT_SIZE),
          })
        : planDeployment({
            frontTypes: doc.front, reserveType: doc.reserve, forceScale: diff.forceScale, freeHexes, roster, frontSign,
            centreFirst: serial && !horizontal,
            horizontalFront: horizontal,
            wavesOverride: fastDeploy ? Math.ceil(bandCap(grp.g) / COHORT_SIZE) + 1 : undefined,
          }).filter(p => p.groupId === grp.g);
```
with:
```ts
      const plan = frontLines
        ? planFrontLines({
            groupId: grp.g, freeHexes, roster, frontSign,
            waveCohorts: Math.ceil(bandCap(grp.g) / COHORT_SIZE),
          })
        : planDeployment({
            frontTypes: doc.front, reserveType: doc.reserve, forceScale: diff.forceScale, freeHexes, roster, frontSign,
            centreFirst: serial && !horizontal,
            horizontalFront: horizontal,
            wavesOverride: fastDeploy ? Math.ceil(bandCap(grp.g) / COHORT_SIZE) + 1 : undefined,
          }).filter(p => p.groupId === grp.g);
```

- [ ] **Step 6: Update the `bandReady` type-left check**

In `bandReady` (around line 297), replace `combinedArms` with `frontLines`:

```ts
      const typeLeft = frontLines ? rosterTotal > 0 : (roster[typeOfGroup(grp.g)] ?? 0) > 0;
```

- [ ] **Step 7: Type-check and smoke-test the controller**

Run: `npx tsc -b`
Expected: no errors (no remaining references to `combinedArms`/`planCombinedArmsWave` in `controller.ts`).

Run: `npx tsx scripts/test-ai-controller.ts`
Expected: PASS (existing controller test unaffected — it does not exercise `test`/`frontLines`).

Run: `npx tsx scripts/sim-ai-vs-ai.ts --trace 2>&1 | head -20`
Expected: a `test`-vs-`test` trace runs to completion (a `WINNER:` line). Confirm the deployment snapshot shows ONE group carrying nearly all units (e.g. `groups=[NN,0,0,small]`) — the rolling attack group plus a small reactive reserve.

- [ ] **Step 8: Commit**

```bash
git add src/battle/ai/controller.ts
git commit -m "feat(ai): wire frontLines — one rolling attack group via planFrontLines"
```

---

### Task 4: Remove the dead combined-arms code and fix references

Now that nothing reads `combinedArms` / `planCombinedArmsWave`, delete them and repoint the harness and test script list.

**Files:**
- Modify: `src/battle/ai/deploy.ts` (delete `planCombinedArmsWave`, `CombinedArmsInput`, its constants)
- Modify: `src/data/ai.ts` (delete `combinedArms?` field)
- Delete: `scripts/test-ai-combined.ts`
- Modify: `package.json` (`test:ai` script)
- Modify: `scripts/sim-ai-vs-ai.ts` (the `--bisect` flag variants)

- [ ] **Step 1: Delete the combined-arms planner**

In `src/battle/ai/deploy.ts`, delete the entire `CombinedArmsInput` interface, the four composition constants (`CAVALRY_FRAC`, `SKIRMISHER_FRAC`, `FLANK_LAT_FRAC`, `CENTRE_DEPTH_FRAC`), and the whole `planCombinedArmsWave` function (the block spanning the `export interface CombinedArmsInput { … }` through the end of `export function planCombinedArmsWave(…) { … }`). Keep `Placement`, `DeployInput`, `planDeployment`, and the new `FrontLinesInput` / `planFrontLines`.

- [ ] **Step 2: Delete the `combinedArms` config field**

In `src/data/ai.ts`, delete the `combinedArms?: boolean;` field and its doc-comment from `DifficultyConfig`. (Leave `serialWaves?` and `horizontalFront?` — `planDeployment` still supports them for other configs.)

- [ ] **Step 3: Delete the obsolete test and repoint `test:ai`**

Delete the file:
```bash
git rm scripts/test-ai-combined.ts
```

In `package.json`, in the `test:ai` script, replace the trailing `&& tsx scripts/test-ai-combined.ts` with `&& tsx scripts/test-ai-frontlines.ts`.

- [ ] **Step 4: Fix the `--bisect` harness variants**

In `scripts/sim-ai-vs-ai.ts`, in the `bisect` function's `variants` object (around lines 188-192), replace the two combined-arms entries:

```ts
    '+combined':  { combinedArms: true },
    '+horiz+comb':{ horizontalFront: true, combinedArms: true },
```
with:
```ts
    '+frontlines': { frontLines: true },
```

- [ ] **Step 5: Type-check and run the planner test**

Run: `npx tsc -b`
Expected: no errors (no remaining `combinedArms` / `planCombinedArmsWave` / `CombinedArmsInput` references anywhere).

Run: `npx tsx scripts/test-ai-frontlines.ts`
Expected: PASS — `8/8 passed`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(ai): remove combined-arms planner/flag, repoint harness + tests to frontLines"
```

---

### Task 5: Integration verification

**Files:** none (verification only).

- [ ] **Step 1: Full type-check**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 2: Run the AI test scripts that do not depend on the pre-existing `groups` failure**

Run each directly (the `&&` chain in `test:ai` stops at the known `test-ai-groups` 4/6 failure, so invoke individually):

```bash
npx tsx scripts/test-ai-config.ts
npx tsx scripts/test-ai-deploy.ts
npx tsx scripts/test-ai-controller.ts
npx tsx scripts/test-ai-frontlines.ts
```
Expected: each prints `N/N passed` and exits 0.

- [ ] **Step 2b: Confirm no behavioral drift in the pure battle sim**

Run: `npx tsx scripts/sim-formations.ts`
Expected: same per-scenario results as before this branch's changes (this plan does not touch `src/battle/simulate.ts` or terrain/combat data, so results must be unchanged).

- [ ] **Step 3: Confirm `test` is still the strongest difficulty**

Run: `npx tsx scripts/sim-ai-vs-ai.ts --study`
Expected: in the **side-bias-cancelled matrix**, `test` beats `easy`/`normal`/`hard` (>50% each). The **pure self-play** row for `test` will still read ~0/100 (red/blue) — this is the known deterministic-mirror artifact documented in the spec, NOT a regression. Note both numbers in the completion report.

- [ ] **Step 4: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "test(ai): verify rolling front-lines doctrine integration"
```
(If nothing changed, skip — verification is observational.)

---

## Notes for the implementer

- **Do not reset the tick counter** anywhere — irrelevant here but a standing invariant.
- `src/battle/*` must stay free of React/PIXI imports; `planFrontLines` uses only `HexUtils`, `COHORT_SIZE`, and the `GroupId`/`UnitType` types.
- The rolling-front behaviour emerges from the existing amass+march loop: once the attack group reaches its launch share it marches forward (loose formation) and keeps amassing lines behind it as zone cells free up. No new march code is needed.
- If `--trace` shows the attack group never marching, check that `bandReady`/`frontReady` treat the dormant cap-0 groups as ready (size 0 ⇒ `bandReady` returns true), so they don't pin `frontReady` false.
