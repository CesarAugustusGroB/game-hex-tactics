# Test AI — Combined-Arms Front Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `test` AI deploy each wave as ONE combined-arms battle line — a wide infantry front (thicker in the centre to take the flag), skirmishers in the rear ranks, cavalry on both flanks — all in a single group; then serial-launch the next mini-army or, under raid threat, plant defenders as far forward as possible.

**Architecture:** A new pure geometry function `planCombinedArmsWave()` in `src/battle/ai/deploy.ts` lays one group's positional formation from the free deploy-zone cells. A `combinedArms` flag on the difficulty config routes the `test` controller's serial active-fill band through this function instead of the one-type-per-band `planDeployment`. The defensive-deploy step is changed to pick the most-forward free cell near a threat. Everything is gated to `test`; easy/normal/hard are untouched.

**Tech Stack:** TypeScript, pure functions (no React/PIXI in `src/battle/`), `tsx` headless test scripts (`scripts/test-ai-*.ts`), the AI-vs-AI harness (`scripts/sim-ai-vs-ai.ts`).

---

## File Structure

- `src/battle/ai/deploy.ts` — add `CombinedArmsInput` + `planCombinedArmsWave()` (new pure function; composition constants live beside it as geometry tuning).
- `src/data/ai.ts` — add `combinedArms?: boolean` to `DifficultyConfig`.
- `src/data/ai.json` — set `"combinedArms": true` on `test`.
- `src/battle/ai/controller.ts` — read the flag; route the serial active band through `planCombinedArmsWave`; make roster checks type-agnostic for combined arms; change defensive-deploy to place forward.
- `scripts/test-ai-combined.ts` — NEW headless test for the formation geometry (and add to `npm run test:ai`).
- `package.json` — append the new test to the `test:ai` chain.

---

## Background facts the implementer needs

- **Coordinates:** `HexUtils.hexToPixel({q,r})` → `{x,y}`. In a deploy zone, `lat = x` (across the field), and `fwd = frontSign * y` where higher `fwd` = closer to the enemy. `frontSign` is `-1` for red (bottom strip), `+1` for blue (top strip). `HexUtils.key({q,r})` is the canonical map key; `HexUtils.getNeighbors({q,r})` returns the 6 neighbours.
- **Cohort:** `COHORT_SIZE` (from `src/data/game.ts`) units land per `placeCohort` call (anchor + free neighbours). Deployment plans emit `Placement { groupId, anchorHex, unitType }` per cohort; the controller applies each via `state.placeCohort`.
- **Serial waves (existing):** with `serialWaves`, the controller's `activeFillGid` is the lowest-numbered unsealed band with room; only it amasses each tick. When it fills its `bandCap` and marches (sealed), the next band becomes active. `test` already has `serialWaves`, `fastDeploy`, `horizontalFront`, capabilities `["raid","defend"]`, `reactionTicks: 10`.
- **Test scripts pattern:** each `scripts/test-ai-*.ts` defines `let pass=0,fail=0; const check=(name,cond,extra)=>{...}` printing `✓/✗`, ends with `console.log(\`${pass}/${pass+fail} passed\`); process.exit(fail>0?1:0)`. Run with `npx tsx scripts/test-ai-<name>.ts`.

---

### Task 1: `planCombinedArmsWave()` geometry + test

**Files:**
- Modify: `src/battle/ai/deploy.ts` (add export below `planDeployment`)
- Test: `scripts/test-ai-combined.ts` (new)
- Modify: `package.json` (append to `test:ai`)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-ai-combined.ts`:

```ts
// One wave = one combined-arms group: cavalry on both flanks, an infantry front line that is
// thicker in the centre, skirmishers in the rear ranks. Run: npx tsx scripts/test-ai-combined.ts
import { planCombinedArmsWave } from '../src/battle/ai/deploy';
import type { UnitType, GroupId } from '../src/battle/simulate';
import { HexUtils } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// Wide, shallow deploy strip: q ∈ [-12,12], r ∈ [-3,0] (blue side → frontSign +1, front = high y).
const freeHexes: { q: number; r: number; key: string }[] = [];
for (let q = -12; q <= 12; q++) for (let r = -3; r <= 0; r++)
  freeHexes.push({ q, r, key: HexUtils.key({ q, r }) });

const gid = 1 as GroupId;
const roster: Record<UnitType, number> = { infantry: 200, cavalry: 200, skirmisher: 200 };
const plan = planCombinedArmsWave({ groupId: gid, freeHexes, roster, frontSign: 1, waveCohorts: 20 });

const lat = (q: number, r: number) => HexUtils.hexToPixel({ q, r }).x;
const fwd = (q: number, r: number) => 1 * HexUtils.hexToPixel({ q, r }).y;
const xs = freeHexes.map(h => lat(h.q, h.r));
const minX = Math.min(...xs), maxX = Math.max(...xs), midX = (minX + maxX) / 2, span = maxX - minX;
const of = (t: UnitType) => plan.filter(p => p.unitType === t);
const mean = (ns: number[]) => ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;

check('placed something', plan.length > 0, `n=${plan.length}`);
check('all placements share one groupId', plan.every(p => p.groupId === gid));
check('has all three arms', of('infantry').length > 0 && of('cavalry').length > 0 && of('skirmisher').length > 0,
  `inf=${of('infantry').length} cav=${of('cavalry').length} skr=${of('skirmisher').length}`);

// Cavalry sits on the flanks (far from centre laterally); infantry sits centrally.
const cavLat = of('cavalry').map(p => Math.abs(lat(p.anchorHex.q, p.anchorHex.r) - midX));
const infLat = of('infantry').map(p => Math.abs(lat(p.anchorHex.q, p.anchorHex.r) - midX));
check('cavalry is on the flanks (outer third)', cavLat.every(d => d > span * 0.3), `minCavOffset=${Math.min(...cavLat).toFixed(0)}`);
check('infantry is more central than cavalry', mean(infLat) < mean(cavLat),
  `infMeanOffset=${mean(infLat).toFixed(0)} cavMeanOffset=${mean(cavLat).toFixed(0)}`);

// Cavalry split across BOTH flanks.
check('cavalry on both flanks', of('cavalry').some(p => lat(p.anchorHex.q, p.anchorHex.r) < midX)
  && of('cavalry').some(p => lat(p.anchorHex.q, p.anchorHex.r) > midX));

// Skirmishers sit BEHIND the infantry line (lower fwd = farther from the enemy).
const infFwd = mean(of('infantry').map(p => fwd(p.anchorHex.q, p.anchorHex.r)));
const skrFwd = mean(of('skirmisher').map(p => fwd(p.anchorHex.q, p.anchorHex.r)));
check('skirmishers sit behind the infantry line', skrFwd < infFwd, `skrFwd=${skrFwd.toFixed(0)} infFwd=${infFwd.toFixed(0)}`);

// Centre is thicker: more infantry in the central third than in either flank-adjacent third of the centre.
const centreInf = of('infantry').filter(p => Math.abs(lat(p.anchorHex.q, p.anchorHex.r) - midX) < span * 0.16).length;
const wingInf = of('infantry').length - centreInf;
check('centre of the line is thicker than the wings', centreInf >= wingInf,
  `centreInf=${centreInf} wingInf=${wingInf}`);

// No two cohorts share an anchor (disjoint footprints).
const anchors = plan.map(p => HexUtils.key(p.anchorHex));
check('anchors are distinct', new Set(anchors).size === anchors.length);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-ai-combined.ts`
Expected: FAIL — `planCombinedArmsWave` is not exported yet (import error / `TypeError: planCombinedArmsWave is not a function`).

- [ ] **Step 3: Implement `planCombinedArmsWave`**

Append to `src/battle/ai/deploy.ts` (after `planDeployment`, before end of file):

```ts
export interface CombinedArmsInput {
  /** The single group this whole combined-arms wave is placed into. */
  groupId: GroupId;
  /** Free deploy-zone hexes (unoccupied), any order. */
  freeHexes: { q: number; r: number; key: string }[];
  /** Undeployed roster by type. */
  roster: Readonly<Record<UnitType, number>>;
  /** +1 if the enemy is on the larger-py side (blue), -1 otherwise (red). */
  frontSign: number;
  /** Total cohorts to place this wave. */
  waveCohorts: number;
}

// Composition of one combined-arms wave (cohort fractions). Infantry takes the remainder.
const CAVALRY_FRAC = 0.2;       // split across the two flanks, for raids
const SKIRMISHER_FRAC = 0.25;   // rear ranks behind the line
const FLANK_LAT_FRAC = 0.18;    // each wing = this fraction of the lateral span
const CENTRE_DEPTH_FRAC = 0.4;  // of the infantry budget, this much reinforces the centre columns

/**
 * Lay ONE group out as a combined-arms battle line from the free zone cells:
 * - CAVALRY on the two flanks (front of each wing), for flank raids.
 * - INFANTRY forms the wide centre front line, plus a deeper second mass at the centre columns so
 *   the middle is thicker (to push and hold the flag).
 * - SKIRMISHERS in the rear-centre ranks, behind the infantry line.
 * Types claim disjoint cohort footprints (anchor + neighbours) so they don't overlap. Pure.
 */
export function planCombinedArmsWave(input: CombinedArmsInput): Placement[] {
  const { groupId, freeHexes, roster, frontSign, waveCohorts } = input;
  if (freeHexes.length === 0 || waveCohorts <= 0) return [];

  const pts = freeHexes.map(h => {
    const p = HexUtils.hexToPixel(h);
    return { q: h.q, r: h.r, lat: p.x, fwd: frontSign * p.y };
  });
  const xs = pts.map(p => p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const span = (maxX - minX) || 1;
  const midX = (minX + maxX) / 2;
  const leftEdge = minX + FLANK_LAT_FRAC * span;
  const rightEdge = maxX - FLANK_LAT_FRAC * span;

  const remaining: Record<UnitType, number> = { ...roster };
  const used = new Set<string>();
  const placements: Placement[] = [];

  // Reserve a cohort footprint so the next type doesn't plan onto it.
  const claim = (q: number, r: number) => {
    used.add(HexUtils.key({ q, r }));
    for (const n of HexUtils.getNeighbors({ q, r })) used.add(HexUtils.key(n));
  };
  // Place up to `n` cohorts of `type` from `cands` in order, skipping used cells / empty roster.
  const place = (cands: typeof pts, type: UnitType, n: number): void => {
    let placed = 0;
    for (const c of cands) {
      if (placed >= n || remaining[type] <= 0) break;
      if (used.has(HexUtils.key({ q: c.q, r: c.r }))) continue;
      placements.push({ groupId, anchorHex: { q: c.q, r: c.r }, unitType: type });
      claim(c.q, c.r);
      remaining[type] -= Math.min(COHORT_SIZE, remaining[type]);
      placed++;
    }
  };

  const cavTotal = Math.max(0, Math.round(waveCohorts * CAVALRY_FRAC));
  const skirTotal = Math.max(0, Math.round(waveCohorts * SKIRMISHER_FRAC));
  const infTotal = Math.max(0, waveCohorts - cavTotal - skirTotal);

  // CAVALRY on the flanks (front rows of each wing). Split evenly L/R.
  const leftFlank = pts.filter(p => p.lat < leftEdge).sort((a, b) => b.fwd - a.fwd || a.lat - b.lat);
  const rightFlank = pts.filter(p => p.lat > rightEdge).sort((a, b) => b.fwd - a.fwd || b.lat - a.lat);
  place(leftFlank, 'cavalry', Math.ceil(cavTotal / 2));
  place(rightFlank, 'cavalry', Math.floor(cavTotal / 2));

  // INFANTRY: wide front line across the centre span (front row first, centre-out), then a deeper
  // mass at the centre columns so the middle is thicker.
  const centre = pts.filter(p => p.lat >= leftEdge && p.lat <= rightEdge);
  const frontLine = [...centre].sort((a, b) => b.fwd - a.fwd || Math.abs(a.lat - midX) - Math.abs(b.lat - midX));
  const deepCentre = [...centre].sort((a, b) => Math.abs(a.lat - midX) - Math.abs(b.lat - midX) || b.fwd - a.fwd);
  const infDeep = Math.round(infTotal * CENTRE_DEPTH_FRAC);
  place(frontLine, 'infantry', infTotal - infDeep);
  place(deepCentre, 'infantry', infDeep);

  // SKIRMISHERS behind the line: centre cells farthest from the enemy (lowest fwd) that remain free.
  const rear = [...centre].sort((a, b) => a.fwd - b.fwd || Math.abs(a.lat - midX) - Math.abs(b.lat - midX));
  place(rear, 'skirmisher', skirTotal);

  return placements;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-ai-combined.ts`
Expected: `8/8 passed`.

- [ ] **Step 5: Add the test to the suite**

In `package.json`, append ` && tsx scripts/test-ai-combined.ts` to the end of the `test:ai` script value (before the closing quote).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add src/battle/ai/deploy.ts scripts/test-ai-combined.ts package.json
git commit -m "feat(ai): planCombinedArmsWave — combined-arms battle line geometry"
```

---

### Task 2: `combinedArms` difficulty flag

**Files:**
- Modify: `src/data/ai.ts` (add field to `DifficultyConfig`)
- Modify: `src/data/ai.json` (set on `test`)

- [ ] **Step 1: Add the field to the interface**

In `src/data/ai.ts`, inside `interface DifficultyConfig`, immediately after the `horizontalFront?: boolean;` field, add:

```ts
  /** Combined-arms waves: each serial wave is ONE group laid out as a battle line — infantry front
   *  (centre-thick), skirmishers in the rear, cavalry on the flanks — via planCombinedArmsWave,
   *  instead of one unit type per band. Implies a horizontal front. */
  combinedArms?: boolean;
```

- [ ] **Step 2: Enable it on `test`**

In `src/data/ai.json`, change the `test` difficulty line to add `"combinedArms": true` (keep the other flags):

```json
    "test":   { "reactionTicks": 10, "cpBudgetFrac": 1.0, "forceScale": 0.7, "capabilities": ["raid", "defend"], "serialWaves": true, "fastDeploy": true, "horizontalFront": true, "combinedArms": true }
```

- [ ] **Step 3: Typecheck + config test**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: clean.
Run: `npx tsx scripts/test-ai-config.ts`
Expected: all passed (the loop validates the new difficulty's `reactionTicks`/`forceScale`; the count assertion is still `=== 4`).

- [ ] **Step 4: Commit**

```bash
git add src/data/ai.ts src/data/ai.json
git commit -m "feat(ai): combinedArms difficulty flag, enabled on test"
```

---

### Task 3: Route the test serial wave through `planCombinedArmsWave`

**Files:**
- Modify: `src/battle/ai/controller.ts`

- [ ] **Step 1: Import the new function**

In `src/battle/ai/controller.ts`, find the existing import of `planDeployment` (search `planDeployment`) and extend it to also import `planCombinedArmsWave` from the same `./deploy` module. Example — change:

```ts
import { planDeployment } from './deploy';
```
to:
```ts
import { planDeployment, planCombinedArmsWave } from './deploy';
```
(If the existing import already lists other names, just add `planCombinedArmsWave` to the braces.)

- [ ] **Step 2: Read the flag**

Find the line `const horizontal = diff.horizontalFront ?? false;` and add immediately after it:

```ts
    const combinedArms = diff.combinedArms ?? false;
```

- [ ] **Step 3: Make the serial active-fill roster check type-agnostic**

Find:

```ts
    const activeFillGid = serial
      ? groups.find(g => !g.sealed && g.size < bandCap(g.g) && (roster[typeOfGroup(g.g)] ?? 0) > 0)?.g
      : undefined;
```

Replace the roster predicate so combined-arms checks ANY roster (the wave mixes types):

```ts
    const activeFillGid = serial
      ? groups.find(g => !g.sealed && g.size < bandCap(g.g)
          && (combinedArms ? rosterTotal > 0 : (roster[typeOfGroup(g.g)] ?? 0) > 0))?.g
      : undefined;
```

- [ ] **Step 4: Route the plan source**

Find (inside the amass `for (const grp of amassOrder)` loop):

```ts
      const plan = planDeployment({
        frontTypes: doc.front, reserveType: doc.reserve, forceScale: diff.forceScale, freeHexes, roster, frontSign,
        centreFirst: serial && !horizontal,
        horizontalFront: horizontal,
        // fastDeploy: emit a whole band of anchors so it brushes down in one tick instead of one
        // cohort per tick (the default `round(forceScale*2)` ≈ 1 anchor is the slow drip).
        wavesOverride: fastDeploy ? Math.ceil(bandCap(grp.g) / COHORT_SIZE) + 1 : undefined,
      }).filter(p => p.groupId === grp.g);
```

Replace with (combined-arms uses the one-group battle-line planner; everyone else keeps the per-band planner):

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
            // fastDeploy: emit a whole band of anchors so it brushes down in one tick instead of one
            // cohort per tick (the default `round(forceScale*2)` ≈ 1 anchor is the slow drip).
            wavesOverride: fastDeploy ? Math.ceil(bandCap(grp.g) / COHORT_SIZE) + 1 : undefined,
          }).filter(p => p.groupId === grp.g);
```

- [ ] **Step 5: Make the launch-readiness roster check type-agnostic**

Find the `bandReady` helper:

```ts
    const bandReady = (grp: { g: GroupId; size: number; sealed: boolean }): boolean => {
      if (grp.size === 0 || grp.sealed) return true;
      // Serial waves launch a band once it reaches its full wave cap; the parallel front uses the
      // (danger-lowered) launchShare.
      const full = serial ? bandCap(grp.g) : launchShare;
      if (grp.size >= full) return true;
      const canGrowMore = grp.size < bandCap(grp.g) && freeZoneCount > 0 && (roster[typeOfGroup(grp.g)] ?? 0) > 0;
      return !canGrowMore;
    };
```

Change the `canGrowMore` roster term so combined-arms checks any roster:

```ts
    const bandReady = (grp: { g: GroupId; size: number; sealed: boolean }): boolean => {
      if (grp.size === 0 || grp.sealed) return true;
      // Serial waves launch a band once it reaches its full wave cap; the parallel front uses the
      // (danger-lowered) launchShare.
      const full = serial ? bandCap(grp.g) : launchShare;
      if (grp.size >= full) return true;
      const typeLeft = combinedArms ? rosterTotal > 0 : (roster[typeOfGroup(grp.g)] ?? 0) > 0;
      const canGrowMore = grp.size < bandCap(grp.g) && freeZoneCount > 0 && typeLeft;
      return !canGrowMore;
    };
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: clean.

- [ ] **Step 7: Behavioural check — the test AI deploys one mixed group**

Run: `npx tsx scripts/test-ai-battle.ts`
Expected: `4/4 passed` (the full deploy→sim→score loop still completes and scores; this exercises the controller with a difficulty arg — it must not throw).

Run: `npx tsx scripts/test-ai-combined.ts`
Expected: still `8/8 passed` (geometry unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/battle/ai/controller.ts
git commit -m "feat(ai): route test serial waves through combined-arms planner"
```

---

### Task 4: Defend raids as far forward as possible

**Files:**
- Modify: `src/battle/ai/controller.ts` (defensive-deploy block)

The current defensive deploy picks the free zone cell NEAREST the threat. The spec wants defenders planted "lo más alante que pueda" — as far forward (toward the enemy) as possible, while still lateral-aligned with the threat, so raiders are intercepted before they reach the scoring line.

- [ ] **Step 1: Replace the spot-selection**

Find:

```ts
        const spot = [...state.deployZone]
          .filter(k => !occupied.has(k))
          .map(k => { const { q, r } = HexUtils.fromKey(k); return { q, r, d: HexUtils.distance({ q, r }, tgt) }; })
          .sort((a, b) => a.d - b.d)[0];
```

Replace with (pick the most-forward free cell within a lateral window of the threat; fall back to nearest if the window is empty):

```ts
        const tgtLat = HexUtils.hexToPixel(tgt).x;
        const free = [...state.deployZone]
          .filter(k => !occupied.has(k))
          .map(k => {
            const { q, r } = HexUtils.fromKey(k);
            const p = HexUtils.hexToPixel({ q, r });
            return { q, r, lat: p.x, fwd: frontSign * p.y, d: HexUtils.distance({ q, r }, tgt) };
          });
        // Cells roughly in the threat's lane (within ~2 hexes laterally); among them, the most
        // forward (highest fwd toward the enemy). Empty lane → nearest cell to the threat.
        const lane = free.filter(c => Math.abs(c.lat - tgtLat) <= 2 * HexUtils.size);
        const spot = (lane.length ? lane.sort((a, b) => b.fwd - a.fwd) : free.sort((a, b) => a.d - b.d))[0];
```

(`HexUtils.size` is the flat-top hex size constant exported from `HexUtils`; `2 * HexUtils.size` ≈ a two-hex lateral window. `frontSign` is already in scope in the controller.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: clean.

- [ ] **Step 3: Defence regression test**

Run: `npx tsx scripts/test-ai-defense.ts`
Expected: all passed. If the existing assertion `defensive deploy: first cohort lands at the breach` asserts an EXACT nearest-cell hex, it may now expect a more-forward cell. If it fails ONLY on that exact-coordinate check (not on "a blocker was placed toward the threat"), update that assertion in `scripts/test-ai-defense.ts` to assert the placed cohort is in the threat's lateral lane AND at least as forward as the threat (`frontSign*(placedY - threatY) >= 0`), rather than an exact hex. Re-run until green.

- [ ] **Step 4: Commit**

```bash
git add src/battle/ai/controller.ts scripts/test-ai-defense.ts
git commit -m "feat(ai): defend raids by planting blockers as far forward as possible"
```

---

### Task 5: Full verification + behaviour sim

**Files:** none (verification only)

- [ ] **Step 1: Full AI suite**

Run: `npm run test:ai`
Expected: every script passes EXCEPT the pre-existing `test-ai-groups` (4/6 — unrelated, already red on `master`/merge base). If any OTHER script regressed, fix it before continuing.

- [ ] **Step 2: Behaviour matrix**

Run: `npx tsx scripts/sim-ai-vs-ai.ts --study 24`
Expected: prints the win-rate matrix without throwing; `test` still resolves matches (it will likely shift from its pre-change numbers — record them). The goal of this task is *no crash + test still plays the ladder*, not a specific win-rate; the combined-arms shape is a feel change validated live.

- [ ] **Step 3: Visual confirmation (manual)**

Start the app (`npm run dev`), dive into a tactical battle, set ENEMY AI to `test`, run the battle. Confirm by eye: the AI lays a wide front with cavalry on both flanks, an infantry-thick centre, skirmishers behind — one group at a time — then sends the next wave / plants forward defenders under raid pressure.

- [ ] **Step 4: Final commit (if any test fixtures changed in Step 1)**

```bash
git add -A
git commit -m "test(ai): align fixtures with combined-arms test deployment"
```

---

## Notes / out of scope

- **Cavalry actually raiding:** this plan places cavalry ON the flanks (positional intent). Making the flank cavalry specifically peel off to raid (vs the whole group marching under the `raid` capability) is a follow-up behaviour change, not deployment geometry.
- **Composition tuning:** `CAVALRY_FRAC` / `SKIRMISHER_FRAC` / `FLANK_LAT_FRAC` / `CENTRE_DEPTH_FRAC` are geometry constants in `deploy.ts`; tune by feel after watching it live. They can move to `ai.json` later if they become balance levers.
- **Other difficulties unaffected:** `combinedArms` is only set on `test`; easy/normal/hard keep the per-band `planDeployment` path.
