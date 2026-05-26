# Victory Points Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hold-the-centre tug-of-war win condition with a victory-points race: units reaching the enemy back line score points and return to the roster (raid & return); holding the centre uncontested accrues points; first team to a configurable threshold (default 100) wins.

**Architecture:** A new pure module `src/battle/scoring.ts` computes one tick of scoring from the post-`simulateTick` unit list — territory-reach points + roster refunds + center-hold points + winner. Tunables live in `src/data/scoring.json` (+ `.ts` wrapper, mirroring the existing data-file pattern). The tick loop (`src/canvas/useBattleTick.ts`) calls it, removes units that reached the enemy line, applies roster deltas, and updates the score. The old `captureProgress` tug-of-war state is renamed to `score` and the HUD strip is rebuilt to show a race to the threshold.

**Tech Stack:** TypeScript, React (HUD state), PIXI (unchanged here), `tsx` for the headless verification script. No test runner is configured — the pure module is verified by `scripts/sim-scoring.ts` (run with `npx tsx`), types by `npm run build`, and no-drift of the existing sim by `npx tsx scripts/sim-formations.ts`.

**Design decisions (confirmed with the user):**
- "Enemy territory" = the **enemy's deploy zone** (the opposite back strip; already computed by `deployZoneFor`). Red scores by entering blue's deploy zone and vice versa.
- A unit reaching the enemy line is **removed from the field**, scores `pointsPerUnitReached`, and adds 1 of its type back to its team's roster (raid & return). This makes the per-unit point naturally one-time.
- Center-hold points **only accumulate, never decay**. Uncontested presence in the central flower earns points per tick; contested or empty earns nobody anything.
- Annihilation (one team wiped) remains a fallback win.

---

### Task 1: Scoring config data file + wrapper

**Files:**
- Create: `src/data/scoring.json`
- Create: `src/data/scoring.ts`

- [ ] **Step 1: Create the JSON config**

Create `src/data/scoring.json`:

```json
{
  "pointsToWin": 100,
  "pointsPerUnitReached": 1,
  "centerHoldPointsPerSecond": 2
}
```

- [ ] **Step 2: Create the wrapper**

Create `src/data/scoring.ts`. It owns the type and derives the per-tick centre rate from the designer-facing per-second value, using `TICK_MS` (with the default 500 ms tick, 2/sec → 1.0/tick). Importing from `./game` is allowed — both live in `src/data` and the dependency is one-directional (game does not import scoring):

```ts
import raw from './scoring.json';
import { TICK_MS } from './game';

export interface ScoringConfig {
  /** Victory-point total a team must reach to win. */
  pointsToWin: number;
  /** Points scored when one unit reaches the enemy back line (then returns to roster). */
  pointsPerUnitReached: number;
  /** Points per second a team earns while holding the central flower uncontested. */
  centerHoldPointsPerSecond: number;
}

export const SCORING: ScoringConfig = raw as ScoringConfig;

export const POINTS_TO_WIN = SCORING.pointsToWin;
export const POINTS_PER_UNIT_REACHED = SCORING.pointsPerUnitReached;
// The sim is tick-based; convert the per-second design value to per-tick.
export const CENTER_HOLD_POINTS_PER_TICK = (SCORING.centerHoldPointsPerSecond * TICK_MS) / 1000;
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: PASS (no type errors). This compiles the new files even before they have consumers.

- [ ] **Step 4: Commit**

```bash
git add src/data/scoring.json src/data/scoring.ts
git commit -m "feat: add scoring config (points to win, per-unit, center hold rate)"
```

---

### Task 2: Pure `scoreTick` module (TDD)

**Files:**
- Create: `src/battle/scoring.ts`
- Test: `scripts/sim-scoring.ts`

This is the testable core. Write the verification script first, watch it fail (module missing), then implement until it passes.

- [ ] **Step 1: Write the failing test script**

Create `scripts/sim-scoring.ts`:

```ts
/**
 * Headless checks for the pure scoreTick scoring function. No test runner is configured;
 * this throws a non-zero exit code on any failed assertion.
 *
 * Run with: npx tsx scripts/sim-scoring.ts
 */
import { scoreTick } from '../src/battle/scoring';
import type { Unit, Team } from '../src/battle/simulate';
import { HexUtils } from '../src/hex-engine/HexUtils';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`); failures++; }
}

function unit(id: string, team: Team, q: number, r: number, extra: Partial<Unit> = {}): Unit {
  return {
    id, team, unitType: 'infantry',
    tacticalHex: { q, r }, homeHex: { q, r },
    groupId: 1, hp: 10, state: 'idle',
    nextMoveTick: 0, visionRadius: 4,
    ...extra,
  };
}

const cfg = { pointsToWin: 100, pointsPerUnitReached: 1, centerHoldPointsPerTick: 1 };
const center = new Set([HexUtils.key({ q: 0, r: 0 })]);
const noZone = { red: new Set<string>(), blue: new Set<string>() };

// 1. A red unit standing in red's scoring zone scores, is removed, and refunds roster.
{
  const zoneKey = HexUtils.key({ q: 5, r: -5 });
  const r = scoreTick({
    units: [unit('a', 'red', 5, -5, { unitType: 'cavalry' })],
    score: { red: 0, blue: 0 },
    centerKeys: center,
    scoringZone: { red: new Set([zoneKey]), blue: new Set<string>() },
    config: cfg,
  });
  check('reach: red +1 point', r.score.red === 1);
  check('reach: unit removed', r.reachedUnitIds.has('a'));
  check('reach: roster +1 cavalry', r.rosterDelta.red.cavalry === 1);
  check('reach: changed flag set', r.changed === true);
}

// 2. Uncontested centre accrues per-tick points; no removal.
{
  const r = scoreTick({
    units: [unit('a', 'red', 0, 0)],
    score: { red: 0, blue: 0 },
    centerKeys: center,
    scoringZone: noZone,
    config: cfg,
  });
  check('centre uncontested: red +1', r.score.red === 1);
  check('centre uncontested: no removal', r.reachedUnitIds.size === 0);
}

// 3. Contested centre — nobody scores, nothing changes.
{
  const r = scoreTick({
    units: [unit('a', 'red', 0, 0), unit('b', 'blue', 0, 0)],
    score: { red: 5, blue: 5 },
    centerKeys: center,
    scoringZone: noZone,
    config: cfg,
  });
  check('centre contested: red unchanged', r.score.red === 5);
  check('centre contested: blue unchanged', r.score.blue === 5);
  check('centre contested: changed false', r.changed === false);
}

// 4. Win at threshold.
{
  const r = scoreTick({
    units: [unit('a', 'red', 0, 0)],
    score: { red: 99, blue: 0 },
    centerKeys: center,
    scoringZone: noZone,
    config: cfg,
  });
  check('win: red reaches 100', r.score.red === 100);
  check('win: winner is red', r.winner === 'red');
}

// 5. A dead unit in the scoring zone does not score and is not removed.
{
  const zoneKey = HexUtils.key({ q: 5, r: -5 });
  const r = scoreTick({
    units: [unit('a', 'red', 5, -5, { hp: 0 })],
    score: { red: 0, blue: 0 },
    centerKeys: center,
    scoringZone: { red: new Set([zoneKey]), blue: new Set<string>() },
    config: cfg,
  });
  check('dead unit: no score', r.score.red === 0);
  check('dead unit: no removal', r.reachedUnitIds.size === 0);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll scoring checks passed.');
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx scripts/sim-scoring.ts`
Expected: FAIL — `Cannot find module '../src/battle/scoring'` (or an import resolution error), because `src/battle/scoring.ts` does not exist yet.

- [ ] **Step 3: Implement the pure module**

Create `src/battle/scoring.ts`:

```ts
import type { Unit, Team, UnitType } from './simulate';
import { HexUtils } from '../hex-engine/HexUtils';

export type Score = Record<Team, number>;
export type RosterDelta = Record<Team, Record<UnitType, number>>;

export interface ScoreConfig {
  pointsToWin: number;
  pointsPerUnitReached: number;
  centerHoldPointsPerTick: number;
}

export interface ScoreTickInput {
  /** Units after simulateTick (may include hp <= 0 corpses). */
  units: Unit[];
  /** Current victory-point totals. */
  score: Score;
  /** Hex keys of the central flower (centre + 6 neighbours). */
  centerKeys: Set<string>;
  /** For each team, the hex keys that team scores by entering (the ENEMY back line). */
  scoringZone: Record<Team, Set<string>>;
  config: ScoreConfig;
}

export interface ScoreTickResult {
  /** New score totals (never below the input — points only accumulate). */
  score: Score;
  /** Per-team, per-type roster refund for units that reached the enemy line. */
  rosterDelta: RosterDelta;
  /** Ids of units that reached the enemy line and must leave the field. */
  reachedUnitIds: Set<string>;
  /** Team that hit `pointsToWin` this tick, or null. */
  winner: Team | null;
  /** True if either team's score changed. */
  changed: boolean;
}

const TEAMS: readonly Team[] = ['red', 'blue'];

/**
 * One tick of victory-point scoring. Pure: no React/PIXI/I/O.
 *  - Territory reach: a living unit standing in its `scoringZone` (the enemy deploy zone)
 *    scores `pointsPerUnitReached`, refunds 1 of its type to its roster, and is marked for
 *    removal from the field (raid & return).
 *  - Centre hold: uncontested living presence in `centerKeys` accrues `centerHoldPointsPerTick`.
 *    Contested or empty centre scores nobody. Points never decay.
 */
export function scoreTick(input: ScoreTickInput): ScoreTickResult {
  const { units, score, centerKeys, scoringZone, config } = input;
  const next: Score = { red: score.red, blue: score.blue };
  const rosterDelta: RosterDelta = {
    red:  { infantry: 0, cavalry: 0, skirmisher: 0 },
    blue: { infantry: 0, cavalry: 0, skirmisher: 0 },
  };
  const reachedUnitIds = new Set<string>();

  // Territory reach.
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (!scoringZone[u.team].has(HexUtils.key(u.tacticalHex))) continue;
    reachedUnitIds.add(u.id);
    next[u.team] += config.pointsPerUnitReached;
    rosterDelta[u.team][u.unitType ?? 'infantry'] += 1;
  }

  // Centre hold. A unit reaching the enemy line can't also sit in the centre, so the two
  // passes don't double-count.
  let redCenter = 0, blueCenter = 0;
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (!centerKeys.has(HexUtils.key(u.tacticalHex))) continue;
    if (u.team === 'red') redCenter++; else blueCenter++;
  }
  if (redCenter > 0 && blueCenter === 0) next.red += config.centerHoldPointsPerTick;
  else if (blueCenter > 0 && redCenter === 0) next.blue += config.centerHoldPointsPerTick;

  let winner: Team | null = null;
  for (const t of TEAMS) {
    if (next[t] >= config.pointsToWin) { winner = t; break; }
  }

  const changed = next.red !== score.red || next.blue !== score.blue;
  return { score: next, rosterDelta, reachedUnitIds, winner, changed };
}
```

- [ ] **Step 4: Run the test script to confirm it passes**

Run: `npx tsx scripts/sim-scoring.ts`
Expected: PASS — all checks print `✓` and the final line is `All scoring checks passed.` (exit code 0).

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/battle/scoring.ts scripts/sim-scoring.ts
git commit -m "feat: pure scoreTick (territory reach + center hold + roster refund)"
```

---

### Task 3: Wire scoring into the battle tick loop

**Files:**
- Modify: `src/canvas/constants.ts` (re-export the new scoring symbols)
- Modify: `src/canvas/useBattleTick.ts` (ctx interface + replace capture block)

- [ ] **Step 1: Re-export scoring symbols from `constants.ts`**

`constants.ts` is the canvas-side aggregator that re-exports game config. Add the scoring re-exports so HUD/tick-loop import them from the same place as the other tunables.

Add the import near the top of `src/canvas/constants.ts` (after the existing `from '../data/game'` import block, around line 17):

```ts
import {
  POINTS_TO_WIN,
  POINTS_PER_UNIT_REACHED,
  CENTER_HOLD_POINTS_PER_TICK,
} from '../data/scoring';
```

Then add to the re-export `export { ... }` block (the one starting at line 23, alongside `CAPTURE_CENTER` etc.):

```ts
  POINTS_TO_WIN,
  POINTS_PER_UNIT_REACHED,
  CENTER_HOLD_POINTS_PER_TICK,
```

- [ ] **Step 2: Update the `BattleTickCtx` interface in `useBattleTick.ts`**

In `src/canvas/useBattleTick.ts`, replace the `captureProgressRef` field and the `setCaptureProgress` setter with score equivalents, and add a `setRosters` setter. The current fields (lines 24 and 35) read:

```ts
  captureProgressRef: MutableRefObject<{ red: number; blue: number }>;
```
```ts
  setCaptureProgress: Dispatch<SetStateAction<{ red: number; blue: number }>>;
```

Change the ref field (line 24) to:

```ts
  scoreRef: MutableRefObject<{ red: number; blue: number }>;
```

Change the setter (line 35) to:

```ts
  setScore: Dispatch<SetStateAction<{ red: number; blue: number }>>;
```

Add this line directly after the `setWinBanner` field (around line 36):

```ts
  setRosters: Dispatch<SetStateAction<Rosters>>;
```

- [ ] **Step 3: Update imports in `useBattleTick.ts`**

The import block from `./constants` (lines 12-16) currently reads:

```ts
import {
  DAMAGE_PER_TICK, TICK_MS, CAPTURE_TICKS_TO_WIN, CAPTURE_ZONE_HEXES,
  captureZoneKeys, deployZoneFor,
  type Armies, type GroupOrders,
} from './constants';
```

Replace it with (drops `CAPTURE_TICKS_TO_WIN`, adds the scoring symbols + `Rosters` type):

```ts
import {
  DAMAGE_PER_TICK, TICK_MS, CAPTURE_ZONE_HEXES,
  POINTS_TO_WIN, POINTS_PER_UNIT_REACHED, CENTER_HOLD_POINTS_PER_TICK,
  captureZoneKeys, deployZoneFor,
  type Armies, type GroupOrders, type Rosters,
} from './constants';
```

Add the scoreTick import after the `command-points` import (line 11):

```ts
import { scoreTick } from '../battle/scoring';
```

- [ ] **Step 4: Replace the capture block + annihilation block**

In `src/canvas/useBattleTick.ts`, replace the entire region from `const next = result.units;` (line 158) through the `setArmies` call and the trailing `setGroupOrders` line (line 217) — i.e. the capture block, annihilation block, and the two final setters — with the following:

```ts
      const next = result.units;

      // Scoring tick (race to POINTS_TO_WIN). Two point sources:
      //  - a living unit standing in the ENEMY deploy zone scores POINTS_PER_UNIT_REACHED,
      //    refunds 1 of its type to its roster, and leaves the field (raid & return);
      //  - uncontested presence in the central flower accrues CENTER_HOLD_POINTS_PER_TICK.
      // Points only accumulate — they never decay. Annihilation below is still a fallback.
      const sc = scoreTick({
        units: next,
        score: ctx.scoreRef.current,
        centerKeys: captureZoneKeys(),
        scoringZone: { red: deployZones.blue, blue: deployZones.red },
        config: {
          pointsToWin: POINTS_TO_WIN,
          pointsPerUnitReached: POINTS_PER_UNIT_REACHED,
          centerHoldPointsPerTick: CENTER_HOLD_POINTS_PER_TICK,
        },
      });
      const survivors = sc.reachedUnitIds.size > 0
        ? next.filter(u => !sc.reachedUnitIds.has(u.id))
        : next;
      if (sc.changed) {
        ctx.scoreRef.current = sc.score;
        ctx.setScore(sc.score);
      }
      if (sc.reachedUnitIds.size > 0) {
        ctx.setRosters(prev => {
          const m = new Map(prev);
          for (const team of (['red', 'blue'] as const)) {
            const d = sc.rosterDelta[team];
            if (d.infantry === 0 && d.cavalry === 0 && d.skirmisher === 0) continue;
            const r = m.get(team)!;
            m.set(team, {
              infantry: r.infantry + d.infantry,
              cavalry: r.cavalry + d.cavalry,
              skirmisher: r.skirmisher + d.skirmisher,
            });
          }
          return m;
        });
      }
      if (sc.winner) {
        ctx.setWinBanner(sc.winner);
        ctx.setIsBattleRunning(false);
        window.setTimeout(() => ctx.setWinBanner(null), 3000);
      }

      const teamsAfter = new Set(survivors.map(u => u.team));
      if (teamsAfter.size === 1 && ctx.lastTickHadBothTeamsRef.current) {
        const winner = survivors[0]?.team ?? null;
        if (winner) {
          ctx.setWinBanner(winner);
          ctx.setIsBattleRunning(false);
          ctx.lastTickHadBothTeamsRef.current = false;
          window.setTimeout(() => ctx.setWinBanner(null), 3000);
        }
      }
      ctx.setArmies(prev => {
        const updated = new Map(prev);
        updated.set(strategicKey, survivors);
        return updated;
      });
      if (result.orders !== ctx.groupOrdersRef.current) ctx.setGroupOrders(result.orders);
```

- [ ] **Step 5: Type-check (will still fail until Task 4 wires GameCanvas)**

Run: `npm run build`
Expected: FAIL — `GameCanvas.tsx` still passes `captureProgressRef` / `setCaptureProgress` and omits `scoreRef` / `setScore` / `setRosters`. This is expected; Task 4 fixes it. (If you prefer a green build between commits, do Steps 5-6 of this task together with Task 4 before building.)

- [ ] **Step 6: Commit**

```bash
git add src/canvas/constants.ts src/canvas/useBattleTick.ts
git commit -m "feat: wire scoreTick into battle tick loop; rename capture progress to score"
```

---

### Task 4: Update GameCanvas state + ctx wiring

**Files:**
- Modify: `src/components/GameCanvas.tsx`

- [ ] **Step 1: Rename the capture-progress state to score**

In `src/components/GameCanvas.tsx`, the current declarations (lines 327-329) read:

```ts
  const [captureProgress, setCaptureProgress] = useState<{ red: number; blue: number }>({ red: 0, blue: 0 });
  const captureProgressRef = useRef<{ red: number; blue: number }>({ red: 0, blue: 0 });
  useEffect(() => { captureProgressRef.current = captureProgress; }, [captureProgress]);
```

Replace with:

```ts
  const [score, setScore] = useState<{ red: number; blue: number }>({ red: 0, blue: 0 });
  const scoreRef = useRef<{ red: number; blue: number }>({ red: 0, blue: 0 });
  useEffect(() => { scoreRef.current = score; }, [score]);
```

- [ ] **Step 2: Update the `battleCtx` object**

In the `battleCtx` literal (lines 450-469), change the `captureProgressRef` and `setCaptureProgress` entries and add `setRosters`. The current relevant lines read:

```ts
    captureProgressRef,
```
```ts
    setCaptureProgress,
```

Replace `captureProgressRef,` with:

```ts
    scoreRef,
```

Replace `setCaptureProgress,` with:

```ts
    setScore,
    setRosters,
```

(`setRosters` already exists — it's the setter from `const [rosters, setRosters] = useState<Rosters>(makeInitialRosters)` at line 130.)

- [ ] **Step 3: Update the HUD prop**

In the `<HUD ... />` JSX (line 720), change:

```ts
      captureProgress={captureProgress}
```

to:

```ts
      score={score}
```

- [ ] **Step 4: Update the three reset functions**

`resetBattle` (lines 625-626), `returnToStrategic` (lines 644-645), and `regenerateWorld` (lines 663-664) each contain these two lines:

```ts
    setCaptureProgress({ red: 0, blue: 0 });
    captureProgressRef.current = { red: 0, blue: 0 };
```

In all three functions, replace that pair with:

```ts
    setScore({ red: 0, blue: 0 });
    scoreRef.current = { red: 0, blue: 0 };
```

(`setRosters(makeInitialRosters())` is already called in all three, so rosters reset is already handled.)

- [ ] **Step 5: Type-check (still fails until Task 5 updates HUD prop name)**

Run: `npm run build`
Expected: FAIL — `HUD.tsx` still declares the `captureProgress` prop and uses `CAPTURE_TICKS_TO_WIN`. Task 5 fixes it.

- [ ] **Step 6: Commit**

```bash
git add src/components/GameCanvas.tsx
git commit -m "feat: rename capture-progress state to score; pass setRosters to tick loop"
```

---

### Task 5: Rebuild the HUD score strip

**Files:**
- Modify: `src/canvas/HUD.tsx`

- [ ] **Step 1: Update HUD imports**

In `src/canvas/HUD.tsx`, the import from `./constants` (lines 7-10) reads:

```ts
import {
  CAPTURE_TICKS_TO_WIN, COHORT_SIZE, RETREAT_REFUND_FRAC,
  FORMATION_LABELS, TEAM_TINTS, HEADING_ARROWS, groupOrderKey,
} from './constants';
```

Replace `CAPTURE_TICKS_TO_WIN` with `POINTS_TO_WIN`:

```ts
import {
  POINTS_TO_WIN, COHORT_SIZE, RETREAT_REFUND_FRAC,
  FORMATION_LABELS, TEAM_TINTS, HEADING_ARROWS, groupOrderKey,
} from './constants';
```

- [ ] **Step 2: Rename the `captureProgress` prop in the interface**

In `HUDProps` (line 26):

```ts
  captureProgress: { red: number; blue: number };
```

Replace with:

```ts
  score: { red: number; blue: number };
```

- [ ] **Step 3: Rename the destructured prop**

In the component's destructured params (line 88):

```ts
  captureProgress,
```

Replace with:

```ts
  score,
```

- [ ] **Step 4: Rewrite the score strip JSX**

Replace the entire capture-progress strip block (lines 154-199, the comment `{/* Capture progress strip ... */}` through its closing `)}`) with the victory-points strip below. It reads from `score` and `POINTS_TO_WIN`, shows rounded totals, and never implies decay:

```tsx
      {/* Victory-points strip — top-centre. Two bars race to POINTS_TO_WIN. Points come from
          reaching the enemy line (raid & return) + holding the centre uncontested. Only
          visible once a battle is in progress (currentStrategicHex is set). */}
      {viewMode === 'TACTICAL' && currentStrategicHex && (
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 18px',
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(250,204,21,0.5)',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          zIndex: 150,
          minWidth: '280px',
          pointerEvents: 'none',
        }}>
          <div style={{
            fontSize: '10px', color: '#facc15', fontWeight: 800, letterSpacing: '2px',
            marginBottom: '8px', textAlign: 'center',
          }}>
            VICTORY POINTS — FIRST TO {POINTS_TO_WIN}
          </div>
          {(['red', 'blue'] as const).map(team => {
            const v = score[team];
            const pct = Math.min(100, (v / POINTS_TO_WIN) * 100);
            const color = team === 'red' ? '#ef4444' : '#3b82f6';
            return (
              <div key={team} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: team === 'red' ? '6px' : 0 }}>
                <span style={{ fontSize: '10px', color, fontWeight: 800, width: '38px', letterSpacing: '1px' }}>
                  {team.toUpperCase()}
                </span>
                <div style={{
                  flex: 1, height: '8px', background: 'rgba(255,255,255,0.08)',
                  borderRadius: '4px', overflow: 'hidden',
                }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
                </div>
                <span style={{ fontSize: '10px', color: '#cbd5e1', fontWeight: 700, width: '40px', textAlign: 'right' }}>
                  {Math.round(v)}/{POINTS_TO_WIN}
                </span>
              </div>
            );
          })}
        </div>
      )}
```

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: PASS — all `captureProgress` / `CAPTURE_TICKS_TO_WIN` references are now gone from HUD, GameCanvas, and the tick loop, and the new ctx wiring lines up.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/HUD.tsx
git commit -m "feat: HUD score strip — race to POINTS_TO_WIN instead of hold-the-centre ticks"
```

---

### Task 6: Remove dead capture-ticks config + full verification

The old `ticksToWin` tunable and its `CAPTURE_TICKS_TO_WIN` export are now unused (the `capture.center` field is still needed for the central flower, so keep it). Remove the dead value and run the full verification pass.

**Files:**
- Modify: `src/data/game.json`
- Modify: `src/data/game.ts`
- Modify: `src/canvas/constants.ts`

- [ ] **Step 1: Remove `ticksToWin` from the JSON**

In `src/data/game.json` the `capture` block (lines 9-12) reads:

```json
  "capture": {
    "ticksToWin": 20,
    "center":     { "q": 0, "r": 0 }
  },
```

Replace with:

```json
  "capture": {
    "center": { "q": 0, "r": 0 }
  },
```

- [ ] **Step 2: Remove `CAPTURE_TICKS_TO_WIN` from `game.ts`**

In `src/data/game.ts`, change the `capture` type in the `GameConfig` interface (line 15):

```ts
  capture: { ticksToWin: number; center: Hex };
```

to:

```ts
  capture: { center: Hex };
```

Then delete the legacy export line (line 31):

```ts
export const CAPTURE_TICKS_TO_WIN = GAME.capture.ticksToWin;
```

- [ ] **Step 3: Remove `CAPTURE_TICKS_TO_WIN` from `constants.ts`**

In `src/canvas/constants.ts`, delete `CAPTURE_TICKS_TO_WIN,` from the import list from `../data/game` (it appears around line 8). Then in the `export { ... }` block, delete the `CAPTURE_TICKS_TO_WIN,` line **and** its preceding multi-line comment (the block starting `// Capture-the-flag win condition. ...` through `// → that team wins. Annihilation still applies as a fallback.`, lines 31-35). Keep `CAPTURE_CENTER,` immediately after — it is still used by `captureZoneKeys`, `CAPTURE_ZONE_HEXES`, and the capture-zone rendering.

- [ ] **Step 4: Confirm no stragglers remain**

Run: `npx rg "CAPTURE_TICKS_TO_WIN|ticksToWin|captureProgress" src scripts`
Expected: no matches. (If any remain, fix them before continuing.)

- [ ] **Step 5: Full type-check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Re-run the scoring checks**

Run: `npx tsx scripts/sim-scoring.ts`
Expected: PASS — `All scoring checks passed.`

- [ ] **Step 7: Confirm the existing sim is unchanged**

Run: `npx tsx scripts/sim-formations.ts`
Expected: same per-scenario results as before this branch's changes (we did not touch `simulateTick`). Eyeball for drift.

- [ ] **Step 8: Manual browser verification**

Run: `npm run dev` (use `-- --port 5174` if 5173 is taken). Then:
- Dive into a tactical view, deploy red and blue cohorts, START BATTLE.
- March a red group north into blue's deploy strip → confirm: the strip's units vanish on arrival, RED's score jumps by the unit count, and the RED roster counts (HUD deploy buttons `×N`) increase by the same per-type counts.
- Hold the centre flower uncontested with one team → confirm its score ticks up by 1 per tick (2/sec) and does **not** drop when briefly contested (it just stops).
- Drive a team to `POINTS_TO_WIN` → confirm the `<TEAM> VICTORY` banner fires and the battle stops.
- RESET BATTLE → confirm score returns to 0/100 and rosters restore to the initial 50/50/50.

- [ ] **Step 9: Final commit**

```bash
git add src/data/game.json src/data/game.ts src/canvas/constants.ts
git commit -m "chore: remove dead capture ticksToWin config (superseded by scoring)"
```

---

## Notes for the implementer

- **`src/data` import direction:** `scoring.ts` may import from `game.ts` (both in `src/data`, one-directional). Never make `src/data/*` value-import from `src/canvas/*` or `src/battle/*`.
- **Monotonic tick counter:** This plan does not touch `tickCounterRef` — leave its reset rules alone (reset only on regenerate / return-to-strategic).
- **Why scoring lives in the tick loop, not `simulateTick`:** like the old capture logic, scoring needs the rosters, deploy zones, and React setters that live in the canvas layer. `simulateTick` stays pure and movement-only, so `scripts/sim-formations.ts` is unaffected. The new pure piece (`scoreTick`) is unit-tested by `scripts/sim-scoring.ts` instead.
- **Fractional points:** `CENTER_HOLD_POINTS_PER_TICK` is `perSecond * TICK_MS / 1000`. With the defaults it is exactly 1.0; non-default values may be fractional, which is why the HUD renders `Math.round(v)` and the win check uses `>=`.
