# Nightly diagnostic — 2026-05-28 (`feature/infra`)

Baseline at start of run: `build`, `sim`, `test:cp`, `test:scoring` green —
but **`lint` was RED** (1 error). After this run all five are green.

## Findings (prioritized)

### Bugs / gate health

- **B1 (fixed this run) — `lint` gate is red: `react-hooks/set-state-in-effect`
  at `GameCanvas.tsx:734`.** The world-generation effect
  `useEffect(() => { generateWorldData(); }, [generateWorldData])` called
  `setGridData(...)` synchronously inside an effect body, which the React-hooks
  rule flags as a cascading-render. This is a pre-existing red gate (it slips in
  through the `feature/world-gen` merge `d37a57d`); any commit on the branch
  would have shipped a red `lint`. Highest-value fix because a red gate blocks
  every nightly's verify contract.

### Perf

- **P-F5 (carried, not changed) — single-shot `gridData.find` scans persist.**
  `paintMode.ts`, `orderDrag.ts`, and `drawTerrain.ts` still do O(N)
  `gridData.find` lookups, but they fire on discrete pointer/structural events,
  not per frame. The two genuinely hot instances (per-frame `updateHighlights`
  and per-unit `drawUnits`) were already indexed in prior runs. Low value; left
  alone.

### Housekeeping / docs

- **I2 — no CI** (open): nothing runs `lint`/`build`/`sim`/`test:cp`/`test:scoring`
  automatically. This run is a direct example of why it matters — a red `lint`
  rode in on a merge and would only have been caught by hand.
- **I3 — `sim-formations.ts` prints rather than asserts** (open): highest-value
  remaining test work; out of scope for a one-change nightly.
- **D1 — `ARCHITECTURAL_REVIEW.md` P-F5 wording is still stale** (open, noted in
  the 2026-05-27 report): names `drawUnits.ts:175` as an unfixed hotspot although
  it has been indexed.

## Implemented

Converted `gridData` from `useState` + setState-in-effect to a derived `useMemo`
in `GameCanvas.tsx`:

- removed the `gridData` `useState` and the `generateWorldData` `useCallback`;
  `gridData` is now `useMemo(() => generateWorldDataPure(...).gridData,
  [genSettings, gridRadius, viewMode])`;
- deleted the offending `useEffect(() => { generateWorldData(); }, ...)`;
- removed the now-dead imperative plumbing: `generateWorldData` is no longer
  passed through `pixiCtx`, and `PixiApp.ts` no longer declares it on its context
  interface nor calls `ctx.generateWorldData()` at the end of `start()`.

**Why:** `gridData` is a pure function of `(genSettings, gridRadius, viewMode)` —
`setGridData` had exactly one caller — so deriving it in render is the idiomatic
React fix the lint rule is steering toward. It also removes a redundant *second*
world generation at mount (the effect and `PixiApp.start()` both regenerated the
same data) and the transient empty-array render. Behavior is preserved:
regeneration and the strategic→tactical dive both drive off `setSettings`/
`viewMode` changes, which the `useMemo` deps already track. No new dependencies,
no gameplay/balance change.

**Verify:** `lint` (clean), `build` (exit 0), `sim` (exit 0), `test:cp` (20/20),
`test:scoring` (all) — all pass. Note: the change touches the PIXI mount path,
which has no automated/browser coverage in this environment; it was verified
through the five gates and by static reasoning (single `setGridData` caller, deps
unchanged), not by running the app in a browser.
