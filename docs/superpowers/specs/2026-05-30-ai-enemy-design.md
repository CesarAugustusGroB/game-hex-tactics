# Enemy AI — Design

## Goal

Give the `blue` team a brain. Today `src/battle/ai.ts` ships a controller registry and the
tick loop already calls a per-team controller with a team-scoped snapshot, but **no controller
is implemented**, so in single-player the enemy never deploys, moves, or contests. This design
adds an AI that runs the same loop a human runs: it **creates its own groups by painting cohorts**
from a roster fixed at the start, then **commands** those groups (march / hold / charge / unleash /
retreat) toward the victory conditions.

Two independent axes:

- **Doctrine** — *what it wants*: `balanced` / `aggressive` / `defensive`.
- **Difficulty** — *how well it executes*: modulates reaction cadence, decision quality, and
  CP usage / army size.

## Architecture

The controller lives **outside the sim** (`simulate.ts` stays pure) and **outside `GameCanvas`**
(which stays render/input). It is a pure factory whose returned `AiTickFn` keeps mutable state in
its closure. Side effects (place a cohort, issue an order) are provided by the host via callbacks,
exactly as `issueOrder` is today.

```
src/battle/ai.ts            (exists) — controller registry; extend AiTickState
src/battle/ai/controller.ts — makeAiController(team, doctrine, difficulty) → AiTickFn
                              closure state: role-by-group, last-decision-tick-by-group, deployDone
src/battle/ai/commander.ts  — doctrine → assign a role to each group (pure)
src/battle/ai/utility.ts    — score a group's candidate actions, pick best affordable (pure)
src/battle/ai/deploy.ts     — deployment planner: force composition + placement template (pure)
src/data/ai.json + ai.ts    — per-doctrine weights, per-difficulty params (project JSON pattern)
```

Everything under `src/battle/ai/*` is React/PIXI-free → drivable by the headless harness.

## Interface extension (`AiTickState`)

The controller decides *what*; the host does the *how*. Today the AI can only issue/clear orders.
To let it **deploy by painting**, add three fields to the per-tick snapshot:

- `roster: Readonly<Record<UnitType, number>>` — undeployed units for the team.
- `deployZone: ReadonlySet<string>` — hex keys of the team's deploy zone. Computed by the host via
  `deployZoneFor` so `battle/` never imports `canvas/` (keeps the module graph one-directional).
- `placeCohort(groupId, anchorHex, unitType): boolean` — host mirrors `paintPlace` (append to
  `armies`, decrement roster, charge `placeCohort` CP); returns whether it succeeded.

This requires extracting the core of `paintPlace` into a reusable function called by both the
player input path and the AI host. `issueOrder` already creates a default order skeleton when the
group has none, so a freshly-painted group can be ordered the same tick.

## Commander (doctrine → roles)

Every `commanderCadence` ticks (slow, e.g. 20) the commander inspects global state and assigns each
of its ≤4 groups a **role**:

- `centerHold` — march to and hold the central flower.
- `defendLine` — hold formation in front of the deploy zone, counter what enters.
- `raid` — push toward the enemy back line to score (raid & return).
- `reserve` — wait at home, refill losses, plug gaps.

Doctrine sets the *desired role mix* (not which concrete group):

| Doctrine    | centerHold | defendLine | raid | reserve |
|-------------|-----------|-----------|------|---------|
| balanced    | 1         | 1         | 1    | 1       |
| aggressive  | 1         | 0         | 2    | 1       |
| defensive   | 1         | 2         | 0    | 1       |

Roles map to groups by fitness (cavalry → raid/charge, infantry → hold/line, skirmisher →
defendLine/kite). Reassign when groups are lost or the front shifts. Roles persist in closure state.

## Utility action selection (per group)

On a group's decision tick (gated by difficulty), generate candidate actions from its role — each
candidate is `{intent, change, cost}`:

```
hold-current (cost 0) | march→role-objective | charge→weak-nearby-enemy | unleash | retreat-home
```

Score each with a **doctrine-weighted utility** — a sum of normalized features:

- progress toward the role objective (centre / enemy line / own front)
- target enemy weakness (focus fire on low HP) and terrain height advantage
- risk (being flanked / outnumbered)
- CP headroom (penalize expensive actions when CP is tight)

Pick the affordable `argmax`; if `hold-current` wins, no CP is spent. Terrain/height features come
from `gridData` plus the same height model the sim uses.

## Difficulty modulators

Parameters that wrap the controller:

- **Reaction cadence** (`reactionTicks`): each group re-decides every N ticks. Easy = large N
  (slow, predictable); hard = N=1 (instant response).
- **Decision quality** (`decisionNoise`): random perturbation added to scores before the argmax.
  Easy = high noise → suboptimal picks, mistakes; hard = 0 → clean play. Uses an **injectable
  seeded RNG** so the harness stays deterministic.
- **CP / army size** (`cpBudgetFrac` + `forceScale`): easy spends only a fraction of available CP
  per window and deploys less force; hard squeezes CP and deploys the full roster.

```
easy:   reactionTicks 12, decisionNoise 0.5, cpBudgetFrac 0.5, forceScale 0.6
normal: reactionTicks 6,  decisionNoise 0.2, cpBudgetFrac 0.8, forceScale 0.85
hard:   reactionTicks 2,  decisionNoise 0.0, cpBudgetFrac 1.0, forceScale 1.0
```

## Deployment (`deploy.ts`)

At battle start, while the team still has roster units, CP, and unsealed groups, the planner places
cohorts **progressively** (each `placeCohort` costs CP) following a template: split the force into
groups by the doctrine's role mix and anchor them on free hexes along the front of the deploy zone.
Composition (count per unit type) is scaled by `forceScale`. Stops when the force target is met or
CP/roster runs out; sets the closure `deployDone` flag and moves to the command phase.

## Config, wiring, testing

- **`src/data/ai.json` + `ai.ts`**: `doctrines` table (role mix + utility weights) and `difficulties`
  table (the four params). The wrapper declares types and parses — same pattern as `units.ts` /
  `combat.ts`.
- **Wiring**: a `useEffect` in `GameCanvas` registers `makeAiController('blue', doctrine, difficulty)`
  when the HUD enables the AI enemy; unregisters on cleanup or when set to off (human-vs-human). The
  HUD gains a small selector: **doctrine + difficulty + off**. With the AI active on `blue`, the
  player is `red` and the HUD locks painting/ordering `blue`.
- **Testing**: `scripts/test-ai.ts` headless — register the controller with a fake host (mock
  `placeCohort` / `issueOrder` / CP) and run a full battle, asserting the AI deploys, contests the
  centre, and scores. Run all three difficulties and verify `hard` outperforms `easy`. Fits the
  existing harness (`sim-battle-loop.ts`).

## Out of scope

- Strategic-map / overworld AI — this is tactical-battle only.
- Learning/adaptation across battles — doctrine and difficulty are fixed per battle.
- Multi-front coordination beyond the ≤4 group role assignment.
