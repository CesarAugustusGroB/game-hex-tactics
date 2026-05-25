# Render Hot-Path Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the per-tick / per-frame allocation and render-pass churn in the canvas layer so battle rendering stays smooth as unit count grows.

**Architecture:** Five independent optimizations across three files. Unit rendering (`drawUnits.ts`) moves from "destroy and rebuild every child every tick" to "create children once, mutate only what changed", and its blurred shadow is pre-baked to a reusable texture at boot. Pointer hover stops spamming React re-renders. Water rendering collapses up to 7 filtered containers into 2 (one render-to-texture pass per water config instead of one per layer).

**Tech Stack:** PixiJS v8.17, React 19, GSAP, TypeScript, Vite.

---

## Verification approach (read first)

**This repo has no unit-test runner** (`CLAUDE.md`: "There is no test runner configured"). These are rendering/performance refactors whose contract is *behavior preservation + fewer allocations*, not new logic. So every task is verified by:

1. **Hard gate — type + build:** `npm run build` (runs `tsc -b` then `vite build`; type errors fail the build).
2. **Hard gate — lint:** `npm run lint`.
3. **Sim regression (cheap insurance):** `npx tsx scripts/sim-formations.ts` — confirms the pure battle sim is untouched (these changes are render-only, so output must be identical to before).
4. **Visual smoke:** the dev server is already running at http://localhost:5173. Reload it, dive into a tactical hex, and confirm the scene renders with **no console errors** and the relevant visuals look unchanged (units, shadows, HP bars, lieutenant ★/→, water animation).

Where a step says "visual smoke", perform it in the browser (the user is present and can eyeball). There is no automated screenshot diff; build + lint + sim are the automated gates.

**Branch:** work happens on `feature/presentation` (current branch, clean). Commit after each task.

---

## File structure

| File | Responsibility | Tasks that touch it |
|------|----------------|---------------------|
| `src/canvas/PixiApp.ts` | PIXI lifecycle, texture load, pointer handlers, LOD ticker | 1 (hover guard), 2 (shadow bake + LOD ticker edit) |
| `src/components/GameCanvas.tsx` | Composition root: refs, ctx assembly, render callbacks | 2 (shadow ref plumbing) |
| `src/canvas/render/drawUnits.ts` | Per-unit tactical + strategic rendering | 2 (use baked shadow), 3 (persistent children + Map lookup) |
| `src/canvas/render/drawTerrain.ts` | Terrain + overlay + water rendering | 4 (water filter consolidation) |

Task order: **1 → 2 → 3 → 4**. Task 3 rewrites `drawUnits.ts` in full and absorbs the small shadow change from Task 2 into its create-once path (minor, expected overlap). Tasks 1 and 4 are fully independent of the others and could be done in any order.

---

## Task 1: Guard `setHoveredHex` so it fires only on hex change

**Problem (finding #5):** `PixiApp.ts:381` calls `ctx.setHoveredHex(hex)` on every `globalpointermove` with a fresh object, re-rendering all of `GameCanvas` + `HUD` on every pixel of mouse movement even when the cursor stays on the same hex.

**Files:**
- Modify: `src/canvas/PixiApp.ts` (declare a closure var in `start()`; guard the setter in the `globalpointermove` handler)

- [ ] **Step 1: Declare the last-hover tracker in the `start()` scope**

In `src/canvas/PixiApp.ts`, find this block (around line 318):

```typescript
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;
```

Add a tracker line immediately after it:

```typescript
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      // Last hex the pointer hovered (axial key). Used to skip redundant setHoveredHex
      // calls — without this, every sub-hex mouse move re-renders GameCanvas + HUD.
      let lastHoverKey: string | null = null;
```

- [ ] **Step 2: Guard the setter in `globalpointermove`**

Find this block (around line 373):

```typescript
      app.stage.on('globalpointermove', (e) => {
        if (ctx.isDragging.current) {
          world.x += e.global.x - ctx.lastMousePos.current.x;
          world.y += e.global.y - ctx.lastMousePos.current.y;
          ctx.lastMousePos.current = { x: e.global.x, y: e.global.y };
        }
        const local = world.toLocal(e.global);
        const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        ctx.setHoveredHex(hex);
        if (ctx.isPaintingRef.current) paintAt(hex, paintCtx);
        if (ctx.orderDragRef.current) updateOrderDrag(local.x, local.y, odCtx);
      });
```

Replace the unconditional `ctx.setHoveredHex(hex);` line so it only fires on change:

```typescript
      app.stage.on('globalpointermove', (e) => {
        if (ctx.isDragging.current) {
          world.x += e.global.x - ctx.lastMousePos.current.x;
          world.y += e.global.y - ctx.lastMousePos.current.y;
          ctx.lastMousePos.current = { x: e.global.x, y: e.global.y };
        }
        const local = world.toLocal(e.global);
        const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        const hoverKey = HexUtils.key(hex);
        if (hoverKey !== lastHoverKey) {
          lastHoverKey = hoverKey;
          ctx.setHoveredHex(hex);
        }
        if (ctx.isPaintingRef.current) paintAt(hex, paintCtx);
        if (ctx.orderDragRef.current) updateOrderDrag(local.x, local.y, odCtx);
      });
```

`HexUtils` is already imported in this file — no new import.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Visual smoke**

Reload http://localhost:5173. Move the mouse across the strategic map: the hover highlight (cyan circle in scanning mode / white hex outline otherwise) must still follow the cursor and snap hex-to-hex exactly as before, and the HUD terrain readout must update when crossing into a new hex. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/PixiApp.ts
git commit -m "perf(render): only setHoveredHex on hex change, not every pointer move"
```

---

## Task 2: Pre-bake the unit shadow to a texture (kill per-tick BlurFilter)

**Problem (finding #1):** `drawUnits.ts:50` does `shadow.filters = [new PIXI.BlurFilter(...)]` for every unit's shadow, and `drawUnits` runs every battle tick rebuilding all children — so N `BlurFilter` instances are allocated/freed per tick (GC churn) and each filtered sprite forces its own render-to-texture pass per frame.

**Fix:** bake one soft elliptical shadow to a `Texture` once at boot via `renderer.generateTexture`, store it in a ref, and draw each unit's shadow as a plain `Sprite` of that texture (no filter). Shadows become uniform soft ovals instead of per-silhouette blurs — an accepted, cleaner look.

**Files:**
- Modify: `src/canvas/PixiApp.ts` (bake texture at boot; destroy in cleanup; add ctx field)
- Modify: `src/components/GameCanvas.tsx` (declare ref; add to `pixiCtx`; pass into `drawUnits` ctx with guard)
- Modify: `src/canvas/render/drawUnits.ts` (add `shadowTexture` to context type; rewrite `addUnitSpriteWithShadow` to use it)

- [ ] **Step 1: Add the ref field to `PixiAppCtx`**

In `src/canvas/PixiApp.ts`, find the texture-ref block in the `PixiAppCtx` interface (around line 48):

```typescript
  // Texture refs (written by hook after load)
  armyTextureRef: MutableRefObject<PIXI.Texture | null>;
```

Add the shadow ref right after it:

```typescript
  // Texture refs (written by hook after load)
  armyTextureRef: MutableRefObject<PIXI.Texture | null>;
  // Soft unit shadow baked once at boot (a blurred ellipse). Reused by every unit so
  // shadows are plain Sprites, not per-frame BlurFilter passes.
  shadowTextureRef: MutableRefObject<PIXI.Texture | null>;
```

- [ ] **Step 2: Bake the shadow texture at boot**

In `src/canvas/PixiApp.ts`, find the existing eslint-disabled ref-write block (around line 224):

```typescript
      /* eslint-disable react-hooks/immutability */
      ctx.armyTextureRef.current = armyTex;
```

Insert the bake + assignment just inside that block, right before the `armyTextureRef` line:

```typescript
      /* eslint-disable react-hooks/immutability */
      // Bake a soft elliptical shadow to a texture once — every unit reuses it as a plain
      // Sprite, so shadows cost zero per-frame filter passes. The 128² frame leaves room
      // for the blur to fall off inside the texture bounds.
      const shadowG = new PIXI.Graphics().ellipse(64, 64, 46, 24).fill({ color: 0x000000 });
      shadowG.filters = [new PIXI.BlurFilter({ strength: 6 })];
      ctx.shadowTextureRef.current = app.renderer.generateTexture({
        target: shadowG,
        resolution: 2,
        frame: new PIXI.Rectangle(0, 0, 128, 128),
      });
      shadowG.destroy(true);
      ctx.armyTextureRef.current = armyTex;
```

- [ ] **Step 3: Destroy the baked texture in cleanup**

In `src/canvas/PixiApp.ts`, find the unmount cleanup (around line 500):

```typescript
      for (const child of ctx.terrainOverlayRef.current.children) {
        if ('mask' in child) (child as PIXI.Sprite).mask = null;
      }
      app.destroy(true, { children: true });
```

Destroy the baked shadow before the renderer goes away:

```typescript
      for (const child of ctx.terrainOverlayRef.current.children) {
        if ('mask' in child) (child as PIXI.Sprite).mask = null;
      }
      ctx.shadowTextureRef.current?.destroy(true);
      ctx.shadowTextureRef.current = null;
      app.destroy(true, { children: true });
```

- [ ] **Step 4: Declare the ref in `GameCanvas.tsx`**

In `src/components/GameCanvas.tsx`, find (around line 65):

```typescript
  const armyTextureRef = useRef<PIXI.Texture | null>(null);
```

Add right after it:

```typescript
  const armyTextureRef = useRef<PIXI.Texture | null>(null);
  const shadowTextureRef = useRef<PIXI.Texture | null>(null);
```

- [ ] **Step 5: Add the ref to the `pixiCtx` literal**

In `src/components/GameCanvas.tsx`, find in the `pixiCtx` object (around line 376):

```typescript
    armyTextureRef,
    unitTextureRef,
```

Add:

```typescript
    armyTextureRef,
    shadowTextureRef,
    unitTextureRef,
```

- [ ] **Step 6: Add `shadowTexture` to `UnitsRenderContext` and pass it from `drawUnits` callback**

First, in `src/canvas/render/drawUnits.ts`, find in the `UnitsRenderContext` interface (around line 26):

```typescript
  armyTexture: PIXI.Texture;
  // data
```

Add:

```typescript
  armyTexture: PIXI.Texture;
  // Soft shadow baked once at boot (PixiApp). Drawn as a plain Sprite per unit.
  shadowTexture: PIXI.Texture;
  // data
```

Then, in `src/components/GameCanvas.tsx`, find the `drawUnits` callback (around line 212):

```typescript
  const drawUnits = useCallback(() => {
    const armyTex = armyTextureRef.current;
    const unitTex = unitTextureRef.current;
    const unitTexBlue = unitTextureBlueRef.current;
    const unitTexRedCav = unitTextureRedCavalryRef.current;
    const unitTexBlueCav = unitTextureBlueCavalryRef.current;
    const unitTexRedSkir = unitTextureRedSkirmisherRef.current;
    const unitTexBlueSkir = unitTextureBlueSkirmisherRef.current;
    if (!armyTex || !unitTex || !unitTexBlue || !unitTexRedCav || !unitTexBlueCav || !unitTexRedSkir || !unitTexBlueSkir) return;
    drawUnitsRender({
      unitsGfx: unitsGfx.current,
      unitContainers: unitContainersRef.current,
      unitTextureRed: unitTex,
      unitTextureBlue: unitTexBlue,
      unitTextureRedCavalry: unitTexRedCav,
      unitTextureBlueCavalry: unitTexBlueCav,
      unitTextureRedSkirmisher: unitTexRedSkir,
      unitTextureBlueSkirmisher: unitTexBlueSkir,
      armyTexture: armyTex,
      armies,
```

Replace it with (adds the `shadowTex` local, the guard, and the ctx field):

```typescript
  const drawUnits = useCallback(() => {
    const armyTex = armyTextureRef.current;
    const shadowTex = shadowTextureRef.current;
    const unitTex = unitTextureRef.current;
    const unitTexBlue = unitTextureBlueRef.current;
    const unitTexRedCav = unitTextureRedCavalryRef.current;
    const unitTexBlueCav = unitTextureBlueCavalryRef.current;
    const unitTexRedSkir = unitTextureRedSkirmisherRef.current;
    const unitTexBlueSkir = unitTextureBlueSkirmisherRef.current;
    if (!armyTex || !shadowTex || !unitTex || !unitTexBlue || !unitTexRedCav || !unitTexBlueCav || !unitTexRedSkir || !unitTexBlueSkir) return;
    drawUnitsRender({
      unitsGfx: unitsGfx.current,
      unitContainers: unitContainersRef.current,
      unitTextureRed: unitTex,
      unitTextureBlue: unitTexBlue,
      unitTextureRedCavalry: unitTexRedCav,
      unitTextureBlueCavalry: unitTexBlueCav,
      unitTextureRedSkirmisher: unitTexRedSkir,
      unitTextureBlueSkirmisher: unitTexBlueSkir,
      armyTexture: armyTex,
      shadowTexture: shadowTex,
      armies,
```

- [ ] **Step 7: Rewrite `addUnitSpriteWithShadow` to use the baked texture**

In `src/canvas/render/drawUnits.ts`, find the constants and helper (lines 10-64):

```typescript
const UNIT_SPRITE_SIZE = 112;
const UNIT_SHADOW_OFFSET = { x: 8, y: 18 };
const UNIT_SHADOW_SCALE = { x: 1.05, y: 0.35 };
const UNIT_SHADOW_ALPHA = 0.35;
const UNIT_SHADOW_BLUR = 3;
```

Replace those five constant lines with:

```typescript
const UNIT_SPRITE_SIZE = 112;
const UNIT_SHADOW_OFFSET = { x: 8, y: 18 };
const UNIT_SHADOW_ALPHA = 0.35;
const UNIT_SHADOW_W = UNIT_SPRITE_SIZE * 0.82;
const UNIT_SHADOW_H = UNIT_SPRITE_SIZE * 0.30;
```

Then find the helper body:

```typescript
function addUnitSpriteWithShadow(container: PIXI.Container, texture: PIXI.Texture, isFar: boolean): void {
  const shadow = new PIXI.Sprite(texture);
  shadow.anchor.set(0.5);
  shadow.x = UNIT_SHADOW_OFFSET.x;
  shadow.y = UNIT_SHADOW_OFFSET.y;
  shadow.scale.set(
    (UNIT_SPRITE_SIZE * UNIT_SHADOW_SCALE.x) / texture.width,
    (UNIT_SPRITE_SIZE * UNIT_SHADOW_SCALE.y) / texture.height,
  );
  shadow.tint = 0x000000;
  shadow.alpha = UNIT_SHADOW_ALPHA;
  shadow.filters = [new PIXI.BlurFilter({ strength: UNIT_SHADOW_BLUR })];
  shadow.label = 'unit-sprite-shadow';
  shadow.visible = !isFar;
  container.addChild(shadow);

  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.x = 0;
  sprite.y = 0;
  sprite.width = UNIT_SPRITE_SIZE;
  sprite.height = UNIT_SPRITE_SIZE;
  sprite.label = 'unit-sprite';
  sprite.visible = !isFar;
  container.addChild(sprite);
}
```

Replace it with (takes a separate `shadowTex`, no filter):

```typescript
function addUnitSpriteWithShadow(container: PIXI.Container, texture: PIXI.Texture, shadowTex: PIXI.Texture, isFar: boolean): void {
  const shadow = new PIXI.Sprite(shadowTex);
  shadow.anchor.set(0.5);
  shadow.x = UNIT_SHADOW_OFFSET.x;
  shadow.y = UNIT_SHADOW_OFFSET.y;
  shadow.width = UNIT_SHADOW_W;
  shadow.height = UNIT_SHADOW_H;
  shadow.alpha = UNIT_SHADOW_ALPHA;
  shadow.label = 'unit-sprite-shadow';
  shadow.visible = !isFar;
  container.addChild(shadow);

  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.x = 0;
  sprite.y = 0;
  sprite.width = UNIT_SPRITE_SIZE;
  sprite.height = UNIT_SPRITE_SIZE;
  sprite.label = 'unit-sprite';
  sprite.visible = !isFar;
  container.addChild(sprite);
}
```

- [ ] **Step 8: Update the call site to pass the baked texture**

In `src/canvas/render/drawUnits.ts`, find (around line 250):

```typescript
    addUnitSpriteWithShadow(container, tex, isFar);
```

Replace with:

```typescript
    addUnitSpriteWithShadow(container, tex, ctx.shadowTexture, isFar);
```

- [ ] **Step 9: Build**

Run: `npm run build`
Expected: build succeeds. (If `tsc` flags an unused import for `BlurFilter`, ignore — `BlurFilter` is referenced via `PIXI.BlurFilter` in PixiApp, not a named import.)

- [ ] **Step 10: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 11: Visual smoke**

Reload http://localhost:5173, dive into a tactical hex, place a few units (HUD / number keys), and confirm each unit casts a soft oval shadow offset down-right. No console errors, no `BlurFilter` warnings.

- [ ] **Step 12: Commit**

```bash
git add src/canvas/PixiApp.ts src/components/GameCanvas.tsx src/canvas/render/drawUnits.ts
git commit -m "perf(render): bake unit shadow to a texture once, drop per-tick BlurFilter"
```

---

## Task 3: Persistent unit children + Map terrain lookup (kill per-tick rebuild)

**Problem (findings #2, #3, #4):**
- #3: `drawUnits.ts:217` calls `container.removeChildren()` and recreates marker/outline/sprite/HP-bar every tick, even when nothing visual changed.
- #2: `drawUnits.ts:277,290` creates `new PIXI.Text` for the lieutenant ★ and heading → every tick (Text rasterizes a texture on construction).
- #4: `drawUnits.ts:175,310` does `gridData.find(...)` per unit and per ring — O(units × hexes) with ~3,700 hexes.

**Fix:** build a `Map<key, type>` once per call; create each unit's children once (stored on the container as `_visual`) and mutate only what changes each tick (HP-bar width/tint, ★/→ visibility, heading text only on change, outline redraw via `clear()`); make `drawUnits` own `unit-detail` visibility (HP bar / ★ / → are conditional, not pure-LOD) and remove that branch from the LOD ticker.

**Files:**
- Modify: `src/canvas/render/drawUnits.ts` (full rewrite — replaces the file below `import`s)
- Modify: `src/canvas/PixiApp.ts` (remove `unit-detail` from the LOD `applyLod` helper)

- [ ] **Step 1: Replace the entire contents of `src/canvas/render/drawUnits.ts`**

Overwrite the file with exactly this (keeps the STRATEGIC branch, fog-of-war, lieutenant logic, position tween, and attack-target rings; adds persistent children + Map lookup + persistent ★/→):

```typescript
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { MAX_HP_BY_TYPE } from '../../battle/simulate';
import type { Unit, Team } from '../../battle/simulate';
import { getTerrainMods } from '../../battle/terrain';
import { TERRAINS } from '../terrain-defs';
import { TEAM_TINTS, HEADING_ARROWS, LOD_THRESHOLD, TICK_MS, type Armies, type GroupOrders } from '../constants';

const UNIT_SPRITE_SIZE = 112;
const UNIT_SHADOW_OFFSET = { x: 8, y: 18 };
const UNIT_SHADOW_ALPHA = 0.35;
const UNIT_SHADOW_W = UNIT_SPRITE_SIZE * 0.82;
const UNIT_SHADOW_H = UNIT_SPRITE_SIZE * 0.30;
const HP_BAR_W = 26;
const HP_BAR_H = 4;
const HP_BAR_Y = -40;
const BADGE_Y = -44;
const STAR_STYLE = { fontSize: 14, fontWeight: '900' as const, fill: 0xfacc15, stroke: { color: 0x000000, width: 2 } };

// Persistent per-unit children, created once and mutated each tick. Stored on the unit
// container as `_visual` (same casting convention the codebase uses for `_targetKey`).
interface UnitVisual {
  marker: PIXI.Graphics;
  outline: PIXI.Graphics;
  shadow: PIXI.Sprite;
  sprite: PIXI.Sprite;
  hpBg: PIXI.Sprite;
  hpFg: PIXI.Sprite;
  star: PIXI.Text;
  arrow: PIXI.Text;
  arrowHeading: string;
}
type UnitContainer = PIXI.Container & { _targetKey?: string; _visual?: UnitVisual };

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
  armyTexture: PIXI.Texture;
  // Soft shadow baked once at boot (PixiApp). Drawn as a plain Sprite per unit.
  shadowTexture: PIXI.Texture;
  // data
  armies: Armies;
  groupOrders: GroupOrders;
  gridData: { hex: Hex; type: string }[];
  currentStrategicHex: Hex | null;
  viewMode: 'STRATEGIC' | 'TACTICAL';
  selectedTeam: Team;
  fogOfWar: boolean;
  // current world scale — read directly so GSAP dive tweens don't cause stale reads
  worldScale: number;
}

// Unit-local hexagon vertices (size = HexUtils.size) — identical for every unit, so
// compute once at module load instead of per unit per tick.
const UNIT_VERTS: { x: number; y: number }[] = (() => {
  const s = HexUtils.size;
  const v: { x: number; y: number }[] = [];
  for (let k = 0; k < 6; k++) {
    const ang = (Math.PI / 180) * (60 * k);
    v.push({ x: s * Math.cos(ang), y: s * Math.sin(ang) });
  }
  return v;
})();

function createUnitVisual(
  container: PIXI.Container,
  tex: PIXI.Texture,
  shadowTex: PIXI.Texture,
  teamColor: number,
  isFar: boolean,
): UnitVisual {
  // Strategic-view team marker; drawn before the outline so strokes sit on top.
  const marker = new PIXI.Graphics();
  marker.poly(UNIT_VERTS.flatMap(v => [v.x, v.y])).fill({ color: teamColor, alpha: 0.7 });
  marker.label = 'unit-marker';
  marker.visible = isFar;
  container.addChild(marker);

  // Team perimeter outline — geometry redrawn each tick (neighbour-dependent).
  const outline = new PIXI.Graphics();
  container.addChild(outline);

  const shadow = new PIXI.Sprite(shadowTex);
  shadow.anchor.set(0.5);
  shadow.x = UNIT_SHADOW_OFFSET.x;
  shadow.y = UNIT_SHADOW_OFFSET.y;
  shadow.width = UNIT_SHADOW_W;
  shadow.height = UNIT_SHADOW_H;
  shadow.alpha = UNIT_SHADOW_ALPHA;
  shadow.label = 'unit-sprite-shadow';
  shadow.visible = !isFar;
  container.addChild(shadow);

  const sprite = new PIXI.Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.width = UNIT_SPRITE_SIZE;
  sprite.height = UNIT_SPRITE_SIZE;
  sprite.label = 'unit-sprite';
  sprite.visible = !isFar;
  container.addChild(sprite);

  // HP bar as tinted white sprites so per-tick updates just set width/tint (no Graphics
  // rebuild). Anchor 0 (top-left) matches the old Graphics rect(barX, barY, ...).
  const hpBg = new PIXI.Sprite(PIXI.Texture.WHITE);
  hpBg.tint = 0x000000;
  hpBg.alpha = 0.6;
  hpBg.width = HP_BAR_W;
  hpBg.height = HP_BAR_H;
  hpBg.x = -HP_BAR_W / 2;
  hpBg.y = HP_BAR_Y;
  hpBg.label = 'unit-detail';
  hpBg.visible = false;
  container.addChild(hpBg);

  const hpFg = new PIXI.Sprite(PIXI.Texture.WHITE);
  hpFg.height = HP_BAR_H;
  hpFg.x = -HP_BAR_W / 2;
  hpFg.y = HP_BAR_Y;
  hpFg.label = 'unit-detail';
  hpFg.visible = false;
  container.addChild(hpFg);

  const star = new PIXI.Text({ text: '★', style: STAR_STYLE });
  star.anchor.set(0.5);
  star.x = 0;
  star.y = BADGE_Y;
  star.label = 'unit-detail';
  star.visible = false;
  container.addChild(star);

  const arrow = new PIXI.Text({ text: '→', style: STAR_STYLE });
  arrow.anchor.set(0.5);
  arrow.x = 14;
  arrow.y = BADGE_Y;
  arrow.label = 'unit-detail';
  arrow.visible = false;
  container.addChild(arrow);

  return { marker, outline, shadow, sprite, hpBg, hpFg, star, arrow, arrowHeading: '→' };
}

export function drawUnits(ctx: UnitsRenderContext): void {
  const c = ctx.unitsGfx;
  const armyTex = ctx.armyTexture;

  // Kill GSAP tweens before destroy so they don't touch a freed object next frame.
  const destroyAllUnitContainers = () => {
    ctx.unitContainers.forEach(cont => {
      gsap.killTweensOf(cont);
      gsap.killTweensOf(cont.position);
      cont.destroy({ children: true });
    });
    ctx.unitContainers.clear();
  };

  // Single O(hexes) build, then O(1) lookups — replaces per-unit / per-ring gridData.find.
  const tileTypeByKey = new Map<string, string>(ctx.gridData.map(d => [HexUtils.key(d.hex), d.type]));

  if (ctx.viewMode === 'STRATEGIC') {
    destroyAllUnitContainers();
    c.removeChildren();
    ctx.armies.forEach((_units, key) => {
      const strategicHex = HexUtils.fromKey(key);
      const type = tileTypeByKey.get(key);
      if (!type) return;
      const pos = HexUtils.hexToPixel(strategicHex);
      const sprite = new PIXI.Sprite(armyTex);
      sprite.anchor.set(0.5, 1);
      sprite.x = pos.x;
      sprite.y = pos.y - TERRAINS[type].height - 6;
      sprite.width = 40;
      sprite.height = 40;
      c.addChild(sprite);
    });
    return;
  }

  // TACTICAL
  if (!ctx.currentStrategicHex) {
    destroyAllUnitContainers();
    c.removeChildren();
    return;
  }
  const units = ctx.armies.get(HexUtils.key(ctx.currentStrategicHex)) ?? [];

  // Destroy containers for units that no longer exist so GSAP can't tween ghosts.
  const wantedIds = new Set(units.map(u => u.id));
  ctx.unitContainers.forEach((cont, id) => {
    if (!wantedIds.has(id)) {
      gsap.killTweensOf(cont);
      gsap.killTweensOf(cont.position);
      cont.destroy({ children: true });
      ctx.unitContainers.delete(id);
    }
  });
  // Remove only transient children (attack-target rings); persistent unit containers stay.
  for (let i = c.children.length - 1; i >= 0; i--) {
    if (c.children[i].label !== 'unit-container') c.removeChildAt(i);
  }

  // Lieutenant per (team, groupId): the unit at the attack target if an order is active,
  // else the lowest-id live unit so a marker still appears between orders.
  const lieutenantIds = new Set<string>();
  const lowestByGroup = new Map<string, Unit>();
  for (const u of units) {
    const k = `${u.team}:${u.groupId}`;
    const cur = lowestByGroup.get(k);
    if (!cur || u.id < cur.id) lowestByGroup.set(k, u);
  }
  lowestByGroup.forEach((lo, key) => {
    const order = ctx.groupOrders.get(key);
    if (order?.attackTarget) {
      const at = order.attackTarget;
      const onTarget = units.find(u =>
        `${u.team}:${u.groupId}` === key
        && u.tacticalHex.q === at.q && u.tacticalHex.r === at.r
      );
      lieutenantIds.add((onTarget ?? lo).id);
    } else {
      lieutenantIds.add(lo.id);
    }
  });

  // teamByKey lets the outline skip edges shared with a same-team neighbour (cluster shows
  // only its outer perimeter). Edge k ↔ neighbour at HexUtils.directions[(6 - k) % 6].
  const teamByKey = new Map<string, Team>();
  for (const u of units) teamByKey.set(HexUtils.key(u.tacticalHex), u.team);

  const isFar = ctx.worldScale < LOD_THRESHOLD;

  const visibleHexes = new Set<string>();
  if (ctx.fogOfWar) {
    for (const u of units) {
      if (u.team !== ctx.selectedTeam) continue;
      const r = u.visionRadius;
      for (let dq = -r; dq <= r; dq++) {
        for (let dr = -r; dr <= r; dr++) {
          const h = { q: u.tacticalHex.q + dq, r: u.tacticalHex.r + dr };
          if (HexUtils.distance(u.tacticalHex, h) <= r) visibleHexes.add(HexUtils.key(h));
        }
      }
    }
  }

  units.forEach(u => {
    const hexKey = HexUtils.key(u.tacticalHex);
    const tileType = tileTypeByKey.get(hexKey);
    if (!tileType) return;
    const pos = HexUtils.hexToPixel(u.tacticalHex);
    const topY = pos.y - TERRAINS[tileType].height;
    // Includes topY so world regeneration (same hex, new terrain type) re-targets the
    // container instead of leaving the unit floating at the old elevation.
    const targetKey = `${hexKey}|${Math.round(topY)}`;
    const unitType = u.unitType ?? 'infantry';
    const teamColor = TEAM_TINTS[u.team];

    let container = ctx.unitContainers.get(u.id) as UnitContainer | undefined;
    if (!container) {
      container = new PIXI.Container() as UnitContainer;
      container.label = 'unit-container';
      container.position.set(pos.x, topY);
      container._targetKey = targetKey;
      const tex = u.team === 'red'
        ? (unitType === 'skirmisher' ? ctx.unitTextureRedSkirmisher : unitType === 'cavalry' ? ctx.unitTextureRedCavalry : ctx.unitTextureRed)
        : (unitType === 'skirmisher' ? ctx.unitTextureBlueSkirmisher : unitType === 'cavalry' ? ctx.unitTextureBlueCavalry : ctx.unitTextureBlue);
      container._visual = createUnitVisual(container, tex, ctx.shadowTexture, teamColor, isFar);
      ctx.unitContainers.set(u.id, container);
      c.addChild(container);
    } else if (container._targetKey !== targetKey) {
      container._targetKey = targetKey;
      // Stretch the tween over the destination terrain's cooldown so the unit GLIDES
      // across rough hexes instead of teleporting in TICK_MS then sitting idle.
      const moveCost = getTerrainMods(tileType).moveCost;
      gsap.to(container.position, {
        x: pos.x,
        y: topY,
        duration: (TICK_MS * (1 + moveCost)) / 1000,
        ease: 'linear',
        overwrite: true,
      });
    }

    const v = container._visual!;

    // Position keeps tweening while hidden so a fog reveal shows the unit at its current
    // location, not the last-seen one.
    const isHidden = ctx.fogOfWar && u.team !== ctx.selectedTeam && !visibleHexes.has(hexKey);
    container.visible = !isHidden;

    // Outline depends on same-team neighbours, which change as units move. clear()+redraw
    // reuses the Graphics object — no per-tick allocation.
    v.outline.clear();
    for (let k = 0; k < 6; k++) {
      const dir = HexUtils.directions[(6 - k) % 6];
      const nKey = HexUtils.key({ q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r });
      if (teamByKey.get(nKey) === u.team) continue;
      const a = UNIT_VERTS[k];
      const b = UNIT_VERTS[(k + 1) % 6];
      v.outline.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    v.outline.stroke({ color: teamColor, width: 3, alpha: 0.95 });

    // sprite/shadow/marker visibility is LOD-only and owned by the PixiApp ticker; set at
    // create. unit-detail (HP bar, ★, →) is conditional → owned here, set every tick.
    const maxHp = MAX_HP_BY_TYPE[unitType];
    const showHp = u.hp < maxHp && !isFar;
    v.hpBg.visible = showHp;
    v.hpFg.visible = showHp;
    if (showHp) {
      const ratio = Math.max(0, u.hp / maxHp);
      v.hpFg.width = HP_BAR_W * ratio;
      const r = Math.round(0xef * (1 - ratio) + 0x10 * ratio);
      const g = Math.round(0x44 * (1 - ratio) + 0xb9 * ratio);
      const b = Math.round(0x44 * (1 - ratio) + 0x81 * ratio);
      v.hpFg.tint = (r << 16) | (g << 8) | b;
    }

    const isLt = lieutenantIds.has(u.id);
    v.star.visible = isLt && !isFar;
    const order = ctx.groupOrders.get(`${u.team}:${u.groupId}`);
    const showArrow = isLt && !!order?.attackTarget && !isFar;
    v.arrow.visible = showArrow;
    if (showArrow) {
      const heading = HEADING_ARROWS[order!.heading] ?? '→';
      // Re-rasterizing Text is costly — only set .text when the glyph actually changes.
      if (heading !== v.arrowHeading) {
        v.arrow.text = heading;
        v.arrowHeading = heading;
      }
    }
  });

  // Attack target indicators per group — transient (≤ a handful per tick), recreated each
  // call. Fog of war: skip rings owned by the OTHER team so enemy intent doesn't leak.
  ctx.groupOrders.forEach(order => {
    if (!order.attackTarget) return;
    if (ctx.fogOfWar && order.team !== ctx.selectedTeam) return;
    const type = tileTypeByKey.get(HexUtils.key(order.attackTarget));
    if (!type) return;
    const pos = HexUtils.hexToPixel(order.attackTarget);
    const topY = pos.y - TERRAINS[type].height;
    const ring = new PIXI.Graphics();
    ring.circle(pos.x, topY, 22).stroke({ width: 3, color: TEAM_TINTS[order.team], alpha: 0.85 });
    ring.label = 'unit-detail';
    ring.visible = !isFar;
    c.addChild(ring);
  });
}
```

- [ ] **Step 2: Remove the `unit-detail` branch from the LOD ticker**

`drawUnits` now owns `unit-detail` visibility (HP bar / ★ / → are conditional, not pure-LOD). If the ticker also blanket-set them on a zoom crossing, a full-HP unit would show an empty bar. In `src/canvas/PixiApp.ts`, find the `applyLod` helper (around line 465):

```typescript
        const applyLod = (child: PIXI.Container) => {
          if (child.label === 'unit-sprite' || child.label === 'unit-sprite-shadow') child.visible = !isFar;
          else if (child.label === 'unit-marker') child.visible = isFar;
          else if (child.label === 'unit-detail') child.visible = !isFar;
        };
```

Remove the last branch:

```typescript
        const applyLod = (child: PIXI.Container) => {
          if (child.label === 'unit-sprite' || child.label === 'unit-sprite-shadow') child.visible = !isFar;
          else if (child.label === 'unit-marker') child.visible = isFar;
        };
```

> Trade-off (acceptable): while the battle is **paused** and you zoom across the LOD threshold, HP bars / badges won't re-evaluate until the next `drawUnits`. During an active battle `drawUnits` runs every tick, so they stay correct. This was already the behavior for newly-spawned units between crossings.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors. (Watch for: unused-import errors — `getTerrainMods`, `MAX_HP_BY_TYPE`, `HEADING_ARROWS` must all still be imported and used; they are.)

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Sim regression**

Run: `npx tsx scripts/sim-formations.ts`
Expected: runs all scenarios; output identical to a run on the previous commit (render changes don't touch the sim). If any scenario result differs, STOP — something leaked into sim state.

- [ ] **Step 6: Visual smoke (the important one)**

Reload http://localhost:5173, dive into a tactical hex, place red and blue units in adjacent hexes, and start a battle. Verify, watching closely:
- Units glide between hexes (position tween intact).
- Team perimeter outline hugs the outer edge of each same-team cluster.
- HP bars appear only when a unit is damaged, shrink and shift red→green correctly as HP drops, and disappear at strategic (far) zoom.
- The lieutenant ★ shows on one unit per group; the → appears next to it when the group has an attack order and points the right heading; both hide at far zoom.
- Zoom out past the LOD threshold: sprites+shadows swap to filled team-colored hex markers; zoom back in: they swap back.
- Attack-target rings still draw on the targeted hex in team color.
- No console errors; framerate is visibly smoother than before with many units.

- [ ] **Step 7: Commit**

```bash
git add src/canvas/render/drawUnits.ts src/canvas/PixiApp.ts
git commit -m "perf(render): persistent unit children + Map terrain lookup, stop per-tick rebuild"
```

---

## Task 4: Consolidate water filters (1 render pass per config, not per layer)

**Problem (finding #6):** `drawTerrain.ts:169-227` defines 1 DEEP_SEA + 6 SEA overlay layers; the loop (line 468) attaches a **separate** `createWaterFilter` to each layer's container, and the ticker updates every handle's `uTime` each frame — so all 7 filtered containers re-render to texture every frame.

**Fix:** one filtered parent container per water config (`deepSea`, `coastal`). Each water layer's TilingSprite + mask becomes a child of its config's parent; the filter is applied **once** to the parent. Water is contiguous at the start of the overlay array, so the two parents land at the bottom of `overlay` (correct z-order). Result: 2 water render passes/frame instead of 7, and 2 filter handles instead of 7.

> **Risk / known behavior change:** today each water layer is isolated in its own filtered container, so its `blendMode` (soft-light/multiply/screen) effectively blends against transparent. Grouping layers under one filtered parent means those blend modes now compose against each other inside the shared render target — the water may look slightly different (often *better* — coherent wobble + visible layering). This is the one task gated on a real before/after visual check (Step 5). If the water looks materially wrong, see the fallback note in Step 6.

**Files:**
- Modify: `src/canvas/render/drawTerrain.ts` (the overlay loop, around lines 423-506)

- [ ] **Step 1: Capture a "before" screenshot**

With the dev server running, generate a world that has visible sea + deep sea (strategic view shows the island). Take a screenshot (browser screenshot, or the Playwright MCP `browser_take_screenshot`) and keep it for comparison in Step 5.

- [ ] **Step 2: Add the lazy water-parent helper before the overlay loop**

In `src/canvas/render/drawTerrain.ts`, find the start of the overlay loop (around line 423):

```typescript
  for (const layer of globalUvOverlays) {
    if (layer.paintCliffsBefore) {
      const terrainCliffs = new PIXI.Graphics();
      drawTerrainCliffs(terrainCliffs, layer.paintCliffsBefore);
      overlay.addChild(terrainCliffs);
    }
```

Insert the helper immediately **before** the `for (const layer ...)` line:

```typescript
  // One filtered parent per water config → a single render-to-texture pass for all layers
  // sharing that filter, instead of one pass per layer. Water layers are contiguous at the
  // start of globalUvOverlays, so these parents are added first = lowest z (correct).
  const waterParents: Partial<Record<'deepSea' | 'coastal', PIXI.Container>> = {};
  const ensureWaterParent = (kind: 'deepSea' | 'coastal'): PIXI.Container => {
    let p = waterParents[kind];
    if (!p) {
      p = new PIXI.Container();
      const handle = createWaterFilter(WATER_FILTER_CONFIGS[kind]);
      p.filters = [handle.filter];
      ctx.waterFilters.push(handle);
      overlay.addChild(p);
      waterParents[kind] = p;
    }
    return p;
  };

  for (const layer of globalUvOverlays) {
    if (layer.paintCliffsBefore) {
      const terrainCliffs = new PIXI.Graphics();
      drawTerrainCliffs(terrainCliffs, layer.paintCliffsBefore);
      overlay.addChild(terrainCliffs);
    }
```

- [ ] **Step 3: Replace the per-layer filter attach + addChild block**

Still in `src/canvas/render/drawTerrain.ts`, find this block inside the loop (around line 464):

```typescript
    const layerContainer = new PIXI.Container();
    layerContainer.x = minX;
    layerContainer.y = minY;
    layerContainer.addChild(tile);
    if (layer.waterFilter) {
      const handle = createWaterFilter(WATER_FILTER_CONFIGS[layer.waterFilter]);
      layerContainer.filters = [handle.filter];
      ctx.waterFilters.push(handle);
    }
    const mask = new PIXI.Graphics();
```

Replace it with (drop the per-layer filter; the parent is resolved after the mask is built):

```typescript
    const layerContainer = new PIXI.Container();
    layerContainer.x = minX;
    layerContainer.y = minY;
    layerContainer.addChild(tile);
    const mask = new PIXI.Graphics();
```

- [ ] **Step 4: Route the layer + mask into the right parent**

Still in `src/canvas/render/drawTerrain.ts`, find the end of the loop body where the layer is attached (around line 503):

```typescript
    overlay.addChild(layerContainer);
    overlay.addChild(mask);
    layerContainer.mask = mask;
  }
```

Replace it with (water layers go under their shared filtered parent; everything else stays directly on `overlay`):

```typescript
    const parent = layer.waterFilter ? ensureWaterParent(layer.waterFilter) : overlay;
    parent.addChild(layerContainer);
    parent.addChild(mask);
    layerContainer.mask = mask;
  }
```

- [ ] **Step 5: Build, lint, then visual diff**

Run: `npm run build`
Expected: build succeeds.

Run: `npm run lint`
Expected: no new errors.

Then reload http://localhost:5173, regenerate the same kind of world, and take an "after" screenshot. Compare against Step 1:
- Sea and deep sea must still be present, masked exactly to their hexes, and **still animating** (the wobble must move).
- River, grassland, forest, hill, mountain, snow overlays must be unchanged.
- Coastal effects (shallow-near-sand, depth-away-from-sand, shimmer, micro/macro noise) should still read as water texture — exact tone may shift slightly (see risk note). No console errors. No GL warnings about masks/filters.

- [ ] **Step 6: Decision gate**

If the water looks acceptable (animating, masked, recognizably water) → proceed to commit.

If the water looks materially wrong (e.g., a blend layer turned solid/black, or animation stopped):
- First check the masks render (each `mask` must be a child of the same parent — Step 4 adds it to `parent`, confirm).
- If a specific blend layer is the culprit, the safe fallback is to drop the offending `blendMode`/`alpha` decoration layer from `globalUvOverlays` rather than reverting the consolidation, OR keep that one decorative layer outside the filtered parent (add it directly to `overlay` after the parents). **Do not** revert to per-layer filters — that reintroduces the 7-pass cost. Stop and report the specific layer if unsure.

- [ ] **Step 7: Commit**

```bash
git add src/canvas/render/drawTerrain.ts
git commit -m "perf(render): consolidate water into one filtered container per config"
```

---

## Self-review notes

- **Spec coverage:** finding #1 → Task 2; #2 → Task 3 (persistent ★/→ + text-set-only-on-change); #3 → Task 3 (persistent children); #4 → Task 3 (`tileTypeByKey` Map); #5 → Task 1; #6 → Task 4. All six covered.
- **Type/name consistency:** `shadowTextureRef` (GameCanvas + PixiAppCtx) ↔ `shadowTexture` (UnitsRenderContext field) are wired in Task 2 and consumed in Task 3's full file. `UnitVisual` / `UnitContainer` / `createUnitVisual` / `UNIT_VERTS` are all defined and used within Task 3's single file. Labels `unit-sprite`, `unit-sprite-shadow`, `unit-marker`, `unit-detail`, `unit-container` are kept identical to the originals so the (edited) LOD ticker and the dead-unit cleanup still match by label.
- **Overlap note:** Task 2 edits `addUnitSpriteWithShadow` + its constants; Task 3 replaces the whole file and folds that logic into `createUnitVisual`. Expected and intentional — each task is independently shippable.
- **No test runner:** verification is build + lint + sim-harness + in-browser visual smoke, as stated up top. No fabricated unit tests.
