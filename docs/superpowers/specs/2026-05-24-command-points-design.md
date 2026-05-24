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
| IDLE (S) | 0 |
| Meta — SCAN, START/PAUSE, RESET, REGENERATE, RETURN | 0 |
| Backspace (clear group / delete units) | 0 (debug-only shortcut) |
| Cycle heading (A while marching) | 1 |
| Cycle formation (D) | 1 |
| MARCH start (A from no-order or non-march) | 2 |
| Place cohort — **per painted hex** (Z / X / C, up to 4 units per hex) | 2 |
| Order-drag commit (Q drop, from deploy zone) | 3 |
| HOLD (W) | 4 |
| RETREAT (F) | 4 |
| CHARGE (E) | 6 |
| UNLEASH (R) | 6 |

**IDLE is the free rest state.** Pressing S directly, or re-pressing an
active mode key to cancel it, both resolve to idle and cost 0 CP. This
guarantees there is no exploit where re-press-to-cancel is cheaper than
press-S; both are free, no ambiguity.

**Place-cohort cost is per `paintPlace` invocation**, not per discrete
button click. The Z/X/C buttons just open `inputMode = 'place'` for free;
the actual placement and CP debit happen each time the pointer enters a
new hex inside the team's deploy zone (one paintPlace = one cohort drop
of up to 4 units = 2 CP). A drag over 5 hexes costs 10 CP.

**Order-drag (Q) is restricted to the deploy zone.** The current code
allows `commitOrderDrag` to land anywhere on the map, which would let a
single 3 CP drag teleport a group across the field. The spec adds an
explicit `deployZoneFor(team).has(drag.targetHex)` check at the top of
`commitOrderDrag`; misses cancel the drag with no CP charged. Each
in-zone commit pays 3 CP (re-drags before the group marches out are
each a fresh 3 CP).

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
  idle: 0,        // rest state — also reached via cancel-mode (re-press active)
  meta: 0,
  debug: 0,       // Backspace clear-group
  cycleHeading: 1,
  cycleFormation: 1,
  march: 2,
  placeCohort: 2, // per paintPlace invocation (one hex), regardless of unit count
  orderDrag: 3,   // per commitOrderDrag from deploy zone
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

Two standalone helpers (not wrappers — call sites invoke them explicitly):

```ts
// canAfford — read-only check, used by UI to compute `disabled` on buttons.
const canAfford = (team: Team, cost: number) =>
  commandPointsRef.current[team] >= cost;

// chargeCP — debits and returns true; returns false untouched if broke.
const chargeCP = (team: Team, cost: number): boolean => {
  const have = commandPointsRef.current[team];
  if (have < cost) return false;
  commandPointsRef.current[team] = have - cost;
  setCommandPoints({ ...commandPointsRef.current });
  return true;
};
```

Every gameplay action that currently mutates state checks `chargeCP`
BEFORE issuing the order (or placing units / committing a drag). The
canonical pattern at each call site:

```ts
// In toggleMode, marchForward, paintPlace, commitOrderDrag, etc.
if (!chargeCP(team, cost)) { triggerBrokeFlash(team); return; }
// ... proceed with issueOrder / setArmies / etc.
```

This keeps the debit and the rejection-feedback tightly local. Critically,
**no CP is ever charged for an action that no-ops for another reason** —
engagement-blocked RETREAT, place-into-occupied-hex, Q drag landing
outside the deploy zone, etc. all reject before `chargeCP` is called.

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

- `cp: number` — current CP for the controller's team (read-only snapshot
  captured before the controller runs).
- `issueOrder` signature changes from
  `(gid, change) => void`
  to
  `(gid, change, intent: keyof typeof CP_COSTS) => boolean`.
  The wrapper installed in `useBattleTick` looks up `CP_COSTS[intent]`,
  calls `chargeCP(team, cost)`, and only invokes the underlying
  `issueOrder` (and returns `true`) on success. Returns `false` untouched
  if the team can't afford it.
- `clearOrder` stays `(gid) => void` and free (matches the player's
  Backspace shortcut).

The player UI and the AI go through the **same** `chargeCP` and the
**same** `CP_COSTS` table — there is no AI-only fast path or discount.
A naïve AI that always asks for `unleash` will simply miss most ticks
and miss most opportunities; the "intelligence" is in spending the
budget well.

Example AI call:
```ts
state.issueOrder(2, { mode: 'charge', attackTarget, heading }, 'charge');
// → true if state.cp >= CP_COSTS.charge (6), false otherwise.
```

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

- **Pause:** regen stops (the `useBattleTick` interval is torn down when
  `isBattleRunning` flips false); pool persists; spending still allowed.
  Pausing is free think time but does not accumulate budget.
- **Reset / regen / return:** pool reset to cap (20) for both teams.
- **Keyboard shortcut while broke:** no-op + 200 ms red flash on CP bar.
  Does not trigger any state change.
- **Cancelling a mode** (re-clicking the active mode button): free —
  resolves to idle, which is itself 0 CP.
- **Roster empty during cohort deploy:** the Z/X/C button is already
  disabled by roster gate, so `inputMode = 'place'` is never entered →
  `paintPlace` is never invoked → no CP spent.
- **Place mode entered, then drag with insufficient CP:** each `paintPlace`
  invocation is gated. The first hex that can't be paid for is a no-op
  (no placement, no debit, red flash on CP bar). The player remains in
  `place` mode and can recover CP and continue painting later.
- **Q drag started but released outside the deploy zone:** drag is
  cancelled by `commitOrderDrag`'s new zone check; no CP charged, units
  not moved, order unchanged.
- **Charge timer expires** (`chargeTicksRemaining → 0`, sim flips charge
  back to march): no CP charged — only the initial mode change costs.
- **Unleash committed:** all per-group buttons become locked by existing
  rules. RETREAT remains available and costs 4 CP. The sim's auto-clear
  on returning to deploy zone is also free (sim-initiated).
- **RETREAT no-op when engaged:** existing rule — if any unit in the
  group has an enemy adjacent, the retreat is rejected. No CP charged
  (check engagement *before* `chargeCP`).
- **AI broke:** `issueOrder` returns false; controller decides whether to
  wait, queue, or pick a cheaper alternative — entirely up to the AI
  implementation.

## Files touched

- `src/canvas/constants.ts` — add `CP_*` constants, `CommandPoints` type.
- `src/components/GameCanvas.tsx` — add `commandPointsRef` + state mirror,
  define `canAfford` / `chargeCP` helpers, thread them into every hook ctx
  that mutates orders or units, reset pool on regen/return/reset (alongside
  the existing wipes of armies/rosters/orders).
- `src/canvas/useBattleTick.ts` — add CP regen step inside the interval
  callback: `if (tickCounterRef.current % CP_REGEN_PER_N_TICKS === 0)`
  bump both teams by 1 (clamped to cap). Naturally pauses with the
  interval when `isBattleRunning === false`.
- `src/canvas/HUD.tsx` — add bottom-centre CP bar (both teams stacked,
  glass card, gated on tactical + `currentStrategicHex`); add per-button
  cost chips (skip for ASSIGN / IDLE / meta); compute each button's
  `disabled` as `existingCondition || !canAfford(team, cost)`; trigger a
  200 ms red flash on the local team's bar when a click is rejected.
- `src/canvas/input/useTacticalKeyboard.ts` — no direct CP changes; the
  gate already lives inside the handlers (`toggleMode`, `marchForward`,
  `cycleFormation`) that the keyboard calls. Just confirm the handler
  signatures still match.
- `src/canvas/input/useGlobalShortcuts.ts` — Z/X/C enter `inputMode =
  'place'` for free; the actual debit happens inside `paintPlace`.
  Backspace stays free (debug).
- `src/canvas/input/paintMode.ts` — `paintPlace` calls `chargeCP(team,
  CP_COSTS.placeCohort)` AFTER validating the candidates list is
  non-empty (i.e. at least one unit will actually be placed); on broke,
  returns early without modifying armies or roster. `paintAssign`
  unchanged (cost is 0).
- `src/canvas/input/orderDrag.ts` — at the top of `commitOrderDrag`,
  reject if `!deployZoneFor(drag.team, ctx.gridDataRef.current)
  .has(HexUtils.key(drag.targetHex))` (cancel drag, no CP, no state
  change). On a valid in-zone commit, `chargeCP(drag.team,
  CP_COSTS.orderDrag)` before issuing the order; if broke, also cancel
  with no state change.
- `src/battle/ai.ts` — extend `AiTickState` with `cp: number`; change
  `issueOrder` signature to `(gid, change, intent: keyof typeof CP_COSTS)
  => boolean`. The wrapper that bridges it to the real `issueOrder`
  (installed in `useBattleTick`) does the `chargeCP(team,
  CP_COSTS[intent])` lookup. `clearOrder` stays `(gid) => void` and free.
  No controller exists yet on this branch, so no consumer to migrate.

## Out of scope

- Event-driven CP bonuses (kill +X, hold zone +X). Deliberately deferred
  until the flat regen has been playtested.
- Asymmetric pools / difficulty knobs. Same.
- CP-cost tooltip with breakdown. The chip is enough for v1.
- Persisting CP across battles in a campaign sense — each tactical reset
  restores to cap by design.
