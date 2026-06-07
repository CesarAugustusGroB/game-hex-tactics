# AI Lab — Tuning SPA + Simulation (Design)

**Date:** 2026-06-07
**Status:** Approved (interactive)

## Goal

A screen inside the game ("AI LAB") where the user edits **per-team AI parameter
profiles** (red + blue), clicks **Go** to persist them as the game's default AI
behaviour (via `localStorage`), and runs **AI-vs-AI simulations** (red profile vs blue
profile, N matches) to see win-rate and scores — all without leaving the app.

## Decisions (from brainstorming)

- **Persistence:** `localStorage`. The game reads saved profiles at boot (fallback to
  `ai.json` defaults). No server, same origin.
- **Location:** a screen *inside* the Vite/React game app (switch in `App.tsx`), so it
  shares the simulator and the config model directly.
- **Default scope:** **per-team** (red profile + blue profile). The same two profiles
  feed the simulation. Maps onto the per-team AI control already in the game.
- **Sim output:** win% (red/blue/draw) over N reps + average score + average ticks.
- **Override mechanism:** `makeAiController` accepts a `TeamAiProfile` that merges over
  `ai.json` (approach A — explicit, per-team, testable). Not global-singleton mutation.

## Components

### 1. `src/data/ai-profile.ts` (new) — shared model + persistence

```ts
export interface TeamAiProfile {
  doctrine: Doctrine;
  difficulty: Difficulty;        // base whose defaults the rest overrides
  reactionTicks?: number;
  cpBudgetFrac?: number;
  forceScale?: number;
  capabilities?: AiCapability[];
  // deploy flags
  serialWaves?: boolean;
  fastDeploy?: boolean;
  horizontalFront?: boolean;
  frontLines?: boolean;
  lineTypes?: UnitType[];
  // behavioural blocks (override the global ai.json blocks for THIS team)
  combat?: Partial<CombatConfig>;
  counter?: Partial<CounterConfig>;
  strategy?: Partial<StrategyConfig>;
}

export interface ResolvedProfile { /* every field non-optional, merged over ai.json */ }

export function resolveProfile(p: TeamAiProfile): ResolvedProfile; // deep-merge over AI defaults
export function profileFromDifficulty(d: Difficulty): TeamAiProfile; // {doctrine:'balanced', difficulty:d}

export const AI_PROFILES_KEY = 'hex-tactics:ai-profiles';
export function loadAiProfiles(): { red: TeamAiProfile; blue: TeamAiProfile }; // localStorage or defaults
export function saveAiProfiles(p: { red: TeamAiProfile; blue: TeamAiProfile }): void;
```

`resolveProfile` is pure (no DOM); `load/saveAiProfiles` guard `typeof localStorage`.

### 2. `src/battle/ai/controller.ts` — accept a profile

`makeAiController` gains an optional `TeamAiProfile`. Internally it resolves the profile and
reads `resolved.combat/counter/strategy/cpBudgetFrac/forceScale/flags/lineTypes/reactionTicks/
capabilities` instead of the globals `AI.combat`/`AI.counter`/`AI.strategy`/`diff.*`. `lineTypes`
flows into the `planFrontLines` call. The existing positional signature
`(team, doctrine, difficulty, capabilities?, reactionTicks?)` is preserved by building a profile
from those args, so current callers/tests/harness keep working.

### 3. `src/sim/runMatch.ts` (new) — browser-importable simulator core

Extract the pure match runner currently inside `scripts/sim-ai-vs-ai.ts` (the grid, `mapApi`,
`runMatch`, regen helper) into this module. It uses only `src/battle/*`, `src/data/*`,
`src/canvas/constants` (`deployZoneFor`) and `HexUtils` — all browser-safe (no `process`/Node).

```ts
export interface SimResult {
  redWins: number; blueWins: number; draws: number;
  avgScoreRed: number; avgScoreBlue: number; avgTicks: number;
}
export function runSeries(red: TeamAiProfile, blue: TeamAiProfile, reps: number): SimResult;
```

`runMatch(redProfile, blueProfile)` builds controllers via `makeAiController(team, profile)`.
`scripts/sim-ai-vs-ai.ts` is refactored to import `runMatch`/`runSeries` from here (its
`--study`/`--mech`/etc. CLI modes stay; they call the shared core — no duplicated match loop).

### 4. `src/ai-lab/AiLab.tsx` (new) — the SPA screen

- Two columns, **RED** / **BLUE**, each editing a `TeamAiProfile` in React state via grouped
  controls (difficulty preset selector, then number inputs / toggles / multi-selects for the
  override fields — reactionTicks, cpBudgetFrac, forceScale, capabilities, flags, lineTypes,
  combat/counter/strategy fields). Editing a field sets the override; a "reset to difficulty
  default" clears it.
- **Go — save as game defaults** button → `saveAiProfiles({red, blue})`. Shows a confirmation.
- **Simulation panel:** a reps input (default e.g. 20) + **Run** → `runSeries(red, blue, reps)`
  → renders `redWins/blueWins/draws` as win% plus avg scores and avg ticks. Run is synchronous
  for v1 (a few hundred ticks × N is fast); a Web Worker is an optional later refinement if the
  UI janks.
- Styling reuses the dark HUD aesthetic (can lift palette from `docs/ai-parameters.html`).

### 5. `src/App.tsx` — screen switch

Add a top-level screen state (`'game' | 'ai-lab'`), initialised from `?screen=ai-lab` if present.
Render `<GameCanvas/>` or `<AiLab/>`. A small button toggles between them (an "AI LAB" entry in
the HUD or a corner button in-game; an "← BACK TO GAME" in the lab).

### 6. `src/components/GameCanvas.tsx` — consume saved profiles

Initialise the per-team `aiConfig` from `loadAiProfiles()` so saved defaults apply on open. The
registration effect passes the team's `TeamAiProfile` to `makeAiController(team, profile)`. The
existing per-team HUD toggles continue to set `enabled` and show `doctrine · difficulty`; the deep
overrides ride along in the profile.

## Data flow

1. **Edit:** AiLab holds `{red, blue}: TeamAiProfile` in state; controls mutate overrides.
2. **Go:** `saveAiProfiles` → `localStorage`.
3. **Game boot:** `GameCanvas` → `loadAiProfiles()` → seeds `aiConfig` → registers
   `makeAiController(team, profile)` per enabled team.
4. **Simulate:** AiLab → `runSeries(red, blue, reps)` → same `makeAiController` + pure sim →
   `SimResult` → results table.

## Testing

- `scripts/test-ai-profile.ts`: `resolveProfile` merges overrides over `ai.json` correctly;
  `profileFromDifficulty` round-trips; `save`/`loadAiProfiles` round-trip against a stubbed
  `localStorage` (and `load` returns defaults when empty/corrupt).
- `scripts/test-ai-profile-controller.ts` (or extend an existing harness test): a profile override
  (e.g. `reactionTicks` or `forceScale`) measurably changes controller output vs the difficulty
  default.
- `scripts/test-sim-series.ts`: `runSeries` returns counts summing to `reps`, deterministic for a
  fixed pair.
- `tsc -b` clean; existing AI test scripts still pass.
- The `AiLab` UI and `App` switch are verified manually (internal tooling) + a build check.

## Build order (two phases → likely two implementation plans)

- **Phase 1 — foundation:** `ai-profile.ts`, `makeAiController` profile support, `runMatch.ts`
  extraction (+ refactor the CLI script to use it), `GameCanvas` boot from saved profiles, the
  headless tests. Deliverable: the game uses persisted per-team AI profiles; sim core is
  importable. Fully testable without UI.
- **Phase 2 — SPA:** `AiLab.tsx` editor + simulation panel, `App.tsx` screen switch, entry button.
  Deliverable: the user can edit, Go, and run sims.

## Scope notes

- **Per-team AI params** (doc items A + B + doctrines + `lineTypes`) are fully in scope and
  persisted as game defaults.
- **Economy / scoring** (CP `cap`/`initial`/`regenN`, `pointsToWin`, `pointsPerUnitReached`,
  `centerHold*`) are **global match rules, not per-team**, and are currently baked constants.
  Decision: editable in the SPA to parameterise the **simulation only** (passed into `runSeries`'s
  match config), but **deferred** as a game-wide default (applying them to the live game needs a
  separate global-config override mechanism). Marked as a second-tier "Match rules" section.

## Out of scope

- Visual replay of a simulated match (user chose win%+scores only).
- Writing `ai.json` to disk (browser can't; localStorage is the persistence).
- Applying economy/scoring overrides to the live game (sim-only for now).
- A Web Worker for sims (only if the synchronous run janks the UI).
