# Battle MVP — Design

Date: 2026-05-10
Branch: `feature/units`
Status: Approved

## Goal

Add real-time combat to the existing units feature. Player paints red/blue knights, assigns them to up to 3 manual groups per team, then issues attack-move orders. While the battle is running, units fight any adjacent enemy and walk toward their group's target. HP-based damage; one unit per hex.

## Non-Goals (YAGNI)

Tracked separately in memory `project_battle_followups.md`. Briefly:
- A* / smarter pathfinding.
- Ranged units / asymmetric stats / projectiles.
- Terrain that blocks movement.
- Morale, retreat, formations.
- Territory capture or control points.
- Persistence across reloads.
- Sound / particle FX (beyond an optional minimal damage flash).
- Strategic-view army icons reflecting per-team counts.

## Data Model

```ts
type Team = 'red' | 'blue';                  // existing
type GroupId = 1 | 2 | 3;
type UnitState = 'idle' | 'moving' | 'fighting';

interface Unit {
  id: string;
  team: Team;
  tacticalHex: Hex;        // current position (mutable during battle)
  homeHex: Hex;            // where placed; default rally point
  groupId: GroupId | null; // null = ungrouped (defends in place, no attack-move)
  hp: number;              // 0..MAX_HP
  state: UnitState;
}

interface GroupOrder {
  team: Team;
  groupId: GroupId;
  attackTarget: Hex | null; // null = no order, defend home
}
type GroupOrders = Map<string, GroupOrder>; // key: `${team}:${groupId}`

type InputMode = 'place' | 'assign' | 'order' | null; // mutually exclusive with isScanning
```

New React state in `GameCanvas`:
- `groupOrders: GroupOrders` (replaces nothing — additive).
- `selectedGroup: GroupId` — which group receives assign / order.
- `inputMode: InputMode` — replaces the existing `isPlacing` boolean (or coexists; see Implementation Notes).
- `isBattleRunning: boolean` — gates the simulation ticker.

Mirror refs (mount-time PIXI handlers): `selectedGroupRef`, `inputModeRef`, `isBattleRunningRef`.

The existing `armies: Map<strategicHexKey, Unit[]>` continues to be the canonical store. Units acquire a `homeHex` (= `tacticalHex` at placement time) and start with `hp = MAX_HP`, `state = 'idle'`, `groupId = null`.

## Constants

```ts
const MAX_HP = 100;
const DAMAGE_PER_TICK = 10;
const TICK_MS = 500;          // battle tick rate
const MOVE_HEXES_PER_TICK = 1;
```

## Simulation Loop

A battle ticker (a single `setInterval(tick, TICK_MS)` registered when `isBattleRunning` flips to true; cleared on flip to false). Each tick mutates the active strategic hex's units in `armies`:

```
For each unit u in current strategic hex's armies, in deterministic order:
  1. ENGAGE: collect adjacent enemies (different team, in any of u's 6 neighbor hexes).
     If any:
       - target = enemy with min hp (tie-break by id ascending).
       - target.hp -= DAMAGE_PER_TICK.
       - u.state = 'fighting'.
       - Skip movement this tick.
       - (Other adjacent enemies attack u independently this tick — surrounded units take multiple damage.)

  2. MOVE: if u.state !== 'fighting':
       desired = groupOrders[u.team:u.groupId].attackTarget ?? u.homeHex.
       If u.tacticalHex equals desired:
         u.state = 'idle'; skip.
       Else:
         next = greedyStep(u.tacticalHex, desired) — see below.
         If next is occupied (any team) → wait this tick (no move), keep current state.
         Else → u.tacticalHex = next; u.state = 'moving'.

  3. RESOLVE DEATHS: after all units have acted, remove units with hp ≤ 0 from armies.
     Simultaneous death is allowed (both reach 0 same tick).
```

`greedyStep(from, to)`: of `HexUtils.getNeighbors(from)`, return the one with min `HexUtils.distance(neighbor, to)`. Tie-break by `(q, r)` ascending. No backtracking memory; no obstacle awareness beyond the wait-on-blocked check above.

Units belonging to a *different* strategic hex (i.e., not the one we're viewing) are not simulated this tick — battles are per-strategic-hex sandbox.

## Combat & Edge Cases

- **Range**: melee only (the 6-neighbor adjacency).
- **Damage**: simultaneous within a tick; both sides apply damage before deaths resolve.
- **One unit per hex** (hard rule):
  - Place: brush mode skips an already-occupied hex.
  - Move: skip movement if target step is occupied.
  - Attack-move target hex occupied by enemy: stop in the nearest adjacent free hex and engage.
  - Attack-move target hex occupied by ally: stop adjacent, state='idle'.
- **No range bonuses, no ranged attacks, no AoE.**
- **Terrain**: ignored — knights walk on water, glacier, etc. (deferred).
- **Death**: removed from `armies` at tick end. Render automatically reflects via existing `drawUnits` dependency on `armies`.
- **Win banner**: when at the end of a tick, all surviving units in the active strategic hex have the same `team` and the OTHER team had ≥1 unit at tick start, show a banner overlay "RED VICTORY" / "BLUE VICTORY" for 3000ms and auto-set `isBattleRunning = false`. The game keeps state — user can resume placing or click START again.
- **Regenerate / return-to-strategic**: stops the battle (`isBattleRunning = false`), clears `groupOrders`, clears `inputMode`. Surviving units persist to whatever the new state is (regenerate also clears all units, as today).

## Input Modes

Three input modes, mutually exclusive (and exclusive with `isScanning`):
- **`place`**: existing brush placement. Paints new units. Skip occupied hexes. Each placement also sets `homeHex = tacticalHex` and assigns `groupId = null`.
- **`assign`**: brush mode that ASSIGNS units of `selectedTeam` to `selectedGroup`. Drag over your own units → their `groupId` becomes `selectedGroup`. Doesn't create new units; doesn't affect other-team units.
- **`order`**: a single-click mode. Next click on a hex sets `groupOrders[selectedTeam:selectedGroup].attackTarget = clickedHex`. Mode auto-exits after the click (returns to `null`).

A right-click anywhere cancels `inputMode` (sets to `null`).

Cursor: `crosshair` whenever any input mode is active OR `isScanning`.

## HUD Additions

A new **GROUPS** panel below the existing controls, visible only in TACTICAL view:

```
┌─ GROUPS ────────────────────────┐
│ Active team: [RED] [BLUE]       │   (re-uses existing selectedTeam toggle)
│                                 │
│ Group 1   [N] (assign) (attack) │   N = unit count for selectedTeam:1
│ Group 2   [N] (assign) (attack) │
│ Group 3   [N] (assign) (attack) │
│                                 │
│ [▶ START BATTLE] / [⏸ PAUSE]    │
└─────────────────────────────────┘
```

- Each group row shows the count of units (current team) belonging to it.
- `assign` button: toggles `inputMode='assign'`, sets `selectedGroup` to that row.
- `attack` button: toggles `inputMode='order'`, sets `selectedGroup` to that row. Disabled if `[N] === 0` for the active team.
- The active button is highlighted with the team color.
- Toggling any group/place button turns the others off.
- `▶ START BATTLE` flips `isBattleRunning` and the label changes to `⏸ PAUSE BATTLE`. Disabled while no units placed in the current strategic hex.

## Visualization

- **HP bar**: a small horizontal rect drawn above each unit sprite (top center). Width proportional to `hp / MAX_HP`. Color green at full, red at zero (linear interpolation). Drawn only when `hp < MAX_HP`. Implemented as PIXI Graphics added to `unitsGfx` per unit per `drawUnits` rebuild.
- **Group badge**: a tiny number (1/2/3) drawn over each unit's sprite when `groupId !== null`. White text on a small dark circle.
- **Attack target indicator**: for each `groupOrders[team:groupId].attackTarget`, draw a dashed circle on that hex in the team's color. Drawn from `unitsGfx`.
- **Damage flash** (optional, low cost): when a unit takes damage in a tick, briefly tint it white for 1 frame. Skip if it adds complexity.

`drawUnits` is called on every relevant state change (which now includes `groupOrders` and `armies` mutations during battle). Battle tick mutates `armies` via `setArmies`, so React re-renders trigger redraw automatically.

## Files Touched

- `src/components/GameCanvas.tsx` — primary site of change. State, ticker, render extras, HUD panel, input mode handling.
- Optional extract: `src/battle/simulate.ts` exporting `simulateTick(units, orders): { units, deaths }` as a pure function. Encouraged if `GameCanvas.tsx` exceeds ~700 lines after this change. Implementer's call.
- No asset additions.

## Verification

No test runner. Manual + build + lint:

1. `npm run build` clean.
2. `npm run lint` clean (or unchanged warnings only).
3. Manual flow:
   - Place 5 red and 5 blue knights on opposite sides of a tactical hex.
   - Assign all reds to Group 1; assign 2 blues to Group 1, 3 blues to Group 2.
   - Click `attack` for red Group 1 → click a hex among the blues → red target circle appears.
   - Click `▶ START BATTLE` → reds advance, fight blues; HP bars decrement; corpses disappear; eventually a side wipes the other.
   - Win banner appears, battle pauses.
   - Click `▶ START BATTLE` again → continues with surviving units.
   - `RETURN TO STRATEGIC OVERVIEW` → battle stops, group orders cleared.
   - `REGENERATE ECOSYSTEM` → all units gone, battle stopped.

## Implementation Notes

- The existing `isPlacing` flag is replaced by `inputMode === 'place'`. Boolean → enum migration touches the `PLACE UNIT` button, the `pointerdown`/`globalpointermove`/`pointerup` brush handlers, and the cursor logic. Keep symmetry with `isScanning` (still a separate boolean — it's its own thing).
- `paintAt` (the existing brush helper) splits into `paintPlace(hex)` and `paintAssign(hex)` switching on `inputModeRef.current`.
- The battle ticker is `setInterval`, NOT a PIXI ticker function — we want fixed 500ms steps regardless of frame rate, and we don't want the simulation tied to render-loop pacing.
- To keep React re-renders cheap during ticking, mutate `armies` once per tick via a single `setArmies(next)` call (compute the new map, then setState). Don't dispatch per-unit setStates.
- Win-detection runs at tick end after death resolution. Stash `lastTickHadBothTeams: boolean` on a ref so we don't show the banner if the user pressed Start with only one team present.
