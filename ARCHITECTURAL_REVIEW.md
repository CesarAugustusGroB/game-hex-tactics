# Architectural review: hex-tactics

_Last refreshed: 2026-05-25 (branch `feature/infra`). Supersedes the pre-refactor edition._

## Context

A diagnostic snapshot of the codebase's health — what's strong, what's strained, and what
to invest in next. The previous edition of this document predated a large refactor; this
rewrite reflects the **current** state and records which of the old findings have since
been resolved.

## What changed since the last review

The two foundational recommendations from the prior edition shipped:

- **The 1737-line `GameCanvas.tsx` god-file was split.** It is now a 750-line composition
  root. Logic moved into `src/canvas/render/*` (pure draw fns), `src/canvas/input/*` (one
  module per input concern), `PixiApp.ts` (506, PIXI lifecycle), `useBattleTick.ts` (221,
  tick driver), and `HUD.tsx` (711, React panel). (was **F3**)
- **A real data layer exists.** All balance/content values live in `src/data/*.json` with
  typed `*.ts` wrappers and a one-directional module graph (data exposes types;
  canvas/battle re-export). (was the data-hardcoding finding)

Gameplay depth also advanced well beyond the prior "5-line combat loop":

- **Three distinct unit types** with real stats (`units.json`): infantry 100hp / cavalry
  60hp fast / skirmisher 40hp with missiles (range 3, kite threshold). (was **F1**)
- **Terrain + positional combat**: `terrain.json` `defenseMult`, downhill damage bonus,
  height bonus (`combat.json`), and a `hold` defensive-reduction stance. (was **F1**)
- **A per-team AI controller registry** (`src/battle/ai.ts`), wired through the Command
  Points gate. (was **F2**)
- **A Command Points economy** (`command-points.ts`): pure cost/`debit`/`applyRegen`
  helpers, gated at one chokepoint (`chargeCP` in `GameCanvas.tsx`), **with an
  assertion-based test** (`scripts/test-command-points.ts`). This is the model pattern for
  adding a subsystem.

## Strengths to preserve

1. **Pure `simulateTick`.** Still the load-bearing decision — deterministic, harness-
   drivable, replay/netcode-ready. The AI registry attaches to it without compromising
   purity.
2. **One-canvas PIXI architecture** with the "mirror state into refs for long-lived
   handlers" discipline, now documented and consistently applied.
3. **Decomposition by responsibility.** render / input / sim / data each have a home; the
   composition root just wires them. Adding a mode no longer means editing one 1700-line
   file.
4. **The data layer.** JSON for values, `.ts` for types/transforms, type-only imports to
   avoid value cycles. Easy to retune balance without touching logic.
5. **Strategic↔tactical dive via noise reseeding** — elegant, no level data to ship.
6. **Hex math centralized** in `HexUtils.ts` (flat-top, 113 lines, stable).

## Findings (current)

### Infra

**I1. Documentation drift (being addressed in this branch).** `README.md` was still the
stock Vite template; `AGENTS.md` described a pre-refactor world (pointy-top hexes, "three
files hold all logic," wrong worktree); this review itself was stale. For a project whose
workflow leans on agent-readable docs, that's a correctness bug, not cosmetics. The
`feature/infra` pass refreshes README, AGENTS.md, and this file. **Keep them current as
part of each feature** — treat doc drift like a failing test.

**I2. No CI; the regression gate is manual.** `npm run sim` and `npm run test:cp` exist but
nothing runs them automatically. There is no `.github/` workflow running
`lint`/`build`/`sim`/`test:cp` on push. Regressions in the formation engine — the most
algorithmically fragile code — can ship silently.

**I3. `sim-formations.ts` still prints rather than asserts.** `test-command-points.ts`
proved the assertion pattern; the much larger formation harness (555 lines) is still
print-for-human-inspection. Converting its scenarios to assertions is the highest-value
test work remaining (was **F4**, now half-resolved).

**I4. Build/ergonomics, minor.** `vite.config.ts` is bare (no path aliases → deep
`../../battle/...` imports). ESLint uses `recommended`, not `recommendedTypeChecked`
(the README's own suggestion). Neither is urgent.

### Performance

**P-F5. O(N²) render lookups persist (unfixed).** `gridData` is still a flat array;
per-render `gridData.find(d => d.hex.q === … && d.hex.r === …)` survives in
`drawUnits.ts:175` (per unit, per frame) and in `orderDrag.ts`, `paintMode.ts`,
`drawTerrain.ts`. Invisible at ~145 units; bites at 500+. ~30-line fix: build a
`Map<key,tile>` once at the top of each draw fn (or index `gridData` at write time).

### Gameplay / design (carried forward — not re-verified this pass)

These were flagged in the prior edition and were not re-audited in this refresh; listed so
they aren't lost:

- **F6. Order visualization is sparse** — at scale the battlefield reads as identical
  pieces; little persistent per-group intent cue beyond the lieutenant marker.
- **F7. Orders mix player intent with transient sim state** (`chargeTicksRemaining`,
  `defendAssignments`, etc. in one struct) and use `Map`s that don't JSON-serialize —
  debt for future save/replay.
- **F8. Movement stalls in adversarial geometry** (swap-deadlock, unreachable rank slots);
  no A* fallback. Low-frequency at moderate density.
- **F9. No save / load / replay** — cheap to add given the pure sim; would raise perceived
  completeness.
- **F10. Strategic layer is decorative** — the dive is a *capability*, not yet a campaign
  loop (no overworld army movement, economy, or objectives).

## Recommendations (priority-ordered)

### P0 — this week, low risk
1. **Finish the doc refresh** (this branch) and adopt "docs current or it's not done."
2. **Add a CI workflow** running `lint` → `build` → `sim` → `test:cp` on push/PR (**I2**).
3. **Index `gridData` as a `Map<key,tile>`** in the draw functions (**P-F5**).

### P1 — foundational
4. **Convert `sim-formations.ts` scenarios to assertions** so a broken formation fails the
   run, not the user weeks later (**I3**).
5. **Path aliases** (`@battle`, `@canvas`, `@data`) in `vite.config.ts` + `tsconfig` to kill
   the deep relative imports (**I4**).

### P2 — game-shaping
6. **Order visualization layer** — persistent per-group destination/intent rendering (**F6**).
7. **Save / load via the pure sim** — `serializeState(...)` ↔ JSON, with `Map`↔object
   helpers; pairs naturally with replay (**F7**, **F9**).

### P3 — long-term
8. **A\* fallback** for blocked units, applied only when greedy + lateral both fail (**F8**).
9. **A real strategic loop** — overworld army movement that makes the dive a campaign
   mechanic rather than a tech demo (**F10**).

## Critical files to reference

- `src/battle/simulate.ts` (1321) — combat phase, formation engine, `simulateTick` entry.
- `src/battle/command-points.ts` (51) — the model subsystem pattern (pure + tested).
- `src/components/GameCanvas.tsx` (750) — composition root; CP gating via `chargeCP`.
- `src/canvas/render/drawUnits.ts` — the per-frame `gridData.find` hotspot (**P-F5**).
- `scripts/sim-formations.ts` (555) — scenarios that print but don't assert (**I3**).
- `src/data/*` — balance/content single source of truth.

## What this review is NOT

- Not a netcode review (no networking yet).
- Not a shader/graphics review (PIXI defaults are fine at this scale).
- Not a bundle audit (Vite config is minimal but adequate; the size warning is benign).
- Not a TypeScript-strictness audit (strict mode is on; types are good).

## Suggested next conversation

Land **P0** (docs + CI + `gridData` indexing) as the natural `feature/infra` payload — all
low-risk groundwork — then take **P1** (assert the formation harness, path aliases) before
returning to gameplay depth.
