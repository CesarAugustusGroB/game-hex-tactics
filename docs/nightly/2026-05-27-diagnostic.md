# Nightly diagnostic — 2026-05-27 (`feature/infra`)

Baseline: `lint`, `build`, `sim`, `test:cp`, `test:scoring` all green before and after.

## Findings (prioritized)

### Perf

- **P1 (fixed this run) — per-frame `gridData.find` in `updateHighlights`.**
  `GameCanvas.tsx`'s `updateHighlights` is invoked **every frame** by the PIXI
  ticker (`PixiApp.ts:498`). While a hex is hovered it ran
  `gridData.find(d => d.hex.q === … && d.hex.r === …)` — a linear scan over the
  full grid (~3781 hexes at `GRID_RADIUS=35`) on every frame. The sibling
  per-render `curT` lookup (HUD terrain readout) did the same scan. This is a
  live instance of the **P-F5** class the architectural review flagged, but the
  review only named `drawUnits.ts:175` — which has **already** been fixed (it
  now builds a `tileTypeByKey` Map at `drawUnits.ts:180`). The composition-root
  instances were missed.

- **P2 (not changed) — remaining single-shot `.find` scans are not hot.**
  `paintMode.ts:59`, `orderDrag.ts:228` (one lookup per pointer event) and
  `drawTerrain.ts:687` (one lookup per full terrain rebuild) are O(N) but fire
  on discrete user/structural events, not per frame. Low value; left alone.

### Housekeeping / docs

- **D1 — `ARCHITECTURAL_REVIEW.md` P-F5 is stale.** It claims the O(N²) render
  lookup "persists … in `drawUnits.ts:175` (per unit, per frame)". That hotspot
  was indexed into a Map and is fixed. The review should be updated to reflect
  that the per-frame find now only survived in the composition root (addressed
  here). Not changed this run to keep scope to one focused edit.

- **I3 — `sim-formations.ts` still prints rather than asserts** (open). The
  highest-value remaining test work; out of scope for a one-change nightly.

### Bugs

- No new correctness bugs found. GSAP teardown paths (`drawUnits` `killUnitTweens`,
  `movementFx` single-timeline cleanup, `useBattleTick` projectile single-tween
  destroy) all follow the "kill-before-destroy / co-own siblings in one timeline"
  discipline documented in `LEARNINGS.md`. The scoring/tick async-flush invariant
  is documented at its site.

## Implemented

Memoized a `Map<hexKey, terrainType>` (`tileTypeByKey`) from `gridData` in
`GameCanvas.tsx`, rebuilt only when `gridData` changes (world regen / dive), and
replaced both the per-frame `updateHighlights` scan and the per-render `curT`
scan with O(1) `Map.get(HexUtils.key(...))` lookups.

**Why:** removes a real per-frame O(N) scan (≈3.8k comparisons/frame while
hovering) from the ticker hot path with zero behavior change, following the exact
`tileTypeByKey` pattern already used in `drawUnits.ts`. No new dependencies, no
gameplay/balance change.

**Verify:** `lint`, `build`, `sim` (exit 0), `test:cp` (20/20), `test:scoring`
(all) — all pass.
