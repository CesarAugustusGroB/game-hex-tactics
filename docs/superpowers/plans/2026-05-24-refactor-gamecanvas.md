# GameCanvas split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/components/GameCanvas.tsx` (currently 3428 lines) into a folder of focused modules under `src/canvas/`, leaving GameCanvas as a ~150-line composition root. Behavior must not change.

**Architecture:** Bottom-up extraction in 8 phases, ordered from lowest-risk (pure module-level data) to highest-risk (PIXI bootstrap + battle tick). Each phase produces a working build, lint-clean code, a passing `npm run sim`, and an unchanged browser experience. Each phase ends with a commit.

**Tech Stack:** React 19 + PIXI v8 + TypeScript (strict) + Vite + ESLint flat config. No test runner is configured — verification is `npm run build && npm run lint && npm run sim` plus a manual browser smoke test per CLAUDE.md.

**Adaptation from skill defaults:** The writing-plans skill assumes TDD. This is a behavior-preserving refactor with no test runner, so each task verifies via the build/lint/sim trio + a documented manual smoke test, not new tests. Adding tests is out of scope (it's recommendation P0.2 in `ARCHITECTURAL_REVIEW.md` — separate plan).

---

## File structure (target)

After Phase 8, the canvas layer looks like:

```
src/
  components/
    GameCanvas.tsx          ~150 lines: composition root only
  canvas/
    constants.ts            tick/zoom/threshold constants, formation cycle, capture/deploy config
    terrain-defs.ts         TERRAINS map + TerrainDef interface
    detail-rules.ts         DETAIL_RULES + sprite key helpers + asset path resolver
    water-filter.ts         createWaterFilter + WATER_FILTER_CONFIGS + GLSL strings
    world-gen.ts            generateWorldData() — pure function
    HUD.tsx                 the React HUD panel + props
    PixiApp.ts              usePixiApp() — mount-only PIXI Application + texture loading + DOM event wiring
    useBattleTick.ts        ticker hook driving simulateTick
    render/
      drawTerrain.ts        drawMap() body — pure render fn over a context object
      drawDetails.ts        drawDetails() body
      drawUnits.ts          drawUnits() body
      drawPreviews.ts       order/defend/capture preview render fns (if separable)
    input/
      useOrderDrag.ts       pointer-drag → OrderDrag → issueOrder
      useDefendGesture.ts   defend-mode gesture handling
      useKeyboard.ts        mode toggles + marchForward + selection keys
```

Splits by responsibility (data, render, input, lifecycle, UI), not technical layer. Files that change together stay together (e.g., `terrain-defs.ts` and `detail-rules.ts` are separate because adding a biome touches one, adding a sprite touches the other).

---

## Verification recipe (used by every phase)

```bash
npm run build      # tsc -b + vite build — type check must pass
npm run lint       # eslint flat config — must be clean
npm run sim        # tsx scripts/sim-formations.ts — all 21 scenarios print same output as before
```

Browser smoke test (5 minutes):
1. `npm run dev -- --port 5174` (the parent worktree may own 5173).
2. Click `🎯 INITIATE TACTICAL DIVE` on any land hex → tactical view loads.
3. Deploy a cohort of each unit type (Z/X/C) for the red team into the deploy zone.
4. Switch to blue (`<`), deploy mirror cohorts.
5. Issue: an ATTACK-drag (`A`), a DEFEND gesture (`D`), MARCH (`M`).
6. Press `SPACE` to start the battle. Units should move, fight, projectiles fly for skirmishers, HP bars drain.
7. Press `R` to return to strategic. World re-renders unchanged.

Any divergence from this script blocks the phase commit — debug before moving on.

---

## Task 1 — Phase 1: Carve module-level data out of GameCanvas.tsx

**Files:**
- Create: `src/canvas/constants.ts`
- Create: `src/canvas/terrain-defs.ts`
- Create: `src/canvas/detail-rules.ts`
- Create: `src/canvas/water-filter.ts`
- Modify: `src/components/GameCanvas.tsx:1-497` (remove extracted blocks, add imports)

These are module-level (declared above `export const GameCanvas`) and have **no React or PIXI ref dependency**. They're the lowest-risk extraction: pure data + pure helpers. Doing them first reduces the file by ~500 lines and clarifies the surface area for everything that follows.

- [ ] **Step 1.1: Create `src/canvas/constants.ts`**

Move these symbols from `GameCanvas.tsx` (lines roughly 11–112) into this new file and re-export them:

- `DRAG_THRESHOLD_PX`, `HEADING_ARROWS`, `STRATEGIC_RESOLUTION`, `DIVE_ZOOM`
- `InputMode`, `Armies`, `GroupOrders`, `GroupFormations`, `GroupDepths`, `Roster`, `Rosters` (the local type aliases)
- `INITIAL_ROSTER`, `COHORT_SIZE`, `RETREAT_REFUND_FRAC`, `CAPTURE_TICKS_TO_WIN`, `CAPTURE_CENTER`, `captureZoneKeys`, `CAPTURE_ZONE_HEXES`, `makeInitialRosters`
- `FORMATION_CYCLE`, `FORMATION_LABELS`
- `TEAM_TINTS`
- `DAMAGE_PER_TICK`, `TICK_MS`, `LOD_THRESHOLD`
- `groupOrderKey`
- `DEPLOY_ZONE_FRAC`, `deployZoneFor`

Don't move `OrderDrag` here — it belongs with input (Phase 6). Leave it inline for now.

- [ ] **Step 1.2: Create `src/canvas/terrain-defs.ts`**

Move `TerrainDef` interface (line 36) and `TERRAINS` (line 485) into this file. Export both.

- [ ] **Step 1.3: Create `src/canvas/detail-rules.ts`**

Move these from `GameCanvas.tsx` (lines ~148–391):

- `numKeys` plus all `*_KEYS` arrays (`GRASS_KEYS`, `FLOWER_KEYS`, …)
- `FOREST_DETAIL_KEYS`, `RIVER_DETAIL_KEYS`, `SEA_DETAIL_KEYS`, `ALL_DETAIL_KEYS`
- `detailAssetPath`
- `WeightedSprite`, `DetailLayerConfig`, `CategoryStyle`, `TerrainDetailRules`, `DetailCategory` interfaces/types
- `DETAIL_RULES`
- `spriteCategory`, `pickWeighted`, `seededRandom`, `getHexSeed`
- `GRASS_CHUNK_SIZE`, `GrassPatch`, `grassChunkPatch`

- [ ] **Step 1.4: Create `src/canvas/water-filter.ts`**

Move `WaterFilterConfig`, `WaterFilterHandle`, `WATER_FILTER_CONFIGS`, `WATER_FILTER_VERTEX`, `WATER_FILTER_FRAGMENT`, `createWaterFilter` (lines ~391–468). Export all.

- [ ] **Step 1.5: Wire imports into `GameCanvas.tsx`**

Delete the extracted blocks. Add at the top:

```ts
import {
  DRAG_THRESHOLD_PX, HEADING_ARROWS, STRATEGIC_RESOLUTION, DIVE_ZOOM,
  InputMode, Armies, GroupOrders, GroupFormations, GroupDepths, Roster, Rosters,
  INITIAL_ROSTER, COHORT_SIZE, RETREAT_REFUND_FRAC,
  CAPTURE_TICKS_TO_WIN, CAPTURE_CENTER, CAPTURE_ZONE_HEXES, makeInitialRosters,
  FORMATION_CYCLE, FORMATION_LABELS, TEAM_TINTS,
  DAMAGE_PER_TICK, TICK_MS, LOD_THRESHOLD,
  groupOrderKey, DEPLOY_ZONE_FRAC, deployZoneFor,
} from '../canvas/constants';
import { TerrainDef, TERRAINS } from '../canvas/terrain-defs';
import {
  ALL_DETAIL_KEYS, DETAIL_RULES, detailAssetPath,
  spriteCategory, pickWeighted, seededRandom, getHexSeed,
  GRASS_CHUNK_SIZE, GrassPatch, grassChunkPatch,
  /* plus any other helpers grep shows GameCanvas still uses */
} from '../canvas/detail-rules';
import {
  WaterFilterHandle, WATER_FILTER_CONFIGS, createWaterFilter,
} from '../canvas/water-filter';
```

(Only import what's still referenced. Run the build to find unused imports.)

- [ ] **Step 1.6: Verify**

```bash
npm run build && npm run lint && npm run sim
```

Build must pass with no new type errors. Lint must be clean. Sim must print identical output to before.

Then run the browser smoke test (5 minutes, full script above).

- [ ] **Step 1.7: Commit**

```bash
git add src/canvas/constants.ts src/canvas/terrain-defs.ts src/canvas/detail-rules.ts src/canvas/water-filter.ts src/components/GameCanvas.tsx
git commit -m "Phase 1/8: extract canvas constants, terrain defs, detail rules, water filter"
```

---

## Task 2 — Phase 2: Extract HUD into `<HUD />`

**Files:**
- Create: `src/canvas/HUD.tsx`
- Modify: `src/components/GameCanvas.tsx:2861-end` (replace JSX body with `<HUD {...props} />`)

The JSX `return (…)` block at the end of GameCanvas (~570 lines) is pure React. It depends on state values and setters, not on PIXI refs. Extracting it now cleanly separates UI from canvas lifecycle and is the second-lowest-risk phase.

- [ ] **Step 2.1: Inventory what the HUD reads/writes**

Read `GameCanvas.tsx` from line 2861 to the closing `)`. List every state read (`viewMode`, `isScanning`, `selectedTeam`, `selectedGroup`, `selectedUnitType`, `rosters`, `groupOrders`, `groupFormations`, `groupDepths`, `inputMode`, `captureProgress`, `winBanner`, `isBattleRunning`, `armies`, `currentStrategicHex`, `hoveredHex`, `gridData`, `showGrid`, plus any others) and every setter / callback the HUD invokes (e.g. `setIsScanning`, `setSelectedTeam`, `toggleMode`, `marchForward`, `setShowGrid`, `regenerateWorld`, `returnToStrategic`).

These become the `HUDProps` interface.

- [ ] **Step 2.2: Create `src/canvas/HUD.tsx`**

```tsx
import React from 'react';
import type { InputMode, Armies, GroupOrders, GroupFormations, GroupDepths, Rosters } from './constants';
import type { Hex } from '../hex-engine/HexUtils';
import type { OrderMode } from '../battle/simulate';
import type { Team, GroupId, UnitType } from '../battle/simulate'; // adjust to actual types
import { CAPTURE_TICKS_TO_WIN, FORMATION_LABELS } from './constants';
import { TerrainDef } from './terrain-defs';

export interface HUDProps {
  // refs
  containerRef: React.RefObject<HTMLDivElement>;
  // view state
  viewMode: 'STRATEGIC' | 'TACTICAL';
  isScanning: boolean;
  showGrid: boolean;
  inputMode: InputMode | null;
  winBanner: 'red' | 'blue' | null;
  // battle state
  isBattleRunning: boolean;
  captureProgress: Record<'red' | 'blue', number>;
  currentStrategicHex: Hex | null;
  armies: Armies;
  groupOrders: GroupOrders;
  groupFormations: GroupFormations;
  groupDepths: GroupDepths;
  rosters: Rosters;
  // selection
  selectedTeam: 'red' | 'blue';
  selectedGroup: GroupId;
  selectedUnitType: UnitType;
  // hover
  hoveredHex: Hex | null;
  curT: TerrainDef | null;
  // setters / actions
  setIsScanning: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedTeam: React.Dispatch<React.SetStateAction<'red' | 'blue'>>;
  setSelectedGroup: React.Dispatch<React.SetStateAction<GroupId>>;
  setSelectedUnitType: React.Dispatch<React.SetStateAction<UnitType>>;
  setInputMode: React.Dispatch<React.SetStateAction<InputMode | null>>;
  toggleMode: (mode: Exclude<OrderMode, 'march'>) => void;
  marchForward: () => void;
  startBattle: () => void;
  stopBattle: () => void;
  resetBattle: () => void;
  regenerateWorld: () => void;
  returnToStrategic: () => void;
  // ...any others discovered in step 2.1
}

export const HUD: React.FC<HUDProps> = (props) => {
  // Paste the entire JSX body from GameCanvas.tsx:2861-end.
  // Replace every reference to a state symbol or setter with `props.<name>`.
  // Replace inline closures like `() => setIsScanning(...)` with `props.setIsScanning(...)`.
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#02040a', position: 'relative' }}>
      <div ref={props.containerRef} style={{ width: '100%', height: '100%', position: 'absolute', zIndex: 1, cursor: (props.isScanning || props.inputMode !== null) ? 'crosshair' : 'default' }} />
      {/* …rest of the JSX, with prop references… */}
    </div>
  );
};
```

The mechanical work: paste the JSX, then go line-by-line replacing identifiers. TypeScript will surface anything missed.

- [ ] **Step 2.3: Replace the JSX return in `GameCanvas.tsx`**

```tsx
return (
  <HUD
    containerRef={containerRef}
    viewMode={viewMode}
    isScanning={isScanning}
    showGrid={showGrid}
    inputMode={inputMode}
    winBanner={winBanner}
    isBattleRunning={isBattleRunning}
    captureProgress={captureProgress}
    currentStrategicHex={currentStrategicHex}
    armies={armies}
    groupOrders={groupOrders}
    groupFormations={groupFormations}
    groupDepths={groupDepths}
    rosters={rosters}
    selectedTeam={selectedTeam}
    selectedGroup={selectedGroup}
    selectedUnitType={selectedUnitType}
    hoveredHex={hoveredHex}
    curT={curT}
    setIsScanning={setIsScanning}
    setShowGrid={setShowGrid}
    setSelectedTeam={setSelectedTeam}
    setSelectedGroup={setSelectedGroup}
    setSelectedUnitType={setSelectedUnitType}
    setInputMode={setInputMode}
    toggleMode={toggleMode}
    marchForward={marchForward}
    startBattle={startBattle}
    stopBattle={stopBattle}
    resetBattle={resetBattle}
    regenerateWorld={regenerateWorld}
    returnToStrategic={returnToStrategic}
  />
);
```

Add `import { HUD } from '../canvas/HUD';` at the top.

- [ ] **Step 2.4: Verify**

Run the verification recipe (`build && lint && sim` + browser smoke test). Pay particular attention in the browser to:
- HUD layout is pixel-identical (compare to a screenshot taken before Phase 2 if you want certainty).
- Every button still triggers its action: tactical dive, deploy buttons, mode toggles, MARCH, SPACE/play, R/return, regenerate.
- The capture progress strip and win banner still appear correctly.

- [ ] **Step 2.5: Commit**

```bash
git add src/canvas/HUD.tsx src/components/GameCanvas.tsx
git commit -m "Phase 2/8: extract HUD into src/canvas/HUD.tsx"
```

---

## Task 3 — Phase 3: Extract world generation

**Files:**
- Create: `src/canvas/world-gen.ts`
- Modify: `src/components/GameCanvas.tsx:620-732` (replace `generateWorldData` body with a wrapped call)

`generateWorldData` is already structured as a `useCallback` over `(genSettings, gridRadius, viewMode)`. The body is pure logic (noise sampling, cohesion pass, river pass) that produces `gridData`. Making it a pure exported function reduces the component and aligns with the same pattern the battle sim uses.

- [ ] **Step 3.1: Create `src/canvas/world-gen.ts`**

```ts
import { createNoise2D } from 'simplex-noise';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { TERRAINS } from './terrain-defs';

export interface GenSettings {
  waterLevel: number;
  mountainLevel: number;
  resolution: number;
  noiseOffset: { q: number; r: number };
  worldSeed: number;
  // …any other fields read in lines 620-732
}

export interface WorldGenInput {
  settings: GenSettings;
  gridRadius: number;
  viewMode: 'STRATEGIC' | 'TACTICAL';
  noise: ReturnType<typeof createNoise2D>;
}

export interface WorldGenOutput {
  gridData: { hex: Hex; type: string }[];
}

export function generateWorldData(input: WorldGenInput): WorldGenOutput {
  // Paste the body of generateWorldData (GameCanvas.tsx:620-732).
  // Replace any closure reference to `noiseRef.current!` with `input.noise`.
  // Replace `genSettings` with `input.settings`, `gridRadius` with `input.gridRadius`, etc.
  // Return { gridData } instead of calling setGridData.
  // ...
  return { gridData: [] }; // placeholder — actual logic copied from the original
}
```

The function must NOT touch React state. It receives inputs and returns outputs only.

- [ ] **Step 3.2: Update `GameCanvas.tsx`**

Replace the `useCallback` body with a thin wrapper:

```ts
const generateWorldDataCb = useCallback(() => {
  if (!noiseRef.current) return;
  const { gridData } = generateWorldData({
    settings: genSettings,
    gridRadius,
    viewMode,
    noise: noiseRef.current,
  });
  setGridData(gridData);
}, [genSettings, gridRadius, viewMode]);
```

Add `import { generateWorldData } from '../canvas/world-gen';` at the top. Update the existing `useEffect(() => { generateWorldData(); }, [generateWorldData])` to call `generateWorldDataCb` (rename consistently).

- [ ] **Step 3.3: Verify**

Build, lint, sim, browser smoke test. Specifically verify:
- World regenerates on `R` and looks the same (same seed → same map).
- Tactical dive on any hex still produces detailed terrain at that location.

- [ ] **Step 3.4: Commit**

```bash
git add src/canvas/world-gen.ts src/components/GameCanvas.tsx
git commit -m "Phase 3/8: extract generateWorldData into pure module"
```

---

## Task 4 — Phase 4: Extract terrain + details rendering

**Files:**
- Create: `src/canvas/render/drawTerrain.ts`
- Create: `src/canvas/render/drawDetails.ts`
- Modify: `src/components/GameCanvas.tsx:734-1461` (replace `drawMap` and `drawDetails` bodies with wrapped calls)

`drawMap` is the largest single function (~650 lines, the two-pass terrain pipeline). It needs many texture refs (~40) and several Graphics refs. The trick is passing a single **context object** so the call site stays clean.

- [ ] **Step 4.1: Define the terrain-render context shape**

In `src/canvas/render/drawTerrain.ts`:

```ts
import * as PIXI from 'pixi.js';
import type { Hex } from '../../hex-engine/HexUtils';
import type { WaterFilterHandle } from '../water-filter';

export interface TerrainRenderContext {
  // graphics targets
  terrainGfx: PIXI.Graphics;
  terrainOverlay: PIXI.Container;
  gridGfx: PIXI.Graphics;
  deployZoneGfx: PIXI.Graphics;
  captureZoneGfx: PIXI.Graphics;
  highlightGfx: PIXI.Graphics;
  // textures (all may be null during load — caller guarantees they're loaded)
  grassTex: PIXI.Texture;
  grassNoiseTex: PIXI.Texture;
  grassMacroNoiseTex: PIXI.Texture;
  grassPatchDryTex: PIXI.Texture;
  grassPatchDenseTex: PIXI.Texture;
  grassFlowerSpeckTex: PIXI.Texture;
  forestTex: PIXI.Texture;
  forestMacroVariationTex: PIXI.Texture;
  forestDensePatchTex: PIXI.Texture;
  forestMossPatchTex: PIXI.Texture;
  riverTex: PIXI.Texture;
  riverFlowVariationTex: PIXI.Texture;
  riverDepthPatchTex: PIXI.Texture;
  riverEdgeSoftnessTex: PIXI.Texture;
  riverShimmerHighlightTex: PIXI.Texture;
  hillTex: PIXI.Texture;
  hillMacroNoiseTex: PIXI.Texture;
  hillPatchDryTex: PIXI.Texture;
  hillPatchDenseTex: PIXI.Texture;
  mountainTex: PIXI.Texture;
  snowTex: PIXI.Texture;
  sandTex: PIXI.Texture;
  seaTex: PIXI.Texture;
  seaMacroNoiseTex: PIXI.Texture;
  seaShallowPatchTex: PIXI.Texture;
  seaDepthPatchTex: PIXI.Texture;
  seaMicroNoiseTex: PIXI.Texture;
  deepSeaTex: PIXI.Texture;
  // filter handles for animated water
  waterFilters: WaterFilterHandle[];
  // data
  gridData: { hex: Hex; type: string }[];
  // view state
  showGrid: boolean;
  viewMode: 'STRATEGIC' | 'TACTICAL';
}

export function drawTerrain(ctx: TerrainRenderContext): void {
  // Paste the body of drawMap (GameCanvas.tsx:734-1386).
  // Replace `terrainGfx.current` with `ctx.terrainGfx`, etc.
  // Replace `grassTextureRef.current!` with `ctx.grassTex`, etc.
  // Replace `gridData` with `ctx.gridData`.
  // Internal helper closures stay inside this function.
}
```

- [ ] **Step 4.2: Same shape for `drawDetails`**

In `src/canvas/render/drawDetails.ts`:

```ts
import * as PIXI from 'pixi.js';
import type { Hex } from '../../hex-engine/HexUtils';

export interface DetailRenderContext {
  detailsGfx: PIXI.Container;
  detailTextures: Map<string, PIXI.Texture>;
  gridData: { hex: Hex; type: string }[];
  detailDensityNoise: ReturnType<typeof import('simplex-noise').createNoise2D>;
}

export function drawDetails(ctx: DetailRenderContext): void {
  // Paste the body of drawDetails (GameCanvas.tsx:1390-1459).
  // Same mechanical replacement as drawTerrain.
}
```

- [ ] **Step 4.3: Replace the original callbacks in `GameCanvas.tsx`**

```ts
const drawMap = useCallback(() => {
  if (!terrainTexturesLoaded || !grassTextureRef.current /* etc */) return;
  drawTerrain({
    terrainGfx: terrainGfx.current,
    terrainOverlay: terrainOverlayRef.current,
    gridGfx: gridGfx.current,
    deployZoneGfx: deployZoneGfx.current,
    captureZoneGfx: captureZoneGfx.current,
    highlightGfx: highlightGfx.current,
    grassTex: grassTextureRef.current!,
    // …all the other texture refs unwrapped…
    waterFilters: waterFilterHandlesRef.current,
    gridData,
    showGrid,
    viewMode,
  });
}, [gridData, showGrid, terrainTexturesLoaded, viewMode]);

const drawDetailsCb = useCallback(() => {
  if (!detailDensityNoiseRef.current) return;
  drawDetails({
    detailsGfx: detailsGfx.current,
    detailTextures: detailTexturesRef.current,
    gridData,
    detailDensityNoise: detailDensityNoiseRef.current,
  });
}, [gridData]);
```

Update both `useEffect`s that call them to use the wrapped names.

- [ ] **Step 4.4: Verify**

Build / lint / sim. Browser test must check:
- Strategic map renders with correct colors per biome.
- Tactical dive renders all texture overlays (grass, forest, hill cliffs, river flow, sea shimmer).
- Grid overlay toggles with `G`.
- Deploy zone shading appears on the selected team's side.
- Capture zone gold outline appears at center.
- Highlight on hover still follows mouse.

This is the highest-risk visual phase. **Take a screenshot before extracting and compare after.** Any visible regression (missing cliff, wrong tint, lost overlay) means the extraction missed a ref or wrong-cased a variable.

- [ ] **Step 4.5: Commit**

```bash
git add src/canvas/render/drawTerrain.ts src/canvas/render/drawDetails.ts src/components/GameCanvas.tsx
git commit -m "Phase 4/8: extract terrain and details rendering"
```

---

## Task 5 — Phase 5: Extract units + previews rendering

**Files:**
- Create: `src/canvas/render/drawUnits.ts`
- Create: `src/canvas/render/drawPreviews.ts` (only if `renderOrderPreview` / `renderDefendPreview` exist as separable functions — if they're inlined inside `drawUnits` or input handlers, leave them and add a note)
- Modify: `src/components/GameCanvas.tsx:1463-1731`

`drawUnits` is the per-tick render of every unit (HP bars, sprites, badges, attack target rings). The biggest fix opportunity here is the O(N × gridSize) `gridData.find(...)` lookup at the top of the function (review's F5 finding), but **don't fix it in this phase** — it's a separate optimization, deserves its own commit, and changing behavior + extracting in one phase makes regressions hard to diagnose.

- [ ] **Step 5.1: Define units-render context**

In `src/canvas/render/drawUnits.ts`:

```ts
import * as PIXI from 'pixi.js';
import type { Hex } from '../../hex-engine/HexUtils';
import type { Armies, GroupOrders } from '../constants';
import type { Team } from '../../battle/simulate';

export interface UnitsRenderContext {
  unitsGfx: PIXI.Container;
  unitContainers: Map<string, PIXI.Container>;
  // textures per (team, unit type)
  unitTextureRed: PIXI.Texture;
  unitTextureBlue: PIXI.Texture;
  unitTextureRedCavalry: PIXI.Texture;
  unitTextureBlueCavalry: PIXI.Texture;
  unitTextureRedSkirmisher: PIXI.Texture;
  unitTextureBlueSkirmisher: PIXI.Texture;
  armyTexture: PIXI.Texture; // strategic view
  // data
  armies: Armies;
  groupOrders: GroupOrders;
  gridData: { hex: Hex; type: string }[];
  currentStrategicHex: Hex | null;
  viewMode: 'STRATEGIC' | 'TACTICAL';
  selectedTeam: Team;
  fogOfWar: boolean;
}

export function drawUnits(ctx: UnitsRenderContext): void {
  // Paste the body of drawUnits (GameCanvas.tsx:1463-1731).
  // Replace ref accesses with ctx fields.
  // Keep the gridData.find(...) pattern as-is (F5 is a separate task).
}
```

- [ ] **Step 5.2: Audit for separable preview render fns**

Search GameCanvas for `renderOrderPreview` and `renderDefendPreview`. If they exist as standalone declarations:

```
grep -n "renderOrderPreview\|renderDefendPreview" src/components/GameCanvas.tsx
```

If yes → also create `src/canvas/render/drawPreviews.ts` with both, modeled the same way.
If they're inlined inside pointer handlers → leave them; they'll move to `src/canvas/input/` in Phase 6.

- [ ] **Step 5.3: Wrap in `GameCanvas.tsx`**

```ts
const drawUnitsCb = useCallback(() => {
  if (!unitTextureRef.current /* etc */) return;
  drawUnits({
    unitsGfx: unitsGfx.current,
    unitContainers: unitContainersRef.current,
    unitTextureRed: unitTextureRef.current!,
    unitTextureBlue: unitTextureBlueRef.current!,
    unitTextureRedCavalry: unitTextureRedCavalryRef.current!,
    unitTextureBlueCavalry: unitTextureBlueCavalryRef.current!,
    unitTextureRedSkirmisher: unitTextureRedSkirmisherRef.current!,
    unitTextureBlueSkirmisher: unitTextureBlueSkirmisherRef.current!,
    armyTexture: armyTextureRef.current!,
    armies,
    groupOrders,
    gridData,
    currentStrategicHex,
    viewMode,
    selectedTeam,
    fogOfWar,
  });
}, [armies, viewMode, gridData, currentStrategicHex, groupOrders, fogOfWar, selectedTeam]);
```

Rename the existing `useEffect(() => { drawUnits(); }, [drawUnits])` to use `drawUnitsCb`.

- [ ] **Step 5.4: Verify**

Build / lint / sim + extended browser test:
- Deploy units of all three types for both teams — sprites correct.
- HP bars over each unit visible and tinted by team.
- Group badge / lieutenant ★ + heading arrow still appear.
- Run battle — javelins fly from skirmishers, charges connect, units die and disappear.
- Strategic view shows army icons in the right hex.

- [ ] **Step 5.5: Commit**

```bash
git add src/canvas/render/drawUnits.ts src/components/GameCanvas.tsx
# (also drawPreviews.ts if created)
git commit -m "Phase 5/8: extract units rendering"
```

---

## Task 6 — Phase 6: Extract input as hooks

**Files:**
- Create: `src/canvas/input/useOrderDrag.ts`
- Create: `src/canvas/input/useDefendGesture.ts`
- Create: `src/canvas/input/useKeyboard.ts`
- Modify: `src/components/GameCanvas.tsx` (remove the input branches from the mount-only useEffect and the keyboard useEffect)

The mount-only `useEffect` at lines 1778–2376 bundles texture loading + DOM event handlers + ticker registration. **This phase only carves out the input handlers** (`pointerdown`, `pointermove`, `pointerup`, `pointertap`, `dblclick` branches that key off `inputModeRef.current`, plus the `marchForward`/`toggleMode` keyboard wiring). Texture loading and ticker stay put — they move in Phase 7.

Each input hook receives the same context object (refs + setters it needs) and registers/unregisters its own listeners.

- [ ] **Step 6.1: Define a shared `InputContext`**

In `src/canvas/input/types.ts` (small shared module):

```ts
import * as PIXI from 'pixi.js';
import type React from 'react';
import type { Hex } from '../../hex-engine/HexUtils';
import type { InputMode, Armies, GroupOrders } from '../constants';
import type { Team, GroupId, OrderMode, OrderChange } from '../../battle/simulate';

export interface InputContext {
  app: PIXI.Application;
  world: PIXI.Container;
  previewGfx: PIXI.Container;
  highlightGfx: PIXI.Graphics;
  // ref reads
  inputModeRef: React.MutableRefObject<InputMode | null>;
  selectedTeamRef: React.MutableRefObject<Team>;
  selectedGroupRef: React.MutableRefObject<GroupId>;
  selectedUnitTypeRef: React.MutableRefObject<'infantry' | 'cavalry' | 'skirmisher'>;
  armiesRef: React.MutableRefObject<Armies>;
  groupOrdersRef: React.MutableRefObject<GroupOrders>;
  gridDataRef: React.MutableRefObject<{ hex: Hex; type: string }[]>;
  currentStrategicHexRef: React.MutableRefObject<Hex | null>;
  isScanningRef: React.MutableRefObject<boolean>;
  // setters / actions
  issueOrder: (team: Team, groupId: GroupId, change: OrderChange) => void;
  clearOrder: (team: Team, groupId: GroupId) => void;
  setInputMode: React.Dispatch<React.SetStateAction<InputMode | null>>;
  toggleMode: (mode: Exclude<OrderMode, 'march'>) => void;
  marchForward: () => void;
  // …add any others discovered while extracting
}
```

- [ ] **Step 6.2: Extract `useOrderDrag`**

Audit the pointer handlers in GameCanvas (`pointerdown`/`globalpointermove`/`pointerup`/`pointertap` branches where `inputModeRef.current === 'order'`). That code becomes:

```ts
import { useEffect } from 'react';
import { InputContext } from './types';

export function useOrderDrag(ctx: InputContext, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    // Move all 'order'-mode pointer handlers here.
    // Register listeners on ctx.app.stage or ctx.world.
    // Return cleanup that unregisters them.
  }, [enabled, ctx]); // ctx is stable if you pass it once — see note below
}
```

**Stable ctx caveat:** if `ctx` is reconstructed every render, the effect re-fires every render. Pass `ctx` from a `useMemo`/`useRef` in `GameCanvas` so identity is stable. Or split: pass each ref individually (refs themselves are stable). Choose what reads cleanest after extraction.

- [ ] **Step 6.3: Extract `useDefendGesture`**

Same approach, for the `inputModeRef.current === 'defend'` branches.

- [ ] **Step 6.4: Extract `useKeyboard`**

Move the entire keyboard `useEffect` (`window.addEventListener('keydown', …)`, lines ~2713-2763) here. It calls `toggleMode`, `marchForward`, `setSelectedTeam`, etc. — all available via `ctx`.

- [ ] **Step 6.5: Wire hooks into `GameCanvas`**

```ts
const inputCtx = useMemo<InputContext>(() => ({
  app: appRef.current!, world: worldRef.current, previewGfx: previewGfx.current, highlightGfx: highlightGfx.current,
  inputModeRef, selectedTeamRef, selectedGroupRef, selectedUnitTypeRef,
  armiesRef, groupOrdersRef, gridDataRef, currentStrategicHexRef, isScanningRef,
  issueOrder, clearOrder, setInputMode, toggleMode, marchForward,
}), [issueOrder, clearOrder, toggleMode, marchForward]);

useOrderDrag(inputCtx, viewMode === 'TACTICAL');
useDefendGesture(inputCtx, viewMode === 'TACTICAL');
useKeyboard(inputCtx);
```

Remove the corresponding handler-registration code from the mount-only `useEffect`.

- [ ] **Step 6.6: Verify**

Build / lint / sim + thorough input test:
- Click DIVE → tactical works.
- Press `A` → order mode active → drag from a group to a target hex → preview shows during drag → release commits the attack-target order with correct rank slots.
- Press `D` → defend mode → click a height hex → defend formation issued.
- Press `M` → march forward issues march to all selected-team groups.
- Press `R` → return to strategic.
- `<`/`>` swap teams.
- `Z`/`X`/`C` change unit type for deploy.
- `G` toggles grid.
- SPACE starts/pauses battle.

This is the second-highest-risk phase (input is invisible until it breaks). Test every key.

- [ ] **Step 6.7: Commit**

```bash
git add src/canvas/input/ src/components/GameCanvas.tsx
git commit -m "Phase 6/8: extract input handlers into hooks"
```

---

## Task 7 — Phase 7: Extract PIXI bootstrap + battle tick

**Files:**
- Create: `src/canvas/PixiApp.ts` (or `usePixiApp.ts` — same content, hook naming reflects React usage)
- Create: `src/canvas/useBattleTick.ts`
- Modify: `src/components/GameCanvas.tsx` (replace remaining bodies of the two big useEffects)

What's left in the mount-only `useEffect` after Phase 6: PIXI Application creation + texture loading + Graphics ref attachment to world container + ticker registration + DOM zoom/pan handlers. That becomes `usePixiApp`. The battle-tick `useEffect` (lines 2388-2550) becomes `useBattleTick`.

- [ ] **Step 7.1: Define what `usePixiApp` returns**

```ts
import * as PIXI from 'pixi.js';
import { useEffect, useRef } from 'react';

export interface PixiAppRefs {
  app: React.RefObject<PIXI.Application | null>;
  world: React.RefObject<PIXI.Container>;
  terrainGfx: React.RefObject<PIXI.Graphics>;
  terrainOverlay: React.RefObject<PIXI.Container>;
  detailsGfx: React.RefObject<PIXI.Container>;
  gridGfx: React.RefObject<PIXI.Graphics>;
  deployZoneGfx: React.RefObject<PIXI.Graphics>;
  captureZoneGfx: React.RefObject<PIXI.Graphics>;
  highlightGfx: React.RefObject<PIXI.Graphics>;
  unitsGfx: React.RefObject<PIXI.Container>;
  projectilesGfx: React.RefObject<PIXI.Container>;
  previewGfx: React.RefObject<PIXI.Container>;
  // textures (all start null, populated after load)
  textures: PixiAppTextures;
  // signal: true once texturesLoaded
  texturesLoaded: boolean;
}

export interface PixiAppTextures {
  armyTex: React.RefObject<PIXI.Texture | null>;
  unitTexRed: React.RefObject<PIXI.Texture | null>;
  // …all the rest, one ref per texture
}

export function usePixiApp(containerRef: React.RefObject<HTMLDivElement>) {
  // Body = everything in the mount-only useEffect except input handlers (which moved in Phase 6).
  // 1. Create PIXI.Application, init, append to container.
  // 2. Build the world Container hierarchy in correct z-order.
  // 3. Load all textures (Promise.all of PIXI.Assets.load(...)).
  // 4. Configure scaleMode / mipmaps / addressMode.
  // 5. Build water filter handles via createWaterFilter.
  // 6. Wire ticker to a callback that calls drawHighlight + animates water filters.
  // 7. Wire DOM-level zoom (wheel) + pan (pointer + globalpointermove) handlers on container.
  // 8. Return refs (and a setter / signal for texturesLoaded).
  // 9. Cleanup: destroy app + unbind listeners.
  return { /* refs and texturesLoaded */ };
}
```

This is the largest single extraction — likely 400+ lines. Test it isolated by deleting the body of the original useEffect in `GameCanvas` and calling `usePixiApp(containerRef)`. The hook returns refs that the render-fn callers (Phase 4/5 wrappers) then read.

- [ ] **Step 7.2: Refactor `GameCanvas` to use the returned refs**

Instead of declaring `terrainGfx`, `terrainOverlayRef`, every texture ref locally, do:

```ts
const pixi = usePixiApp(containerRef);
// pixi.app, pixi.world, pixi.terrainGfx, …, pixi.textures.unitTexRed
```

Update all references in the wrapped draw-call sites (Phase 4/5) and the input context (Phase 6) to point at `pixi.xxx` instead of the local ref names. Compiler will tell you what you missed.

- [ ] **Step 7.3: Extract `useBattleTick`**

```ts
import { useEffect } from 'react';
import { simulateTick } from '../battle/simulate';

export interface BattleTickContext {
  // ...refs to armiesRef, groupOrdersRef, projectilesGfx, etc.
  // setters: setArmies, setGroupOrders, setCaptureProgress, setWinBanner, setIsBattleRunning, setRosters
  // config: tickMs
}

export function useBattleTick(ctx: BattleTickContext, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    intervalId = setInterval(() => {
      // Body of the existing battle-tick useEffect (lines ~2388-2550):
      // 1. Read armies + orders from refs.
      // 2. Call simulateTick(units, orders, { currentTick: ctx.tickCounterRef.current++ }).
      // 3. Detect deaths → spawn projectile animations on projectilesGfx.
      // 4. Update capture progress, detect win, set winBanner.
      // 5. setArmies(newUnits), setGroupOrders(newOrders), etc.
    }, ctx.tickMs);
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [enabled, ctx]);
}
```

**Critical:** the `tickCounterRef.current` must NOT reset when this hook re-mounts mid-game — the invariant in CLAUDE.md ("Never reset it when a battle starts") still applies. Keep the ref in `GameCanvas` and pass it via ctx, do not allocate it inside the hook.

Replace the original useEffect with `useBattleTick(battleCtx, isBattleRunning)`.

- [ ] **Step 7.4: Verify**

Build / lint / sim + complete browser test (this phase touches the most). Critical checks:
- App mounts and shows strategic world.
- Textures load (no missing-texture pink squares).
- Pan/zoom still works (wheel + drag).
- Tactical dive transitions correctly.
- Start a battle → ticks advance, units move on cooldown, combat resolves, projectiles render, win banner appears when CAPTURE_TICKS_TO_WIN reached.
- Pause/resume battle works.
- Return to strategic → tick counter NOT reset (no army stuck on cooldown).
- Regenerate world → tick counter reset, full reset.

If anything in this list fails, the bug is almost certainly a missed ref unwrap or a stale closure — bisect by reverting individual replacements within this phase.

- [ ] **Step 7.5: Commit**

```bash
git add src/canvas/PixiApp.ts src/canvas/useBattleTick.ts src/components/GameCanvas.tsx
git commit -m "Phase 7/8: extract PIXI bootstrap and battle tick into hooks"
```

---

## Task 8 — Phase 8: Final composition + cleanup

**Files:**
- Modify: `src/components/GameCanvas.tsx` (final cleanup pass)
- Modify: `CLAUDE.md` (update Architecture section to describe new structure)
- Optional: `LEARNINGS.md` (append any gotchas surfaced during the refactor)

After Phase 7, `GameCanvas.tsx` should be ~150–250 lines. This phase is the cleanup pass: remove dead code, unused imports, redundant ref-sync `useEffect`s that exist only because handlers used to close over them (some refs may no longer be needed if their data flows through props/context now), inline any remaining one-line callbacks, and verify the file reads as a clean composition root.

- [ ] **Step 8.1: Audit dead code in `GameCanvas.tsx`**

```bash
npm run lint   # surfaces unused vars / imports
```

Remove every unused import, ref, state setter, helper function. Most of the ref-sync `useEffect`s (lines 2556-2591, ~30 lines of `useEffect(() => { fooRef.current = foo; }, [foo])`) may still be needed for input hooks that read via ref — keep only those still referenced; delete the rest.

- [ ] **Step 8.2: Verify GameCanvas reads as a composition root**

The final shape should look approximately:

```tsx
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { simulateTick, type /* … */ } from '../battle/simulate';

import { TICK_MS, /* … */ } from '../canvas/constants';
import { HUD } from '../canvas/HUD';
import { usePixiApp } from '../canvas/PixiApp';
import { useBattleTick } from '../canvas/useBattleTick';
import { useOrderDrag, useDefendGesture, useKeyboard } from '../canvas/input';
import { drawTerrain } from '../canvas/render/drawTerrain';
import { drawDetails } from '../canvas/render/drawDetails';
import { drawUnits } from '../canvas/render/drawUnits';
import { generateWorldData } from '../canvas/world-gen';

export const GameCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixi = usePixiApp(containerRef);

  // top-level React state (the things the HUD reads + setters)
  const [viewMode, setViewMode] = useState<'STRATEGIC' | 'TACTICAL'>('STRATEGIC');
  const [armies, setArmies] = useState<Armies>(new Map());
  const [groupOrders, setGroupOrders] = useState<GroupOrders>(new Map());
  // …others…

  // wrap pure render fns in callbacks with the right effects to redraw on state change
  const drawTerrainCb = useCallback(() => {
    if (!pixi.texturesLoaded) return;
    drawTerrain({ /* gather context from pixi.* + state */ });
  }, [pixi.texturesLoaded, gridData, /* … */]);

  // input hooks
  const inputCtx = useMemo(() => ({ /* refs + setters */ }), [/* … */]);
  useOrderDrag(inputCtx, viewMode === 'TACTICAL');
  useDefendGesture(inputCtx, viewMode === 'TACTICAL');
  useKeyboard(inputCtx);

  // battle tick
  const battleCtx = useMemo(() => ({ /* … */ }), [/* … */]);
  useBattleTick(battleCtx, isBattleRunning);

  // redraw effects
  useEffect(() => { drawTerrainCb(); }, [drawTerrainCb]);
  useEffect(() => { drawUnitsCb(); }, [drawUnitsCb]);

  return <HUD {/* …props… */} />;
};
```

If the actual result is much longer, identify why — likely a missed extraction or a callback that should have moved into a hook.

- [ ] **Step 8.3: Update `CLAUDE.md` Architecture section**

The current Architecture section describes the old layout ("GameCanvas.tsx — the entire app"). Replace with the new map (the file structure block at the top of this plan). Update the "Rendering pipeline" section to reference `src/canvas/render/*.ts` instead of `drawMap` / `drawDetails` / `drawUnits` inside the component. Keep the "Two coordinate systems" and "Refs that mirror state" sections — they're still accurate.

- [ ] **Step 8.4: (Optional) Append to `LEARNINGS.md`**

Per CLAUDE.md's "Documentation cadence": if anything non-obvious surfaced during the refactor (e.g., a closure-over-stale-state bug; a PIXI listener that had to be deregistered explicitly; a ref that turned out to be unsafe to remove), append a short prose entry. Skip if nothing notable.

- [ ] **Step 8.5: Full final verification**

```bash
npm run build && npm run lint && npm run sim
wc -l src/components/GameCanvas.tsx src/canvas/**/*.ts src/canvas/**/*.tsx
```

Expected: GameCanvas under 250 lines. Total `src/canvas/` size should be roughly comparable to the old GameCanvas (refactor is structural, not deletion).

Final browser run-through using the full smoke test script at the top of this plan. Allocate 10 minutes — this is the last gate before merging.

- [ ] **Step 8.6: Commit**

```bash
git add src/components/GameCanvas.tsx CLAUDE.md
# also LEARNINGS.md if step 8.4 added something
git commit -m "Phase 8/8: cleanup composition root and update CLAUDE.md"
```

---

## Out of scope (explicitly)

- **F5 perf fix** (gridData as Map) — review's P0.1. Do as a separate commit after this plan lands; risk-of-mixing-with-refactor is high.
- **F4 sim assertions** — review's P0.2. Separate plan.
- **Unit-type table** — review's P1.4. Separate plan.
- **New features of any kind.** This is a behavior-preserving refactor.

If during execution you discover a real bug (not introduced by the refactor — already present in main), file it in a comment or note and keep moving. Mixing bug fixes into refactor commits hides regressions.
