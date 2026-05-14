# Architectural review: hex-tactics from a strategy-game-design lens

## Context

Strategic-game architect's diagnostic review focused on opportunities for improvement, especially around scaling (many units) and depth. Below is a snapshot of what's there, where the foundation is strong, where it gets squeezed at scale, and prioritized opportunities.

## Snapshot of the current architecture

- **Three files hold ~99% of the logic**:
  - `src/components/GameCanvas.tsx` (1737 lines) — world gen, terrain rendering, units rendering, input, HUD, tick driver.
  - `src/battle/simulate.ts` (1122 lines) — pure sim, motion modes, defendHeight formation engine, combat phase.
  - `scripts/sim-formations.ts` (636 lines) — manual scenario harness.
- **Sim loop**: `setInterval` at `TICK_MS=500` calls a pure `simulateTick(units, orders, config)`. Pure-in / pure-out, deterministic.
- **Render**: single PIXI Application, one `Container` per logical layer (terrain, highlights, preview, units). Drawn via React's mount-only effect plus React-driven `useCallback` redraws.
- **Combat model**: every unit with ≥1 adjacent enemy deals a constant `damagePerTick` to that enemy's weakest neighbor each tick. No armor / range / abilities / morale. All units identical stats-wise; only sprite differs by team.
- **Motion modes (5)**: `march`, `charge`, `retreat`, `unleash`, `defendHeight`. Recent work has been deep on `defendHeight`: segment/rank BFS, perimeter walks, sticky assignments, lateral fallback. UNLEASH also got target-spreading + lateral fallback.
- **Strategic ↔ Tactical "dive"**: same procedural noise field used for both views by re-rolling `noiseOffset` + `resolution`. Clever and cheap.
- **State**: React state + mirrored refs for the long-lived PIXI handlers. Orders are a `Map<string, GroupOrder>`; armies a `Map<string, Unit[]>` keyed by strategic hex.

## Strengths to preserve

1. **Pure `simulateTick`**. The sim is testable, deterministic, replayable. This is the load-bearing decision that makes everything else possible — sim-formations.ts works because of it, regression checks are easy, future replay/network sync would be cheap.
2. **One-canvas PIXI architecture**. No per-unit React component, no synchronization drift. Easily handles 145 units at 500ms ticks.
3. **Strategic-tactical dive via noise reseeding** — elegant, no level data to ship, infinite worlds.
4. **Hex math centralized** in `HexUtils.ts` (111 lines, clean). Used consistently.
5. **Player-driven AI substitute**: pressing `<` swaps which team you're controlling so both sides can be played from one seat. Pragmatic shortcut that defers writing real AI.
6. **The defend system is genuinely sophisticated** — perimeter walk + rank BFS + sticky assignment + lateral fallback is a small algorithm fortress. It's one of the strongest parts of the codebase.

## Findings (high → low priority by gameplay impact)

### F1. Combat depth is the smallest in the project. Everything else is built around it but it's a 5-line loop.

The combat phase (`simulate.ts:804-823`) is: pick weakest adjacent enemy → deal constant damage. No:
- **Unit types** with different stats (HP, damage, range, speed, defense). The Roman/Hoplite split is purely cosmetic — same numbers under the hood.
- **Ranged attacks**. Charge is melee-only and there's no ranged weapon mechanic — yet the front-line/back-line formation work is built FOR ranged combat patterns.
- **Flanking / facing bonuses**. The lieutenant has a captured `heading` but it's not used in combat math. The shield is iconic in the sprite but doesn't translate to a defensive arc.
- **Morale / rout**. Units fight to the death. No retreat under pressure, no chain reactions, no "defending the high ground holds the rabble".
- **Terrain combat modifiers**. Defending HILL vs. attacking from PLAIN should give a defensive bonus — that's the entire premise of "defend HEIGHT". Currently terrain affects movement only.

**Impact**: every tactical decision (rank position, terrain choice, formation shape) is currently visual — the system rewards none of it numerically. Players will eventually notice "it doesn't matter where I stand". This is the biggest design gap.

### F2. No AI for the opposing team — the game can't be played solo against a challenge.

The only way the blue team moves is if the human player swaps teams via `<` and issues orders manually. There's no enemy AI loop, no behavior tree, no scripted scenarios. A solo player can only test their own algorithm against a stationary enemy.

**Impact**: there is no game loop yet, just a sandbox. Adding even a primitive AI (e.g., "every blue group moves toward the nearest red group") would unlock playability.

### F3. `GameCanvas.tsx` at 1737 lines is the biggest scaling risk for the codebase itself.

It contains: world gen, PIXI bootstrap, terrain draw, highlights, units draw, input (pointer + keyboard), 5 input modes, HUD JSX, tick driver, refs / state sync. The file has crossed a threshold where:
- Greppable concepts are still fine, but **causal reasoning across the file is hard**. Adding a new mode requires touching ~6 distinct sections.
- The mount-only `useEffect` is a 600-line god-block.
- All five PIXI event handlers (`pointerdown`, `globalpointermove`, `pointerup`, `pointertap`, `dblclick`) branch on `inputModeRef.current`. Each new mode adds another branch in each handler.
- The HUD JSX is interleaved with sim-side logic. Refactoring one risks the other.

This is a "growth in place" problem. The codebase has been doubling functionally every week or two — eventually a single file approach hits a wall.

**Impact**: not user-visible, but every feature now costs more than the last.

### F4. No real test coverage outside of `sim-formations.ts`.

The harness is good — it's a series of scenarios that print final positions for manual inspection. But:
- No automated assertions. The harness prints; humans verify. If you accidentally break `march-east-clear` while adding a feature, nothing red-flags it — the user notices weeks later.
- No tests on the canvas (input, mode toggles, render pipeline).
- No tests on world generation invariants (continents are connected, rivers terminate at sea, etc.).
- No CI hook running `npm run sim` or similar.

**Impact**: regressions ship. We've already seen ~3 cases in recent history where a "fix" broke an adjacent scenario; only the user catching it live prevented bigger damage.

### F5. Performance scales poorly past ~200 units due to repeated O(N²) work in render.

Per-tick render scan does `units.find(d => d.hex.q === ... && d.hex.r === ...)` lookups inside loops. Examples:
- `drawUnits` calls `gridData.find(d => d.hex.q === u.tacticalHex.q && d.hex.r === u.tacticalHex.r)` for every unit → O(N × gridSize) per render. For a 35-radius map (~4000 hexes) and 145 units that's 580k comparisons per frame.
- Similar pattern in `renderOrderPreview` and `renderDefendPreview` ("find tile by q,r" inside per-slot loop).
- `gridDataRef.current` is a flat array, not a `Map<key, …>`. Cheap to fix.

There's also a couple of redraws-from-scratch in places where partial updates would be possible (terrain redraws on every gridData change, unit-graphics container clears every tick).

**Impact**: invisible at 145 units, but the project has been bumping unit count fast. 500-1000 units would expose this.

### F6. Visual feedback for orders is sparse — at 145 units the player can't see who's going where.

Today, the player:
- Issues an ATTACK-drag and sees a one-tick preview of slots.
- After commit, that preview goes away. There's no persistent indicator showing "this group is marching east" or "the rank-2 unit there belongs to G3".
- The lieutenant gets a ★ + direction arrow but only at the lieutenant slot. The other 144 units in G1 have no on-screen affiliation cue besides the team-color hex outline.

**Impact**: at scale the battlefield reads as a sea of identical pieces. Players can't quickly understand intent, even their own. UI ergonomics, not architecture, but a high-leverage place to invest.

### F7. Order types are tightly coupled to the sim's pure shape, which hurts serialization / save.

- `GroupOrder` includes `defendAssignments?: Record<string, Hex>` and other sticky state. As more modes accrue, the order interface grows.
- Orders are stored in a `Map`, which doesn't JSON-serialize directly (so save/load would need a `mapToObject` / `objectToMap` helper).
- There's no separation between "order metadata the player issued" and "transient sim state computed from it" (e.g., `chargeTicksRemaining`, `chargeDamagedIds`, `defendAssignments` are all mixed in the same struct).

**Impact**: future replay/save/multiplayer features will pay this debt. Not urgent.

### F8. Movement system stalls in adversarial geometry — the sim test admits this.

Lateral fallback unblocked many cases; sticky assignment removed the oscillation. But edge cases remain:
- Two units perfectly blocking each other's targets ("swap deadlock") — not handled. Documented as out-of-scope.
- Units assigned to a rank-N slot they geometrically can't reach (full perimeter blocks center).
- No A* pathfinding for "obvious detour available" cases.

**Impact**: occasional confusing visual ("why is that unit just sitting there?"). Low-frequency at moderate density; degrades at very high density.

### F9. No save / load, no replay, no multiplayer.

The pure sim could trivially do all three (deterministic). Currently none exist. At least save/load would substantially raise perceived completeness with very little work.

### F10. Strategic layer is decorative.

The strategic view is procedural terrain at low resolution that you "dive into". Once inside tactical, you fight. No campaign progression, no overworld movement of armies, no resource economy, no objectives. The strategic ↔ tactical dive is a *capability* (the tech is in place) more than a *gameplay loop*.

**Impact**: depends on design goals — if the goal is "be a tactical sandbox like Total War battles," this is fine. If it's "build a 4X-style strategy game," there's no strategy layer yet.

## Recommendations (priority-ordered, with quick-win first)

### P0 — Quick win this week
1. **Index `gridData` as a `Map<key, TerrainTile>` at write time** (or a per-tick Map at the top of each draw fn). Replaces all `gridData.find(...)` calls. ~30-line change, kills the O(N×gridSize) render lookups for free. Addresses F5.
2. **Add automated assertions to `sim-formations.ts`**. Each scenario already prints expected outcomes in comments — convert those to `assert.deepEqual(finalPositions, expected)` checks and fail the run on regression. Hook into `npm run sim` and run on each meaningful change. Addresses F4.

### P1 — Foundational, two-week
3. **Split GameCanvas.tsx**. Suggested partition:
   - `src/canvas/PixiApp.tsx` — mount-only PIXI bootstrap, terrain/units/highlights/preview Graphics refs.
   - `src/canvas/input/{useOrderDrag, useDefendGesture, useKeyboard}.ts` — one hook per input mode.
   - `src/canvas/render/{drawTerrain, drawUnits, renderOrderPreview, renderDefendPreview}.ts` — pure render fns taking refs + state.
   - `src/canvas/HUD.tsx` — the React panel only.
   - GameCanvas stays as a thin composition root.
   Addresses F3.
4. **Introduce a unit-type table.** `src/battle/unitTypes.ts` with `{id, maxHp, damage, range, speed, defenseTerrainMods}`. Roman = legionary stats, Hoplite = hoplite stats. Combat phase reads from there. Once this lands, sprite-by-team becomes "sprite-by-unit-type" naturally. Unlocks F1, F10.

### P2 — Game-shaping, month
5. **Terrain combat modifiers**: a unit on HILL/ROCKY defending against an attacker on PLAIN gets a damage-reduction bonus. Same for the river crossing (attacker crossing river takes attack penalty). This is what `defendHeight` is silently promising. ~50-line combat-phase change. Addresses F1.
6. **Primitive enemy AI**: a single `runAITick(state)` that, for each enemy group without an order, issues an `attackTarget` toward the nearest player group. Add `isAIControlled: boolean` on team. Makes the game playable solo. Addresses F2.
7. **Order visualization layer**: persistent rendering of each group's destination (lieutenant's slot) as a faint team-colored arrow from the group's centroid. Optional: thin line for the formation outline at the target. Addresses F6.

### P3 — Long-term, when relevant
8. **Save / load via the pure sim**. `serializeState({units, orders, gridData, viewMode, ...})` → JSON; reverse. Pair with replay (save tick deltas). F7 + F9.
9. **A* pathing for blocked-unit fallback**. Per-unit, only when greedy + lateral both fail. Cheap when applied selectively. F8.
10. **Strategic layer with army movement on the overworld** — what unlocks the "dive" mechanic from a sandbox curiosity into a campaign loop. F10.

## Critical files to reference during implementation

- `src/battle/simulate.ts` — combat phase at 804-823 (F1), `computeDefendFormation` at ~550 (reusable), `simulateTick` at 763 (entry point for AI hook).
- `src/components/GameCanvas.tsx` — file size (F3); render lookups at 327, 555-560, 657-660 (F5); HUD section starts ~1370 (F3 split candidate).
- `scripts/sim-formations.ts` — `runScenario` returns `ScenarioResult` but the result is never asserted on (F4).
- `src/hex-engine/HexUtils.ts` — small, stable, reusable. No changes needed.

## What this review is NOT

- Not a multiplayer / netcode review (no networking yet).
- Not a graphics / shader review (PIXI default rendering is fine for the scale).
- Not a build / bundle audit (Vite is well-configured; the 500 KB warning is benign).
- Not a TypeScript strictness audit (strict mode is on, types are good).

## Suggested next conversation

When ready to act on this review, the natural pick is **P0 + P1 in sequence**: ship the `gridData` indexing + automated test assertions this week, then start the file split + unit-type table next week. That's two weeks of low-risk groundwork that makes every subsequent gameplay feature (terrain combat mods, AI, ranged attacks) cheaper.
