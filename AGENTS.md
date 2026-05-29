# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` is the deeper
companion to this file (full rendering-pipeline detail, data-layer conventions, world-gen
internals); `LEARNINGS.md` records gotchas worth not re-discovering. Read those when a
change touches their area.

## Style

**Less is more.** Concise replies (answer, result, stop). Minimal code — no comments that
restate the code, no defensive checks for impossible states, no abstractions for
hypothetical reuse. Only comment when the *why* is non-obvious (a library gotcha, a
load-bearing invariant, a workaround). Delete dead code instead of commenting it out.

## Commands

- `npm run dev` — Vite dev server (default http://localhost:5173). Pass `-- --port 5174` if the port is taken.
- `npm run build` — `tsc -b` (project references) then `vite build`. Type errors fail the build.
- `npm run lint` — ESLint over the repo (`eslint.config.js`, flat config).
- `npm run preview` — serve the production build.
- `npm run sim` — headless battle harness over ~21 scenarios. Run after any change to `src/battle/*`. On Windows where `tsx` isn't on PATH, run `npx tsx scripts/sim-formations.ts`.
- `npm run test:cp` — assertion-based test for the Command Points module.

There is no test runner; the two scripts above are the regression gate.

## Architecture

Single-canvas PIXI.js v8 application with a thin React 19 HUD. The codebase is decomposed
by responsibility — no longer a single god-file.

- `src/main.tsx` / `src/App.tsx` — React bootstrap.
- `src/components/GameCanvas.tsx` — composition root: owns React state + mirrored refs, wires the hooks and render callbacks, renders `<HUD>`.
- `src/canvas/` — the PIXI layer:
  - `PixiApp.ts` (`usePixiApp`) — Application lifecycle, texture loading, container hierarchy, pointer/wheel/ticker wiring, cleanup.
  - `useBattleTick.ts` (`useBattleTick`) — `setInterval` tick driver: `simulateTick` + projectile animation + capture/win detection.
  - `HUD.tsx` — pure React HUD panel.
  - `world-gen.ts` — pure `generateWorldData()` (noise + cohesion + rivers).
  - `constants.ts` — re-exports from `src/data/game.ts` plus canvas-side derived helpers (deploy-zone, capture-zone, key formatters).
  - `render/` — pure draw functions: `drawTerrain.ts`, `drawDetails.ts`, `drawUnits.ts`.
  - `input/` — `useTacticalKeyboard.ts`, `useGlobalShortcuts.ts`, `orderDrag.ts`, `paintMode.ts`.
- `src/battle/` — pure, no React/PIXI:
  - `simulate.ts` — `simulateTick(units, orders, config) → { units, orders }`. Order modes (`march`/`charge`/`retreat`/`unleash`/`hold`/`idle`), three unit types, per-type tunables.
  - `terrain.ts` — terrain modifier table (defense/moveCost/attrition/vision + downhill bonus).
  - `ai.ts` — per-team AI controller registry (`registerAiController`); the tick loop polls it before each sim step.
  - `command-points.ts` — pure CP cost/`debit`/`applyRegen` helpers (cap 20, regen +1 every 4 ticks).
- `src/hex-engine/HexUtils.ts` — pure axial hex math, **flat-top**, `size = 40`. Flat edges face N/S, vertices point E/W. `HexUtils.key({q,r})` is the canonical `Map` key — always use it.
- `src/data/` — every balance/content value as `*.json` paired with a typed `*.ts` wrapper. Consumers import from the `.ts`, never the `.json`. Single source of truth; do not duplicate a tunable table elsewhere.

### Two coordinate systems

1. **Axial hex** (`q`, `r`) — the logical grid. Convert with `HexUtils.hexToPixel` / `pixelToHex`.
2. **PIXI world** — `worldRef` is panned/zoomed; convert screen → world with `world.toLocal(...)` before hex lookups.

## Load-bearing invariants

- **Monotonic tick counter.** `tickCounterRef` (in `GameCanvas.tsx`) is monotonic. Reset it ONLY on regenerate-world and return-to-strategic. **Never** reset it when a battle starts — units carry absolute `nextMoveTick` values, so a reset strands the whole army on a multi-hundred-tick cooldown.
- **Mirror state into refs for long-lived handlers.** PIXI pointer/ticker handlers are registered once at mount and would close over stale state. New state read inside those handlers must be mirrored into a ref via `useEffect` (see the block of `*Ref` mirrors in `GameCanvas.tsx`). Don't re-register handlers per render.
- **Keep `simulateTick` pure.** No I/O, no React, no PIXI — that purity is what lets the harness and the AI registry drive it. The caller owns the tick counter.
- **PIXI v8 `Color.multiply(number)`** treats the number as a hex int via bit-shifts (`0.7 | 0 === 0` → black). Always pass an RGB-normalised array `[s, s, s, 1]` when shading. See `LEARNINGS.md`.

## Worktree note

This repo uses `git worktree`. The current worktree is `.worktrees/feature-infra` on branch
`feature/infra`; the shared repo lives one level up. `.worktrees/` and `.playwright-mcp/`
are gitignored.
