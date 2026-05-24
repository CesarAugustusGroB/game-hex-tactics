# Command Points — design

**Date:** 2026-05-24
**Branch:** `feature/ai-enemy`
**Status:** approved by user 2026-05-24, ready for implementation plan

## Goal

Every player and AI battlefield decision spends from a shared per-team **Command
Points** pool that regenerates over time during battle. Adds tempo, forces
prioritisation, prevents micro-spam, and gives the AI a natural rate limit
(no special-casing — same gate as the player).

## Conceptual choices (resolved during brainstorming)

| Question | Choice |
|---|---|
| Who pays CP? | Both teams, symmetric. Same rules, same gate. |
| What happens when broke? | **Hard block** — button disabled, keyboard shortcut becomes no-op + 200ms red flash on CP bar. |
| Pools | **One CP pool per team**, applied during both deploy and battle phases. Existing roster (unit stock per type) is a *separate* gate that still caps how many units may exist. |
| Regen model | **Constant** rate, no event bonuses. |
| Cap | **20 CP** (medium-low). Start = cap. |
| Regen rate | **+1 CP every 4 ticks** (≈ 0.5 CP/sec at 500 ms/tick). |
| Granularity | **Every interaction costs**, scaled by impact (soft tweaks 1 CP, big commits up to 6 CP). |
| Per-unit scaling | **No.** Costs are flat per action, independent of group size. |
| Symmetry of phase costs | Deploy and battle use the **same cost table**. Difference is only that deploy phase has **no regen** — you spend down from the starting 20. |

## Costs

| Action | Cost (CP) |
|---|---|
| ASSIGN (T) — paint units onto group | 0 |
| Meta — SCAN, START/PAUSE, RESET, REGENERATE, RETURN | 0 |
| Cycle heading (A while marching) | 1 |
| Cycle formation (D) | 1 |
| MARCH start (A from no-order) | 2 |
| IDLE (S) | 2 |
| Place cohort (Z / X / C — 4 units from roster) | 2 |
| Initial DEPLOY/ORDER (Q drag from deploy zone) | 3 |
| HOLD (W) | 4 |
| RETREAT (F) | 4 |
| CHARGE (E) | 6 |
| UNLEASH (R) | 6 |

**Cancelling** a mode (clicking the same mode button while it's active) is
**free** — you only pay on the rising edge into a mode, not on the way out.
A re-press of the same mode key always resolves to "cancel"; switching
between two different modes (e.g. HOLD → IDLE) bills the entry into the
new mode only.

**Q drag re-issued** (drag from deploy zone again to change heading before
the group leaves the zone) bills 3 CP per drag — each commit is a fresh
order configuration.

## Lifecycle

```
regenerateWorld / returnToStrategic / resetBattle
       ↓
{red: 20, blue: 20}   ← pool reset to cap
       ↓
[deploy phase]   isBattleRunning = false, NO regen
       ↓        spend CP on cohort placements, initial orders
       ↓
START BATTLE pressed
       ↓
[battle phase]   isBattleRunning = true, regen +1 every 4 ticks (clamped to cap)
       ↓        spend CP on order changes, mode toggles, reinforcements
       ↓
PAUSE → regen stops, pool persists, spend allowed (think-free, no accumulation)
RESUME → regen continues from current pool value
```

## Data model

In `src/canvas/constants.ts`:

```ts
export const CP_CAP = 20;
export const CP_REGEN_PER_N_TICKS = 4;
export const CP_INITIAL = CP_CAP;

export const CP_COSTS = {
  assign: 0,
  meta: 0,
  cycleHeading: 1,
  cycleFormation: 1,
  march: 2,
  idle: 2,
  placeCohort: 2,
  initialOrder: 3,
  hold: 4,
  retreat: 4,
  charge: 6,
  unleash: 6,
} as const;

export type CommandPoints = Record<Team, number>;
```

In `GameCanvas.tsx`:

```ts
const commandPointsRef = useRef<CommandPoints>({ red: CP_INITIAL, blue: CP_INITIAL });
const [commandPoints, setCommandPoints] = useState<CommandPoints>({ red: CP_INITIAL, blue: CP_INITIAL });
```

The state mirror exists so the HUD re-renders when CP changes; the ref is
read by the long-lived pointer / shortcut handlers and the AI tick (same
pattern already used for `isScanningRef`, `noiseOffsetRef`, etc.).

## Sim integration

**`simulate.ts` does not change.** CP is an authorisation layer above
`issueOrder`/`clearOrder`, not part of the pure simulation. The simulator
keeps receiving orders and ticking — it never asks whether they were
"affordable".

Two helpers wrap the existing extracted `issueOrder`/`clearOrder`:

```ts
// canAfford — read-only check for UI button enabled state.
const canAfford = (team: Team, cost: number) => commandPointsRef.current[team] >= cost;

// chargeCP — debits and returns true; or returns false untouched if broke.
const chargeCP = (team: Team, cost: number): boolean => {
  const have = commandPointsRef.current[team];
  if (have < cost) return false;
  commandPointsRef.current[team] = have - cost;
  setCommandPoints({ ...commandPointsRef.current });
  return true;
};
```

Every place that currently mutates orders (UI handlers, AI controller) is
routed through `chargeCP` first. If `chargeCP` returns false, the action is
a no-op and the HUD shows a 200ms red flash on the CP bar.

Battle tick (in `useBattleTick`):

```ts
// After every simulateTick, also accrue regen.
if (tickCounter % CP_REGEN_PER_N_TICKS === 0) {
  for (const team of ['red', 'blue'] as const) {
    if (commandPointsRef.current[team] < CP_CAP) {
      commandPointsRef.current[team]++;
    }
  }
  setCommandPoints({ ...commandPointsRef.current });
}
```

## AI integration

`AiTickState` in `src/battle/ai.ts` gains:

- `cp: number` — current CP for the controller's team (read-only).
- `issueOrder` signature changes from `(...) => void` to `(...) => boolean`
  (returns `false` if the order was rejected for lack of CP).

The AI controller is responsible for prioritising within its budget. There
is no special-case path — the same `chargeCP` wraps `issueOrder` whether
called from player input or AI tick. A naïve AI that always tries the most
expensive move will simply miss most ticks, which is the design.

## HUD

**CP bar — bottom centre**, both teams stacked, mirrors the capture-progress
strip pattern (which stays at top centre):

```
┌─ COMMAND POINTS ──────────────────┐
│ RED   ████████████░░░░░  14/20    │
│ BLUE  ████████░░░░░░░░░   9/20    │
└────────────────────────────────────┘
        (bottom-center, glass card)
```

- Two horizontal bars (red and blue), with numeric `X/20` to the right.
- Glassmorphism style consistent with the existing HUD panel (dark
  background, gold border, blur).
- Only visible when `viewMode === 'TACTICAL'` and `currentStrategicHex` is set
  (same gate as capture strip).
- On a failed action (broke), the appropriate team's bar flashes red for
  200 ms.

**Per-button cost chips** in the HUD panel:

- Each costed button gets a small yellow chip in its top-right corner
  showing the integer CP cost (e.g., `CHG ⁶`).
- When the selected team can't afford the action, the chip turns red and
  the button is dimmed/disabled (same `disabled` style already used by the
  HUD).
- ASSIGN and meta actions show no chip.
- Cancel actions (clicking the active mode again to deactivate) show no
  chip either, since they're free.

**Existing battle indicators stay where they are:**

- Capture progress strip stays at top centre.
- Win banner stays centred.
- Floating HUD panel (groups, deploy buttons, etc.) stays top-left.

## Edge cases

- **Pause:** regen stops; pool persists; spending still allowed. Pausing is
  free think time but does not accumulate budget.
- **Reset / regen / return:** pool reset to cap (20) for both teams.
- **Keyboard shortcut while broke:** no-op + 200 ms red flash on CP bar.
  Does not trigger any state change.
- **Cancelling a mode** (re-clicking the active mode button): free.
- **Roster empty during cohort deploy:** the button is already disabled by
  roster gate, so `chargeCP` is never called → no CP spent.
- **Charge timer expires** (`chargeTicksRemaining → 0`, sim flips charge
  back to march): no CP charged — only the initial mode change costs.
- **Unleash committed:** all per-group buttons become locked by existing
  rules. RETREAT remains available and costs 4 CP. The sim's auto-clear
  on returning to deploy zone is also free (sim-initiated).
- **AI broke:** `issueOrder` returns false; controller decides whether to
  wait, queue, or pick a cheaper alternative — entirely up to the AI
  implementation.

## Files touched

- `src/canvas/constants.ts` — add `CP_*` constants, `CommandPoints` type.
- `src/components/GameCanvas.tsx` — add `commandPointsRef` + state, add
  `canAfford` / `chargeCP` helpers, reset on regen/return/reset.
- `src/canvas/useBattleTick.ts` — add regen step in the tick hook.
- `src/canvas/HUD.tsx` — add bottom-centre CP bar; add cost chips on each
  costed button; route every button's `onClick` through `chargeCP`; gate
  `disabled` on `canAfford` + existing conditions; add red flash on broke.
- `src/canvas/input/useTacticalKeyboard.ts` — same chargeCP gate for
  shortcut paths.
- `src/canvas/input/useGlobalShortcuts.ts` — same for global ones (Z/X/C).
- `src/canvas/input/orderDrag.ts` — chargeCP on commit of the initial
  DEPLOY/ORDER drag (Q).
- `src/battle/ai.ts` — extend `AiTickState` with `cp`; change
  `issueOrder` return type to `boolean`. No controller exists yet (this
  branch will add one separately), so no consumer to migrate.

## Out of scope

- Event-driven CP bonuses (kill +X, hold zone +X). Deliberately deferred
  until the flat regen has been playtested.
- Asymmetric pools / difficulty knobs. Same.
- CP-cost tooltip with breakdown. The chip is enough for v1.
- Persisting CP across battles in a campaign sense — each tactical reset
  restores to cap by design.
