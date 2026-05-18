# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (default http://localhost:5173). The parent worktree may already be using this port; pass `-- --port 5174` if needed.
- `npm run build` — `tsc -b` (project references) then `vite build`. Type errors fail the build.
- `npm run lint` — ESLint over the repo (config: `eslint.config.js`, flat config).
- `npm run preview` — serve the production build.
- `npx tsx scripts/sim-formations.ts` — headless battle harness: runs ~21 scenarios against the pure sim and prints per-scenario results. Run after any change to `src/battle/*.ts` to catch behavior drift.

There is no test runner configured.

## Architecture

Single-canvas PIXI.js application with a thin React HUD. Logic lives in:

- `src/main.tsx` — React root.
- `src/App.tsx` — renders only `<GameCanvas />`.
- `src/components/GameCanvas.tsx` — the entire app: world generation, rendering, input, HUD.
- `src/hex-engine/HexUtils.ts` — pure axial-coordinate hex math (pointy-top, `size = 40`).
- `src/battle/simulate.ts` — pure battle simulator (no React/PIXI). Exports `simulateTick`, unit/order types, and per-type tunables (`MARCH_HEXES_PER_TICK`, `MAX_HP_BY_TYPE`, etc.).
- `src/battle/terrain.ts` — pure terrain modifier table (defense/moveCost/attrition/vision) and downhill damage bonus. Sole owner of mechanical terrain values.
- `scripts/sim-formations.ts` — Node harness that drives `simulateTick` against scripted scenarios. Mirrors map state via a fake `MapApi`. Treat as a regression check.

### Two coordinate systems

1. **Axial hex coordinates** (`q`, `r`) — the logical grid. Convert with `HexUtils.hexToPixel` / `pixelToHex`. `HexUtils.key({q,r})` is the canonical `Map` key — always use it instead of stringifying ad-hoc.
2. **PIXI world coordinates** — the `worldRef` container is panned/zoomed; its children (`terrainGfx`, `highlightGfx`) are drawn in world space. Convert screen → world with `world.toLocal(...)` before doing hex lookups.

### Rendering pipeline (`GameCanvas.tsx`)

`gridData` (state) → `drawMap()` rebuilds `terrainGfx` from scratch on every change. Each hex is a faux-3D prism: two side quads (shaded 0.6× / 0.4×) plus a top hexagon. Heights come from `TERRAINS[type].height`. `highlightGfx` is redrawn every tick from the ticker, not from React state, so hover updates don't re-run `drawMap`.

A single `PIXI.Application` is created once in a mount-only `useEffect` (`[]`). The world container is panned via `pointerdown` + `globalpointermove` and zoomed by a wheel listener on the DOM container that anchors zoom to the cursor.

### World generation (`generateWorldData`)

Three passes over a `gridRadius = 35` axial disk:
1. **Elevation sampling** — `simplex-noise` 2-octave field at `(q + offset.q) / resolution`. In `STRATEGIC` view a radial falloff turns it into an island; in `TACTICAL` view the falloff is skipped. Elevation is bucketed into 10 terrain types using `waterLevel` and `mountainLevel` thresholds in `genSettings`.
2. **Cohesion** — single-hex specks are replaced with the majority neighbor type (>3 of 6) to reduce noise.
3. **Rivers** — start from MOUNTAIN/SNOW/HILL hexes, walk to the lowest neighbor for up to 300 steps, stop at sea. In TACTICAL mode rivers thicken by tagging neighbors.

### Strategic ↔ Tactical "dive"

The same procedural function produces both views. Clicking a hex while `isScanning` is true:
- captures that hex's noise-space coordinates (`hex.q + noiseOffset.q`, etc.) so the new view samples *that exact patch* of the noise field,
- bumps `resolution` ×4.5 (smaller divisor = zoomed-into-noise = more detail),
- flips `viewMode` to `TACTICAL`.

`RETURN TO STRATEGIC OVERVIEW` resets `noiseOffset` and `resolution` to defaults.

### Refs that mirror state

`isScanningRef` and `noiseOffsetRef` are kept in sync via `useEffect` because the `pointertap` handler is registered once at mount and would otherwise close over stale state. **When you add new state that is read inside the long-lived PIXI handlers, mirror it the same way** — don't re-register handlers per render.

### Battle simulator

`simulateTick(units, orders, config) → { units, orders }` is a **pure** function — no I/O, no React, no PIXI — so the harness can drive it without the rendering stack. It receives a monotonic `config.currentTick` and compares each unit's `nextMoveTick` against it for movement cooldown. The sim itself is stateless; the caller owns the tick counter.

Three unit types (`infantry` / `cavalry` / `skirmisher`) with per-type records for HP, march/charge speed, charge impact, and (skirmisher) missile range. Fractional speed (1.5/tick) is resolved per tick via `stepsForTick(speed, tick)` so the rigid block stays integer-axial.

Five order modes (`march` / `charge` / `retreat` / `unleash` / `defendHeight`). March, charge, retreat are rigid-block — every unit waits on the slowest cooldown. Unleash is per-unit greedy. DefendHeight spreads to the perimeter of a sticky home-terrain blob. Multi-step modes snapshot `startBlocked` at tick start so step N doesn't re-block step N+1 via `applyEntryCooldown` writes from step N.

**Critical invariant:** `tickCounterRef.current` in `GameCanvas.tsx` is monotonic. Reset it ONLY on regenerate-world and return-to-strategic. **Never** reset it when a battle starts — every unit's `nextMoveTick` is an absolute tick number, so a reset puts the whole army on a multi-hundred-tick cooldown.

### Terrain mods

`src/battle/terrain.ts` owns the mechanical fields (`defenseMult`, `moveCost`, `attritionPerTick`, `visionRadius`) — kept React/PIXI-free so the harness can import it. `GameCanvas.tsx` spreads `TERRAIN_MODS[KEY]` into its own `TerrainDef` for HUD/tooltips; do **not** define a parallel mod table inside the component file.

## Worktree note

This is a `git worktree` at `.worktrees/feature-terrain-modifiers` on branch `feature/terrain-modifiers`. The shared repo lives one level up. `.worktrees/` and `.playwright-mcp/` are gitignored.
