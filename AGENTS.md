# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (default http://localhost:5173). The parent worktree may already be using this port; pass `-- --port 5174` if needed.
- `npm run build` — `tsc -b` (project references) then `vite build`. Type errors fail the build.
- `npm run lint` — ESLint over the repo (config: `eslint.config.js`, flat config).
- `npm run preview` — serve the production build.

There is no test runner configured.

## Architecture

Single-canvas PIXI.js application with a thin React HUD. Three files hold essentially all logic:

- `src/main.tsx` — React root.
- `src/App.tsx` — renders only `<GameCanvas />`.
- `src/components/GameCanvas.tsx` — the entire app: world generation, rendering, input, HUD.
- `src/hex-engine/HexUtils.ts` — pure axial-coordinate hex math (pointy-top, `size = 40`).

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

## Worktree note

This is a `git worktree` at `.worktrees/feature-units` on branch `feature/units`. The shared repo lives one level up. `.worktrees/` and `.playwright-mcp/` are gitignored.
