# Refactor `GameCanvas.tsx` into modular files (8-phase roadmap)

## Context

`src/components/GameCanvas.tsx` is a 3327-line god-component owning six unrelated concerns: module-scope constants & terrain defs, 40+ PIXI texture refs, world generation, terrain/detail/unit renderers, drag/pointer/keyboard input, the simulation tick loop, AI dispatch, capture-progress accounting, projectile spawning, and the entire HUD JSX. Every small change requires loading the whole context of the file; cross-cutting tweaks (e.g. adding a new HUD panel that reads orders) force navigation through hundreds of lines of unrelated rendering code.

The goal: pull the file apart along its natural seams into one God-Component → ~150-line shell that wires up well-scoped modules. Each phase is an independent PR. Phases are ordered so each leaves the app working and reduces the file's size monotonically.

## End-state file tree

```
src/
  battle/                     (unchanged — pure sim, already separated)
    simulate.ts
    terrain.ts
    ai.ts
  hex-engine/                 (unchanged)
    HexUtils.ts
  game/
    constants.ts              — DRAG_THRESHOLD_PX, DIVE_ZOOM, TICK_MS, RETREAT_REFUND_FRAC, CAPTURE_TICKS_TO_WIN…
    terrainDefs.ts            — TERRAINS, DETAIL_RULES, ALL_DETAIL_KEYS, TerrainDef type
    types.ts                  — OrderDrag, InputMode, Armies, Rosters, GroupOrders, GroupFormations, GroupDepths
    deployZone.ts             — DEPLOY_ZONE_FRAC, deployZoneFor()
    captureZone.ts            — CAPTURE_CENTER, CAPTURE_ZONE_HEXES, captureZoneKeys()
    worldGen.ts               — generateWorldData(settings, viewMode, gridRadius, noise) → GridData
  rendering/
    assets.ts                 — loadTextures() → TextureBundle (terrain, units, details, flag, javelin)
    worldSetup.ts             — createPixiApp(container) → { app, world, layers: PixiLayers, renderLoop }
    terrainRenderer.ts        — drawMap(layers, gridData, opts)
    detailRenderer.ts         — drawDetails(layers, gridData, textures)
    unitRenderer.ts           — drawUnits(layers, armies, opts, tweenState)
    projectileRenderer.ts     — spawnProjectiles(layers, projectiles, texture)
    captureFlagRenderer.ts    — drawCaptureZone + flag sprite positioning
    shaders/
      waterFilter.ts          — GLSL source + WATER_FILTER_CONFIGS + createWaterFilter() factory + advanceWaterTime(handles, deltaSec)
  input/
    usePointerHandlers.ts     — pan/zoom/tap/paint/drag handlers + drag-order state
    useKeyboard.ts            — tactical-order + global shortcuts via declarative key→action map
  state/
    useBattleState.ts         — armies, rosters, orders, formations, depths, selection, capture, win
    useOrderCommands.ts       — issueOrder, clearOrder, toggleMode, marchForward (depends on useBattleState)
    useBattleTick.ts          — setInterval + AI dispatch + simulateTick + capture-progress + win check
  hud/
    Hud.tsx                   — layout shell, composes the panels below
    WinBanner.tsx
    CaptureProgress.tsx
    TerrainTooltip.tsx
    DeployButtons.tsx
    TeamToggle.tsx
    GroupsPanel.tsx           — wrapper over 3 groups
      GroupRow.tsx            — one row's 2 button rows + state (currently ~300 lines of IIFEs)
    BattleControls.tsx        — START/PAUSE, RESET BATTLE, RETURN TO STRATEGIC, REGENERATE
  components/
    GameCanvas.tsx            — ~150 lines: mount PIXI via worldSetup + assets, instantiate state hooks, render <Hud/>
```

## Cross-cutting principles (apply to every phase)

- **PIXI refs are NOT React Context**. Pass them explicitly. `worldSetup.ts` returns a single `PixiLayers` object that downstream renderers/handlers receive as a parameter. Context hides initialisation order and makes refactors fragile.
- **Renderers are one-way pure**: `(layers, data, opts) → void`. They never own React state or call setters. The exception: `unitRenderer.ts` owns a GSAP-tween container map, passed in as a `tweenState` ref.
- **Pointer handlers are the only place inversion happens** (PIXI events → React setters). That asymmetry is intentional.
- **No new global store** (Zustand/Redux). `useBattleState` agglomerates the ~12 current `useState` into a single hook return; that's enough.
- **Each phase compiles, lints, runs in browser, and passes `npx tsx scripts/sim-formations.ts`** before merging.
- **Git strategy**: one branch per phase, branched off the previous phase's merge. Use `git worktree` so the previous phase's code stays available for diff/reference.
- **Shader code (`rendering/shaders/waterFilter.ts`) is a module of its own** even though it's small (~120 lines total). Don't inline GLSL strings inside renderer files — they're whitespace-sensitive and benefit from their own home for future shaders (terrain-flow, fog-of-war reveal, etc.) that may follow the same factory pattern.

## Phase 1 — Extract pure data modules (incl. shader source)

**Scope.** Move all module-scope constants, types, pure helpers, and the water-shader GLSL source out of `GameCanvas.tsx`. No logic changes; only re-exports and re-imports.

**Files created.** `game/constants.ts`, `game/terrainDefs.ts`, `game/types.ts`, `game/deployZone.ts`, `game/captureZone.ts`, `rendering/shaders/waterFilter.ts` (initial seed — only constants/types this phase; factory lands in Phase 4).

**What moves.**
- `constants.ts`: `DRAG_THRESHOLD_PX`, `DIVE_ZOOM`, `STRATEGIC_RESOLUTION`, `HEADING_ARROWS`, `COHORT_SIZE`, `INITIAL_ROSTER`, `RETREAT_REFUND_FRAC`, `CAPTURE_TICKS_TO_WIN`, `LOD_THRESHOLD`, `TICK_MS`, `DAMAGE_PER_TICK`.
- `terrainDefs.ts`: `TerrainDef` interface, `TERRAINS` record, `DetailLayerConfig`/`TerrainDetailRules` types, `DETAIL_RULES`, `ALL_DETAIL_KEYS`, `GRASS_KEYS`/`FLOWER_KEYS`/etc, `numKeys()` helper, `detailAssetPath()`, `spriteCategory()`, `pickWeighted()`, `seededRandom()`, `getHexSeed()`, `grassChunkPatch()`.
- `types.ts`: `OrderDrag`, `InputMode`, `Armies`, `Rosters`, `Roster`, `GroupOrders`, `GroupFormations`, `GroupDepths`, `Hex` re-export.
- `deployZone.ts`: `DEPLOY_ZONE_FRAC`, `deployZoneFor()`.
- `captureZone.ts`: `CAPTURE_CENTER`, `CAPTURE_ZONE_HEXES`, `captureZoneKeys()`.
- `rendering/shaders/waterFilter.ts`: `WATER_FILTER_VERTEX`, `WATER_FILTER_FRAGMENT`, `WATER_FILTER_CONFIGS` (deepSea + coastal presets), `WaterFilterConfig`, `WaterFilterHandle` interfaces. **The `createWaterFilter` factory stays in `GameCanvas.tsx` for now** — it touches `PIXI.Filter`/`PIXI.GlProgram` and belongs to the rendering layer, which moves in Phase 4. Splitting it from its GLSL source temporarily is fine since both files are imported together.

**Files modified.** `GameCanvas.tsx`: replace module-scope blocks with imports. No other code touched.

**Verification.**
1. `npm run build` passes (no new errors).
2. `npm run lint` baseline unchanged.
3. `npx tsx scripts/sim-formations.ts` numbers identical.
4. Browser smoke: dive into tactical, deploy a unit, run a battle — visual output unchanged. **Specifically check water animation** (SEA/DEEP_SEA hexes should still shimmer at the same speed/strength).

**Risk.** Near-zero. Purely mechanical. The biggest gotcha is making sure `detailAssetPath` and `seededRandom` and `pickWeighted` keep the same signatures since `drawDetails` calls them, and that the shader GLSL strings are preserved byte-for-byte (whitespace-sensitive on some drivers).

**LOC moved out:** ~500 (constants 418 + shader source/configs/types ~80).

## Phase 2 — Extract `generateWorldData`

**Scope.** Pull world generation out as a pure function. It currently sits inside a `useCallback` with deps `[genSettings, gridRadius, viewMode]` but mutates nothing — it builds and returns a fresh `gridData`.

**Files created.** `game/worldGen.ts` exporting `generateWorldData(input: GenInput) → GridEntry[]` where `GenInput = { settings, viewMode, gridRadius, noise, detailDensityNoise, tacticalHalfW?, tacticalHalfH?, tacticalBboxQ?, tacticalBboxR? }`.

**Files modified.** `GameCanvas.tsx`: the in-component `useCallback` becomes a 5-line wrapper that pulls refs and `genSettings` and calls the pure function. Noise refs stay where they are.

**Verification.** Same as Phase 1. Strategic and tactical map generation must produce visually-identical results (compare a screenshot or just deploy + battle as before).

**Risk.** Low. The function is already pure-ish; the only state it owns is the `noiseRef`/`detailDensityNoiseRef` lazy-init pattern, which can be hoisted into the caller or passed in.

**LOC moved out:** ~110.

## Phase 3 — Extract asset loader

**Scope.** The async block that loads ~40 textures inside the mount `useEffect` becomes a `loadTextures()` function returning a `TextureBundle`.

**Files created.** `rendering/assets.ts`:
```ts
export type TextureBundle = {
  units: { red: Record<UnitType, PIXI.Texture>, blue: Record<UnitType, PIXI.Texture> },
  terrain: { base: Record<TerrainKey, PIXI.Texture>, variations: …, patches: … },
  details: Map<string, PIXI.Texture>,
  flag: PIXI.Texture,
  javelin: PIXI.Texture,
};
export async function loadTextures(): Promise<TextureBundle>;
```

**Files modified.** `GameCanvas.tsx` mount useEffect: replace the ~150-line texture-loading block with `const textures = await loadTextures()`. The existing 40+ texture refs collapse to one ref holding the bundle.

**Verification.** Build/lint/harness/browser. The first paint after dive should look identical.

**Risk.** Medium. Some sprite refs are stored individually for use deep in renderers (e.g. `javelinTextureRef` accessed during projectile spawn). The bundle pattern means renderers/handlers receive `textures` instead. Catch: HMR may reload the bundle — ensure the loader is idempotent or guarded.

**LOC moved out:** ~150 from `GameCanvas.tsx`, ~200 in new file (with types).

## Phase 4 — Extract renderers (the big win)

**Scope.** `drawMap`, `drawDetails`, `drawUnits`, projectile spawn — each becomes a pure-on-PIXI function taking `(layers, data, ...)`. This is the single biggest reduction in `GameCanvas.tsx` LOC.

**Sub-phases (one PR each):**

**4a — `worldSetup.ts` + finish `waterFilter.ts`** first, because the others depend on it. Exports `createPixiApp(container) → { app, world, layers: PixiLayers, renderLoop: { addCallback(fn), removeCallback(fn) } }` where `PixiLayers = { terrainGfx, terrainOverlay, detailsGfx, gridGfx, deployZoneGfx, captureZoneGfx, captureFlag, unitsGfx, projectilesGfx, previewGfx, highlightGfx }`. Encapsulates the z-order assembly currently at lines ~2846–2861 plus a thin wrapper over `app.ticker.add` so per-frame consumers don't reach into the PIXI app directly.

  Also in this sub-phase: **move the `createWaterFilter` factory** out of `GameCanvas.tsx` into `rendering/shaders/waterFilter.ts` (joining the GLSL source extracted in Phase 1). Add `advanceWaterTime(handles: WaterFilterHandle[], deltaSec: number): void` as the per-frame uniform update — the body is the current 3-line loop at ~line 2329. The `waterFilterHandlesRef` becomes owned by `terrainRenderer.ts` (Phase 4b) and registered with `renderLoop.addCallback` so the ticker calls `advanceWaterTime` every frame.

**4b — `terrainRenderer.ts`.** `drawMap(layers, gridData, { showGrid, terrainTexturesLoaded, viewMode, textures, waterHandles })`. Becomes a pure function; the existing `useCallback` becomes a 5-line `useEffect` that re-renders when deps change. The renderer pushes onto `waterHandles` as it creates filters per overlay sprite (current line ~1145). The per-frame `advanceWaterTime` call is registered once at mount via `renderLoop.addCallback`.

**4c — `detailRenderer.ts`.** `drawDetails(layers, gridData, textures)`. Same pattern.

**4d — `unitRenderer.ts`.** `drawUnits(layers, { armies, viewMode, gridData, currentStrategicHex, groupOrders, fogOfWar, selectedTeam, textures, tweenState })`. The trickiest: it owns a `Map<unitId, PIXI.Container>` and GSAP tweens. Pass that map in as `tweenState` ref so the renderer maintains it across calls without losing tween identity. Test by deploying units and verifying smooth movement during a battle.

**4e — `projectileRenderer.ts` + `captureFlagRenderer.ts`.** Smaller. Both follow the same shape.

**Verification per sub-phase.** Build, browser test, especially: terrain looks identical, water shimmers at the same speed (compare side-by-side if possible), deploy and attack to see units tween smoothly, throw a javelin (skirmisher at range) to verify projectiles, win a battle to verify capture-flag drawing.

**Risk.** Medium-high — the unit renderer GSAP-tween-container management is the most subtle bit. Mitigate by making 4d its own PR with careful manual testing. For 4a, the water-shader split has a subtle risk: if the per-frame callback registration leaks across HMR reloads, you'll get multiplied `uTime` advancement and the water will look like it's spinning. Guard with a cleanup that calls `renderLoop.removeCallback` on unmount.

**LOC moved out:** ~1000 total across the sub-phases (incl. shader factory + per-frame loop).

## Phase 5 — Extract input hooks

**Scope.** The pointer/wheel/pointertap handlers inside the mount `useEffect`, plus the two keyboard useEffects, become hooks.

**Files created.**
- `input/usePointerHandlers.ts` — `usePointerHandlers({ world, container, viewMode, isScanning, inputMode, deps… })`. Owns drag state (`OrderDrag`), calls into commands.
- `input/useKeyboard.ts` — single keyboard hook backed by a declarative `{ key: { handler, when: 'tactical'|'global' } }` map. Replaces the two 8-arm switch statements.

**Files modified.** `GameCanvas.tsx`: the long pointer-event block in mount `useEffect` is replaced by a hook call. Both keyboard `useEffect`s collapse into `useKeyboard({ commands, selection, battle })`.

**Verification.** Manual: pan, zoom, dive, deploy by drag, place units by paint, all keyboard shortcuts (T/Q/W/E/R/S/A/D/F + 1/2/3 + Z/X/C + SPACE + ,/< + Backspace) — each one fires exactly once and only in the right mode.

**Risk.** Medium. The pointer drag state crosses multiple events and the preview render. Test by issuing several drag orders back-to-back to make sure state resets.

**LOC moved out:** ~400.

## Phase 6 — Extract state hooks

**Scope.** Consolidate the ~12 `useState` + their refs into `useBattleState()`. Move order-mutation callbacks into `useOrderCommands(state)`.

**Files created.**
- `state/useBattleState.ts` returning `{ armies, setArmies, armiesRef, rosters, setRosters, rostersRef, groupOrders, groupOrdersRef, groupFormations, groupDepths, selectedTeam, selectedTeamRef, selectedGroup, selectedGroupRef, selectedUnitType, captureProgress, captureProgressRef, winBanner, setWinBanner, isBattleRunning, setIsBattleRunning, inputMode, fogOfWar, currentStrategicHex }`.
- `state/useOrderCommands.ts` returning `{ issueOrder, clearOrder, toggleMode, marchForward }`. Depends on `useBattleState`.

**Files modified.** `GameCanvas.tsx`: replace all `useState`/`useRef` mirroring with two hook calls.

**Verification.** Full battle playthrough including: deploy → march → engage → retreat (refund) → unleash → capture flag → win. Every state transition that worked before still works.

**Risk.** Medium. Lots of refs to sync. Easy to miss one and end up with stale-closure bugs. Mitigate by doing a fresh search for `useRef<` after the migration and confirming every old ref is reachable via the new hook.

**LOC moved out:** ~300.

## Phase 7 — Extract battle tick loop

**Scope.** The setInterval `useEffect` at lines ~2287–2449 becomes `useBattleTick({ battle, commands, mapApi, isRunning })`. Encapsulates AI dispatch, `simulateTick` call, projectile spawning trigger, capture-progress accounting, win-check.

**Files created.** `state/useBattleTick.ts`.

**Files modified.** `GameCanvas.tsx`: one hook call.

**Note.** Projectile-sprite spawning lives in `projectileRenderer.ts` (Phase 4e); `useBattleTick` calls that renderer with the latest projectile list. Capture-progress writes go via `useBattleState`'s setters.

**Verification.** Run a full battle. Capture progress increments at the same rate, projectiles fly and tween at the same speed, win banner appears at the same trigger.

**Risk.** Low-medium. The tick loop is already well-bounded; main concern is making sure the `tickCounterRef` monotonic invariant (see `CLAUDE.md`) is preserved and not reset on tick mount/unmount cycles.

**LOC moved out:** ~160.

## Phase 8 — Extract HUD components

**Scope.** Split the ~600-line JSX block (lines ~2760–3327) into focused per-panel React components. Do the small ones first so the cleanup is incremental.

**Sub-phases (one PR each):**

**8a — Easy three.** `WinBanner.tsx`, `CaptureProgress.tsx`, `TerrainTooltip.tsx`. Each ~30–60 lines. Pure presentational, props come from `useBattleState`. Drop-in replacement.

**8b — `BattleControls.tsx`.** The START/PAUSE BATTLE button, RESET BATTLE, RETURN TO STRATEGIC, REGENERATE ECOSYSTEM. Each owns one action; props are `{ commands, battle, viewMode }`.

**8c — `DeployButtons.tsx` + `TeamToggle.tsx`.** Roster-aware Z/X/C buttons + red/blue selector. Both ~80 lines.

**8d — `GroupsPanel.tsx` + `GroupRow.tsx`.** The biggest. Currently a single 300-line block with multiple IIFEs. Extract one `GroupRow` component receiving `{ gid, group, order, commands, selection, count, engaged }`. The IIFEs (A-MARCH, F-RETREAT engagement check, etc.) become clean computed props passed to plain buttons. Each button could also be its own component but probably overkill — keep them inline inside `GroupRow`.

**8e — `Hud.tsx` shell.** Composes everything in the same order as the current layout. After this, `GameCanvas.tsx` returns `<div ref={container}/> <Hud .../>`.

**Verification per sub-phase.** Visual diff: panel sits in the same position, colors match, buttons enable/disable in the same conditions, hotkeys still wire through.

**Risk.** Low per-PR, since each panel is independently testable. The risk is doing them all in one PR (don't).

**LOC moved out:** ~600.

## Final state of `GameCanvas.tsx`

After all 8 phases, the file is roughly:

```tsx
export const GameCanvas: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);
  const battle = useBattleState();
  const commands = useOrderCommands(battle);
  const [pixi, setPixi] = useState<{ app, world, layers, textures } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const textures = await loadTextures();
      const { app, world, layers } = createPixiApp(container.current!);
      if (cancelled) return;
      setPixi({ app, world, layers, textures });
    })();
    return () => { cancelled = true; pixi?.app.destroy(); };
  }, []);

  useTerrainRender(pixi?.layers, battle.gridData, { /* opts */ });
  useDetailRender(pixi?.layers, battle.gridData, pixi?.textures);
  useUnitRender(pixi?.layers, battle, pixi?.textures);
  usePointerHandlers({ pixi, battle, commands });
  useKeyboard({ commands, battle });
  useBattleTick({ battle, commands, isRunning: battle.isBattleRunning });

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <div ref={container} />
      <Hud battle={battle} commands={commands} />
    </div>
  );
};
```

~150 lines, all wiring.

## Cross-phase verification

Standing checks for every PR:

1. **`npm run build`** — passes with no new TS errors.
2. **`npm run lint`** — baseline maintained (no new errors; warnings may move).
3. **`npx tsx scripts/sim-formations.ts`** — all scenarios pass with identical numbers.
4. **Browser smoke** (`npm run dev`):
   - Strategic overview generates an island, click-to-dive into tactical works.
   - Deploy cohort, drag to set heading + formation, press A to march.
   - Engage an enemy: melee damage applies, units tween smoothly.
   - Toss a javelin (skirmisher at range): projectile sprite tweens to target.
   - Push to capture zone: gold flower visible, flag sprite at centre, capture-progress strip increments.
   - Win the battle: WIN banner appears, auto-clears.
   - Press RESET BATTLE / RETURN / REGENERATE: each resets the expected scope.

5. **Diff size**: each PR should remove more lines from `GameCanvas.tsx` than it adds across the new files (after Phase 1 sets up imports). If a PR grows the file, something went wrong.

## Out of scope

- Adding state-management libraries (Zustand, Redux). The `useBattleState` hook is enough.
- Splitting the battle simulator (`src/battle/*.ts`) — already cleanly separated.
- Test coverage. Worth adding unit tests for `useOrderCommands` and `worldGen` opportunistically as they're extracted, but not a blocker.
- Type-narrowing the renderer parameter objects beyond what's needed for correctness. Premature.
- Replacing PIXI with another renderer.
- Migrating to a different React state pattern (signals, immer, etc.).

## Suggested execution order

1. Phase 1 first (foundation imports).
2. Phase 3 (assets) next — it's bigger than Phase 2 but unblocks Phase 4 sub-phases.
3. Phase 2 (worldGen) in parallel with Phase 3 if multiple PRs in flight.
4. Phase 4 (4a → 4b → 4c → 4d → 4e in order).
5. Phase 5 (input).
6. Phase 6 (state).
7. Phase 7 (tick).
8. Phase 8 (HUD: 8a → 8b → 8c → 8d → 8e).

If at any point a phase's PR review surfaces a missing seam or naming issue, fix it in the next phase rather than re-doing earlier work — the file tree is meant to be revisable.
