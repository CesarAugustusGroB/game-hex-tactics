# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Style

**Less is more.** Applies to both replies and code:

- **Replies:** concise. No preamble, no trailing summaries, no recap of what you just did. Answer the question, state the result, stop. A one-line answer beats a paragraph.
- **Code:** minimal. No comments that restate the code. No defensive checks for impossible states. No abstractions for hypothetical reuse. No backwards-compat shims. Delete unused code instead of commenting it out. If three lines do the job, don't write ten.
- **Only add comments when the WHY is non-obvious:** a library gotcha, a load-bearing invariant, a workaround for a specific bug. If removing the comment wouldn't confuse a future reader, don't write it.

## Documentation cadence

Periodically (every ~3–5 substantial back-and-forths, or after landing a tricky bug fix or architectural change) prompt the user with: **"Hay algo de esto que valga la pena documentar en `LEARNINGS.md`?"** Suggest concrete candidates — a non-obvious bug we just fixed, a library gotcha we hit, a design decision with a "why" that won't be visible from the code, a pattern worth repeating. If the user says yes, append to `LEARNINGS.md` in the existing style (descriptive prose, focused on the trap or insight, not a play-by-play). Skip routine work — only ask when there's a real candidate.

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
- `src/hex-engine/HexUtils.ts` — pure axial-coordinate hex math (flat-top, `size = 40`).
- `src/battle/simulate.ts` — pure battle simulator (no React/PIXI). Exports `simulateTick`, unit/order types, and per-type tunables (`MARCH_HEXES_PER_TICK`, `MAX_HP_BY_TYPE`, etc.).
- `src/battle/terrain.ts` — pure terrain modifier table (defense/moveCost/attrition/vision) and downhill damage bonus. Sole owner of mechanical terrain values.
- `scripts/sim-formations.ts` — Node harness that drives `simulateTick` against scripted scenarios. Mirrors map state via a fake `MapApi`. Treat as a regression check.

### Two coordinate systems

1. **Axial hex coordinates** (`q`, `r`) — the logical grid. Convert with `HexUtils.hexToPixel` / `pixelToHex`. `HexUtils.key({q,r})` is the canonical `Map` key — always use it instead of stringifying ad-hoc.
2. **PIXI world coordinates** — the `worldRef` container is panned/zoomed; its children (`terrainGfx`, `highlightGfx`) are drawn in world space. Convert screen → world with `world.toLocal(...)` before doing hex lookups.

### Rendering pipeline (`GameCanvas.tsx`)

`gridData` → `drawMap()` rebuilds the terrain in two passes:

1. **`terrainGfx` (Pass 1, per-hex Graphics)** — top polygon fill (flat colour or `Texture` for `RIVER`/`SAND`/`SEA`/`DEEP_SEA`) plus shaded S/SE/SW side walls. Walls are drawn **only for non-textured biomes** (`SAND`, `RIVER`, `SEA`, `DEEP_SEA`, `ROCKY`); textured biomes get their cliff faces from Pass 2 instead. Hexes iterate in ascending `TERRAINS[type].height` so taller terrain renders after — and thus over — its shorter neighbours.
2. **`terrainOverlayRef` (Pass 2, `TilingSprite` + hex-mask per biome)** — `GRASSLAND` / `FOREST` / `HILL` / `MOUNTAIN` / `SNOW` each get a world-space tiled texture clipped to a mask. The base mask of each biome is **the union of its hex top polygons _plus_ the visible cliff face against each shorter neighbour** (a `(hexH − nH)`-tall quad along the S/SE/SW shared edge). Result: the biome texture paints continuously over both the hex top and the cliff slope — no dark shaded wall and no protrusion into the shorter neighbour's territory. Decoration layers (grass-macro, dry/dense/flowery patches) reuse the same per-biome filter but stay top-only.

Heights live in `TERRAINS[type].height`. `highlightGfx` and `previewGfx` are redrawn every tick from the ticker (not from React state) so hover/drag updates don't re-run `drawMap`.

A single `PIXI.Application` is created once in a mount-only `useEffect` (`[]`). World z-order: `terrainGfx → terrainOverlayRef → detailsGfx → gridGfx → bordersGfx? → unitsGfx → projectilesGfx → previewGfx → highlightGfx`. The world container is panned via `pointerdown` + `globalpointermove` and zoomed by a wheel listener on the DOM container that anchors zoom to the cursor.

**PIXI v8 gotcha:** `Color.multiply(number)` treats the number as a hex int via bit-shifts (`0.7 | 0 === 0` → black). Always pass an RGB-normalised array (`[s, s, s, 1]`) when shading. See `LEARNINGS.md` for the full story.

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
