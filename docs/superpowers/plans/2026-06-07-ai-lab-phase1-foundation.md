# AI Lab — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-team AI **profile** model + persistence, make `makeAiController` honour a profile, extract a browser-importable simulator core (`runSeries`), and have the game boot from saved profiles — so the Phase-2 SPA can edit/persist/simulate AI configs.

**Architecture:** A new pure module `src/data/ai-profile.ts` defines `TeamAiProfile` (per-team override of every AI knob), `resolveProfile()` (deep-merge over `ai.json`), and `localStorage` load/save. `makeAiController` gains a profile-taking entry point that reads the resolved values instead of the globals. The AI-vs-AI match loop moves from `scripts/sim-ai-vs-ai.ts` into `src/sim/runMatch.ts` (browser-safe) and gains `runSeries()`. `GameCanvas` seeds its per-team AI config from saved profiles.

**Tech Stack:** TypeScript, pure functions for `src/battle`/`src/data`/`src/sim` (no React/PIXI), `tsx` headless test scripts, React for GameCanvas wiring. Spec: `docs/superpowers/specs/2026-06-07-ai-lab-tuning-spa-design.md`.

**Shared facts for the engineer:**
- `src/data/ai.ts` exports `AI` (the config singleton), types `Doctrine`, `Difficulty`, `AiCapability`, and the block interfaces `CombatConfig`, `CounterConfig`, `StrategyConfig`. `AI.difficulties[d]` has `reactionTicks, cpBudgetFrac, forceScale, capabilities` plus optional `serialWaves/fastDeploy/horizontalFront/frontLines`. `AI.combat/counter/strategy` are global blocks. `AI.doctrines[doc]` has `front`/`reserve`.
- `UnitType` is from `src/battle/simulate`.
- `src/battle/`, `src/data/`, `src/sim/` must stay free of React/PIXI imports. They may import `src/canvas/constants` (it's HexUtils+data only, browser+Node safe — the harness already imports `deployZoneFor` from it).
- Test scripts follow the `scripts/test-*.ts` pattern: local `check(name, cond, extra)`, tally `pass`/`fail`, `process.exit(fail > 0 ? 1 : 0)`. Run with `npx tsx scripts/<file>.ts`.
- The repo style (CLAUDE.md): minimal code; comments only for non-obvious WHY; no dead code.

---

### Task 1: `TeamAiProfile` model + `resolveProfile`

**Files:**
- Create: `src/data/ai-profile.ts`
- Create: `scripts/test-ai-profile.ts`

- [ ] **Step 1: Write the failing test** — create `scripts/test-ai-profile.ts`:

```ts
// TeamAiProfile resolution: a profile merges its overrides over the ai.json difficulty defaults.
// Run: npx tsx scripts/test-ai-profile.ts
import { resolveProfile, profileFromDifficulty, DEFAULT_LINE_TYPES } from '../src/data/ai-profile';
import { AI } from '../src/data/ai';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const test = resolveProfile(profileFromDifficulty('test'));
check('test resolves frontLines=true', test.frontLines === true);
check('test capabilities = [defend]', test.capabilities.length === 1 && test.capabilities[0] === 'defend');
check('test reactionTicks = 10', test.reactionTicks === 10);
check('default lineTypes is inf,skir,cav', test.lineTypes.join(',') === DEFAULT_LINE_TYPES.join(','));

const normal = resolveProfile(profileFromDifficulty('normal'));
check('normal has no deploy flags', !normal.frontLines && !normal.serialWaves && !normal.horizontalFront && !normal.fastDeploy);

const over = resolveProfile({ doctrine: 'balanced', difficulty: 'test', reactionTicks: 3, forceScale: 1.1 });
check('reactionTicks override wins', over.reactionTicks === 3);
check('forceScale override wins', over.forceScale === 1.1);

const cm = resolveProfile({ doctrine: 'balanced', difficulty: 'normal', combat: { chargeReach: 9 } });
check('combat override applies', cm.combat.chargeReach === 9);
check('combat override keeps other defaults', cm.combat.engageRange === AI.combat.engageRange);

const lt = resolveProfile({ doctrine: 'balanced', difficulty: 'test', lineTypes: ['cavalry', 'infantry'] });
check('lineTypes override wins', lt.lineTypes.join(',') === 'cavalry,infantry');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-ai-profile.ts`
Expected: FAIL — module `../src/data/ai-profile` does not exist.

- [ ] **Step 3: Implement the model** — create `src/data/ai-profile.ts`:

```ts
import { AI } from './ai';
import type { Doctrine, Difficulty, AiCapability, CombatConfig, CounterConfig, StrategyConfig } from './ai';
import type { UnitType } from '../battle/simulate';

/** Default per-line unit-type cycle for the frontLines doctrine (mirrors planFrontLines' default). */
export const DEFAULT_LINE_TYPES: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];

/** Per-team override of every AI knob. Unset fields fall back to the chosen difficulty's defaults
 *  (and to the global ai.json blocks for combat/counter/strategy). */
export interface TeamAiProfile {
  doctrine: Doctrine;
  difficulty: Difficulty;
  reactionTicks?: number;
  cpBudgetFrac?: number;
  forceScale?: number;
  capabilities?: AiCapability[];
  serialWaves?: boolean;
  fastDeploy?: boolean;
  horizontalFront?: boolean;
  frontLines?: boolean;
  lineTypes?: UnitType[];
  combat?: Partial<CombatConfig>;
  counter?: Partial<CounterConfig>;
  strategy?: Partial<StrategyConfig>;
}

/** A profile with every field filled in (overrides merged over ai.json). */
export interface ResolvedProfile {
  doctrine: Doctrine;
  reactionTicks: number;
  cpBudgetFrac: number;
  forceScale: number;
  capabilities: AiCapability[];
  serialWaves: boolean;
  fastDeploy: boolean;
  horizontalFront: boolean;
  frontLines: boolean;
  lineTypes: UnitType[];
  combat: CombatConfig;
  counter: CounterConfig;
  strategy: StrategyConfig;
}

export function resolveProfile(p: TeamAiProfile): ResolvedProfile {
  const base = AI.difficulties[p.difficulty];
  return {
    doctrine: p.doctrine,
    reactionTicks: p.reactionTicks ?? base.reactionTicks,
    cpBudgetFrac: p.cpBudgetFrac ?? base.cpBudgetFrac,
    forceScale: p.forceScale ?? base.forceScale,
    capabilities: p.capabilities ?? base.capabilities,
    serialWaves: p.serialWaves ?? base.serialWaves ?? false,
    fastDeploy: p.fastDeploy ?? base.fastDeploy ?? false,
    horizontalFront: p.horizontalFront ?? base.horizontalFront ?? false,
    frontLines: p.frontLines ?? base.frontLines ?? false,
    lineTypes: p.lineTypes ?? DEFAULT_LINE_TYPES,
    combat: { ...AI.combat, ...p.combat },
    counter: { ...AI.counter, ...p.counter },
    strategy: { ...AI.strategy, ...p.strategy },
  };
}

export function profileFromDifficulty(difficulty: Difficulty, doctrine: Doctrine = 'balanced'): TeamAiProfile {
  return { doctrine, difficulty };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-ai-profile.ts`
Expected: `9/9 passed`.

- [ ] **Step 5: Type-check & commit**

Run: `npx tsc -b` → no errors.
```bash
git add src/data/ai-profile.ts scripts/test-ai-profile.ts
git commit -m "feat(ai): TeamAiProfile model + resolveProfile (merge over ai.json)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `localStorage` persistence for profiles

**Files:**
- Modify: `src/data/ai-profile.ts` (append)
- Create: `scripts/test-ai-profile-storage.ts`

- [ ] **Step 1: Write the failing test** — create `scripts/test-ai-profile-storage.ts`:

```ts
// Profiles persist to localStorage; load returns defaults when empty/corrupt. Run: npx tsx scripts/test-ai-profile-storage.ts
// Stub localStorage BEFORE calling load/save (the module reads it at call time, not import time).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

import { loadAiProfiles, saveAiProfiles, AI_PROFILES_KEY, profileFromDifficulty } from '../src/data/ai-profile';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

check('empty store → defaults (normal/normal)',
  loadAiProfiles().red.difficulty === 'normal' && loadAiProfiles().blue.difficulty === 'normal');

saveAiProfiles({ red: profileFromDifficulty('test'), blue: profileFromDifficulty('hard') });
const loaded = loadAiProfiles();
check('round-trips red', loaded.red.difficulty === 'test');
check('round-trips blue', loaded.blue.difficulty === 'hard');

store.set(AI_PROFILES_KEY, 'not json{');
check('corrupt JSON → defaults', loadAiProfiles().red.difficulty === 'normal');

store.set(AI_PROFILES_KEY, JSON.stringify({ red: profileFromDifficulty('easy') })); // missing blue
check('missing-side → defaults', loadAiProfiles().blue.difficulty === 'normal');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-ai-profile-storage.ts`
Expected: FAIL — `loadAiProfiles`/`saveAiProfiles`/`AI_PROFILES_KEY` not exported.

- [ ] **Step 3: Implement persistence** — append to `src/data/ai-profile.ts`:

```ts
export const AI_PROFILES_KEY = 'hex-tactics:ai-profiles';

export interface AiProfiles { red: TeamAiProfile; blue: TeamAiProfile; }

const defaultProfiles = (): AiProfiles => ({
  red: profileFromDifficulty('normal'),
  blue: profileFromDifficulty('normal'),
});

/** Read saved per-team profiles. Returns defaults when storage is unavailable, empty, or corrupt. */
export function loadAiProfiles(): AiProfiles {
  try {
    if (typeof localStorage === 'undefined') return defaultProfiles();
    const raw = localStorage.getItem(AI_PROFILES_KEY);
    if (!raw) return defaultProfiles();
    const parsed = JSON.parse(raw) as Partial<AiProfiles>;
    if (!parsed || !parsed.red || !parsed.blue) return defaultProfiles();
    return { red: parsed.red, blue: parsed.blue };
  } catch {
    return defaultProfiles();
  }
}

/** Persist per-team profiles. No-op when storage is unavailable (headless). */
export function saveAiProfiles(p: AiProfiles): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AI_PROFILES_KEY, JSON.stringify(p));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-ai-profile-storage.ts`
Expected: `5/5 passed`.

- [ ] **Step 5: Type-check & commit**

Run: `npx tsc -b` → no errors.
```bash
git add src/data/ai-profile.ts scripts/test-ai-profile-storage.ts
git commit -m "feat(ai): localStorage load/save for per-team AI profiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `makeAiController` honours a `TeamAiProfile`

Add a profile-taking entry point and refactor the controller body to read resolved values instead of `AI.*`/`diff.*`. Keep the existing positional signature working (it delegates).

**Files:**
- Modify: `src/battle/ai/controller.ts`

- [ ] **Step 1: Add the import** — at the top of `src/battle/ai/controller.ts`, after the existing `import { ... } from './deploy';` line, add:

```ts
import { resolveProfile, type TeamAiProfile } from '../../data/ai-profile';
```

- [ ] **Step 2: Split the signature into a positional wrapper + a profile entry point.**

Replace the current header (from `export function makeAiController(` through the line `const frontLines = diff.frontLines ?? false;`) with:

```ts
export function makeAiController(
  team: Team, doctrine: Doctrine, difficulty: Difficulty,
  capabilities?: AiCapability[], reactionTicksOverride?: number,
): AiTickFn {
  return makeAiControllerProfile(team, { doctrine, difficulty, capabilities, reactionTicks: reactionTicksOverride });
}

export function makeAiControllerProfile(team: Team, profile: TeamAiProfile): AiTickFn {
  const r = resolveProfile(profile);
  const doc = AI.doctrines[r.doctrine];
  const reactionTicks = r.reactionTicks;
  // The difficulty axis: which smart behaviours this AI executes. Absent ones downgrade to the
  // always-on baseline (deploy / march-to-centre / hold).
  const can = new Set(r.capabilities);
  const serial = r.serialWaves;
  const fastDeploy = r.fastDeploy;
  const horizontal = r.horizontalFront;
  const frontLines = r.frontLines;
  const lineTypes = r.lineTypes;
```

(The old `const doc = AI.doctrines[doctrine]; const diff = AI.difficulties[difficulty]; const reactionTicks = reactionTicksOverride ?? diff.reactionTicks; const can = new Set(capabilities ?? diff.capabilities);` and the four `diff.*` flag lines are now replaced by the resolved-value reads above. `diff` no longer exists.)

- [ ] **Step 3: Repoint the remaining `AI.*` / `diff.*` reads to the resolved profile.** In the body of `makeAiControllerProfile`, make these exact replacements:

- `const c = AI.counter;` → `const c = r.counter;`
- `const combat = AI.combat;` → `const combat = r.combat;`
- `const strat = AI.strategy;` → `const strat = r.strategy;`
- In the `targetUnits` line, `Math.floor(state.deployZone.size * 0.5 * diff.forceScale)` → `... * 0.5 * r.forceScale)`
- In the budget line, `const budget = Math.floor(state.cp * diff.cpBudgetFrac);` → `const budget = Math.floor(state.cp * r.cpBudgetFrac);`
- In the `planDeployment({ ... })` call, `forceScale: diff.forceScale,` → `forceScale: r.forceScale,`

- [ ] **Step 4: Pass `lineTypes` to the front-lines planner.** In the `planFrontLines({ ... })` call, add `lineTypes`:

```ts
      const plan = frontLines
        ? planFrontLines({
            groupId: grp.g, freeHexes, roster, frontSign,
            waveCohorts: Math.ceil(bandCap(grp.g) / COHORT_SIZE), lineTypes,
          })
        : planDeployment({
```

- [ ] **Step 5: Verify**

Run: `npx tsc -b` → no errors. Confirm there are NO remaining `diff.` references in `controller.ts` (`grep -n "diff\." src/battle/ai/controller.ts` → no matches).

Run: `npx tsx scripts/test-ai-controller.ts` → PASS (the positional wrapper preserves behaviour).

Run: `npx tsx scripts/test-ai-frontlines.ts` → still PASS (planner unaffected; `lineTypes` default unchanged).

Smoke: `npx tsx scripts/sim-ai-vs-ai.ts --trace 2>&1 | tail -3` → runs to a result line (the positional `makeAiController` calls inside the harness still work).

- [ ] **Step 6: Commit**

```bash
git add src/battle/ai/controller.ts
git commit -m "feat(ai): makeAiControllerProfile — controller reads a resolved TeamAiProfile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Extract the simulator core to `src/sim/runMatch.ts` (+ `runSeries`)

Move the AI-vs-AI match loop out of the CLI script into a browser-safe module, switch it to profiles, add `runSeries`, and refactor the script to import the shared core (no duplicated match loop).

**Files:**
- Create: `src/sim/runMatch.ts`
- Modify: `scripts/sim-ai-vs-ai.ts`
- Create: `scripts/test-sim-series.ts`

- [ ] **Step 1: Create `src/sim/runMatch.ts` by moving the shared core from `scripts/sim-ai-vs-ai.ts`.**

Move these symbols verbatim out of the script and into the new module, then apply the transforms below:
- the constants `RADIUS = 12`, `MAX_TICKS = 2000`;
- `grid`, `keyset`, `redZone`, `blueZone`, `centerHexes`, `centerKeys`;
- `mapApi`;
- the `Result` interface;
- the `runMatch` function;
- the `applyRegenLocal` function.

Do NOT move `REVERSE_TICK_ORDER` (it reads `process.argv` — Node-only). Instead, `runMatch` takes an options arg.

The module's imports (copy the ones these symbols use from the script, adjusting the relative paths from `../src/...` to `./...`/`../...`), plus `makeAiControllerProfile` and `TeamAiProfile`:

```ts
import { simulateTick } from '../battle/simulate';
import type { Unit, GroupOrder, Team, UnitType, MapApi } from '../battle/simulate';
import { getTerrainMods } from '../battle/terrain';
import { scoreTick, type Score } from '../battle/scoring';
import { makeAiControllerProfile } from '../battle/ai/controller';
import type { AiTickFn, AiTickState } from '../battle/ai';
import { CP_CAP, CP_INITIAL, CP_REGEN_PER_TICK_STEP, CP_COSTS, type CommandPoints } from '../battle/command-points';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { MAX_HP_BY_TYPE } from '../data/units';
import { POINTS_TO_WIN, POINTS_PER_UNIT_REACHED, CENTER_HOLD_POINTS_PER_TICK, CENTER_HOLD_REGEN_BONUS } from '../data/scoring';
import { CAPTURE_CENTER, INITIAL_ROSTER, COHORT_SIZE } from '../data/game';
import { deployZoneFor } from '../canvas/constants';
import type { TeamAiProfile } from '../data/ai-profile';
```

Transforms when moving:
- Change `runMatch`'s parameter types from `Side` to `TeamAiProfile`: `export function runMatch(red: TeamAiProfile, blue: TeamAiProfile, opts: { reverse?: boolean } = {}): Result`.
- Inside `runMatch`, build controllers via the profile entry point:
  ```ts
  const ctrl: Record<Team, AiTickFn> = {
    red: makeAiControllerProfile('red', red),
    blue: makeAiControllerProfile('blue', blue),
  };
  ```
- Replace the `REVERSE_TICK_ORDER` read with the option: `const tickOrder: Team[] = opts.reverse ? ['blue', 'red'] : ['red', 'blue'];`
- Add `export` to `runMatch`, `applyRegenLocal`, `mapApi`, `grid`, `keyset`, `redZone`, `blueZone`, `centerHexes`, `centerKeys`, `MAX_TICKS`, the `Result` interface (the CLI script's diagnostic modes import several of these).

- [ ] **Step 2: Append `runSeries` + `SimResult` to `src/sim/runMatch.ts`:**

```ts
export interface SimResult {
  reps: number;
  redWins: number; blueWins: number; draws: number;
  avgScoreRed: number; avgScoreBlue: number; avgTicks: number;
}

/** Run `reps` matches of red vs blue and aggregate win counts + average score/length. */
export function runSeries(red: TeamAiProfile, blue: TeamAiProfile, reps: number, opts: { reverse?: boolean } = {}): SimResult {
  let redWins = 0, blueWins = 0, draws = 0, sr = 0, sb = 0, st = 0;
  for (let i = 0; i < reps; i++) {
    const r = runMatch(red, blue, opts);
    if (r.winner === 'red') redWins++; else if (r.winner === 'blue') blueWins++; else draws++;
    sr += r.score.red; sb += r.score.blue; st += r.ticks;
  }
  const n = Math.max(1, reps);
  return { reps, redWins, blueWins, draws, avgScoreRed: sr / n, avgScoreBlue: sb / n, avgTicks: st / n };
}
```

- [ ] **Step 3: Refactor `scripts/sim-ai-vs-ai.ts` to import the shared core.**

- Remove the moved symbols (the consts, `mapApi`, `Result`, `runMatch`, `applyRegenLocal`) — but KEEP `RADIUS`/`MAX_TICKS` usages working by importing them.
- Keep `const REVERSE_TICK_ORDER = process.argv.includes('--rev');` in the script.
- Replace the `Side` interface with a type alias to the profile (the harness's mode functions pass `{ doctrine, difficulty, capabilities?, reactionTicks? }` objects, which are valid `TeamAiProfile`s): `type Side = TeamAiProfile;`
- Add imports at the top:
  ```ts
  import { runMatch, runSeries, applyRegenLocal, grid, mapApi, redZone, blueZone, centerHexes, centerKeys, MAX_TICKS, type Result } from '../src/sim/runMatch';
  import type { TeamAiProfile } from '../src/data/ai-profile';
  ```
  (Remove only imports the moved code used EXCLUSIVELY: `getTerrainMods` and `MapApi` (used only by the moved `mapApi`), and `CP_CAP` + `CENTER_HOLD_REGEN_BONUS` (used only by the moved `applyRegenLocal`). KEEP `MAX_HP_BY_TYPE`, `INITIAL_ROSTER`, `CP_INITIAL`, `CP_REGEN_PER_TICK_STEP`, `CP_COSTS`, `simulateTick`, `scoreTick`, `POINTS_*`, `CAPTURE_CENTER`, `COHORT_SIZE`, `HexUtils`, and the `Unit`/`GroupOrder`/`UnitType`/`Score`/`AiTickState` types — the `trace()` inline loop still uses them. Let a final `tsc -b` confirm no unused-import errors.)
- Where the script's `runMatch(a, b)` calls (in `study`/`mech`/`ablate`/`tune`/`sweep`/`bisect`) need the reverse flag, pass it: `runMatch(a, b, { reverse: REVERSE_TICK_ORDER })`. (Plain `runMatch(a, b)` is also fine where reverse is irrelevant.)
- The `trace()` function keeps its inline instrumented loop, now using the IMPORTED `grid`, `mapApi`, `redZone`, `blueZone`, `centerHexes`, `centerKeys`, `applyRegenLocal`, `MAX_TICKS`, and honouring `REVERSE_TICK_ORDER` as before.

- [ ] **Step 4: Write the series test** — create `scripts/test-sim-series.ts`:

```ts
// runSeries aggregates N matches into win counts that sum to N. Run: npx tsx scripts/test-sim-series.ts
import { runSeries } from '../src/sim/runMatch';
import { profileFromDifficulty } from '../src/data/ai-profile';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const res = runSeries(profileFromDifficulty('test'), profileFromDifficulty('normal'), 6);
check('reps recorded', res.reps === 6);
check('wins+draws sum to reps', res.redWins + res.blueWins + res.draws === 6, `${res.redWins}/${res.blueWins}/${res.draws}`);
check('avg ticks positive', res.avgTicks > 0, `${res.avgTicks.toFixed(0)}`);
check('test (frontLines) beats normal as red majority', res.redWins >= res.blueWins, `red ${res.redWins} blue ${res.blueWins}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 5: Verify**

Run: `npx tsx scripts/test-sim-series.ts` → `4/4 passed`.
Run: `npx tsc -b` → no errors.
Run: `npx tsx scripts/sim-ai-vs-ai.ts --bisect 4 2>&1 | tail -4` → still prints a bisection table (proves the script's modes work off the imported core).
Run: `npx tsx scripts/sim-ai-vs-ai.ts --trace 2>&1 | tail -3` → still prints a trace ending in a result line.

- [ ] **Step 6: Commit**

```bash
git add src/sim/runMatch.ts scripts/sim-ai-vs-ai.ts scripts/test-sim-series.ts
git commit -m "refactor(ai): extract runMatch/runSeries to src/sim (browser-safe, profile-based)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: GameCanvas boots from saved profiles

Make the in-game per-team AI config carry a full `TeamAiProfile`, seed it from `loadAiProfiles()` at mount, and register controllers via `makeAiControllerProfile`. The HUD's existing per-team toggles keep editing `enabled` / `doctrine` / `difficulty` within the profile.

**Files:**
- Modify: `src/canvas/HUD.tsx`
- Modify: `src/components/GameCanvas.tsx`

- [ ] **Step 1: Redefine `AiTeamConfig` to carry a profile.** In `src/canvas/HUD.tsx`, replace the `AiTeamConfig` interface with:

```ts
/** Per-team AI control: whether the team is bot-driven, plus its full tuning profile. */
export interface AiTeamConfig {
  enabled: boolean;
  profile: TeamAiProfile;
}
```

Add the import near the other type imports in `HUD.tsx`:
```ts
import type { TeamAiProfile } from '../data/ai-profile';
```
(The value imports `DOCTRINES`/`DIFFICULTIES` are still used by the buttons. If `tsc` flags the `type { Doctrine, Difficulty }` import as unused after this change, remove the unused names.)

- [ ] **Step 2: Update the HUD render block to read/write `profile`.** In the `AI CONTROL` block, the per-team controls now read `c.profile.doctrine` / `c.profile.difficulty` and write via the profile. Replace the body of the `(['red','blue'] as const).map(team => { ... })` callback's relevant lines:

- `const c = aiConfig[team];` stays.
- The toggle button label `→ ${c.doctrine} · ${c.difficulty}` → `→ ${c.profile.doctrine} · ${c.profile.difficulty}`.
- The enable toggle: `setTeamAi(team, { enabled: !c.enabled })` stays.
- Doctrine buttons: `onClick={() => setTeamAi(team, { doctrine: d })}` → `onClick={() => setTeamAi(team, { doctrine: d })}` stays at the call site, but `setTeamAi`'s patch type changes (Step 4); the active check `c.doctrine === d` → `c.profile.doctrine === d`.
- Difficulty buttons: active check `c.difficulty === f` → `c.profile.difficulty === f`. Call site `setTeamAi(team, { difficulty: f })` stays.

- [ ] **Step 3: Change the `setTeamAi` prop type** in `HUDProps` (`src/canvas/HUD.tsx`):

```ts
  aiConfig: Record<Team, AiTeamConfig>;
  setTeamAi: (team: Team, patch: Partial<TeamAiProfile> & { enabled?: boolean }) => void;
```

- [ ] **Step 4: Update GameCanvas state, setter, effect, and import.** In `src/components/GameCanvas.tsx`:

Change the HUD import to also bring the profile loader path — add near the top:
```ts
import { loadAiProfiles } from '../data/ai-profile';
import type { TeamAiProfile } from '../data/ai-profile';
import { makeAiControllerProfile } from '../battle/ai/controller';
```
(Keep the existing `import { HUD, type AiTeamConfig } from '../canvas/HUD';`. The `makeAiController` import may become unused — if so, remove it.)

Replace the `aiConfig` state + `setTeamAi` helper with:
```ts
  // Per-team AI, seeded from saved profiles (the AI Lab writes these to localStorage). Blue defaults
  // on (classic enemy), red off (the human's side).
  const [aiConfig, setAiConfig] = useState<Record<Team, AiTeamConfig>>(() => {
    const saved = loadAiProfiles();
    return { red: { enabled: false, profile: saved.red }, blue: { enabled: true, profile: saved.blue } };
  });
  const setTeamAi = (team: Team, patch: Partial<TeamAiProfile> & { enabled?: boolean }) =>
    setAiConfig(prev => {
      const { enabled, ...profilePatch } = patch;
      return {
        ...prev,
        [team]: {
          enabled: enabled ?? prev[team].enabled,
          profile: { ...prev[team].profile, ...profilePatch },
        },
      };
    });
```

Replace the registration effect body with:
```ts
  // Install/tear down an AI controller per team from its profile. Either side (or both) can be a bot.
  useEffect(() => {
    for (const team of ['red', 'blue'] as const) {
      const c = aiConfig[team];
      registerAiController(team, c.enabled ? makeAiControllerProfile(team, c.profile) : null);
    }
    return () => { registerAiController('red', null); registerAiController('blue', null); };
  }, [aiConfig]);
```

- [ ] **Step 5: Verify**

Run: `npx tsc -b` → no errors. Confirm no stale references: `grep -rn "c.doctrine\|c.difficulty\|aiConfig\[team\].doctrine" src/` → no matches (all go through `.profile`).

Run: `npm run build` → succeeds (Vite production build; this is the React/PIXI gate). Expected: build completes with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/HUD.tsx src/components/GameCanvas.tsx
git commit -m "feat(ai): game boots per-team AI from saved profiles (makeAiControllerProfile)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc -b` clean.
- [ ] Run the AI/sim tests directly (the `test:ai` chain stops at the pre-existing `test-ai-groups` failure, so invoke individually):
  `npx tsx scripts/test-ai-profile.ts`, `scripts/test-ai-profile-storage.ts`, `scripts/test-sim-series.ts`, `scripts/test-ai-controller.ts`, `scripts/test-ai-frontlines.ts`, `scripts/test-ai-config.ts` — each `N/N passed`.
- [ ] `npx tsx scripts/sim-formations.ts` — unchanged (no sim drift).
- [ ] `npm run build` — succeeds.

## Notes

- After Phase 1, the foundation is done: the game uses persisted per-team profiles, and `runSeries` is importable in the browser. **Phase 2** (separate plan) builds the `AiLab.tsx` editor + simulation panel and the `App.tsx` screen switch.
- `package.json`'s `test:ai` chain may optionally be extended with the three new test scripts, but since the chain already halts on the pre-existing `test-ai-groups` failure, that's deferred (the final-verification step runs them directly).
