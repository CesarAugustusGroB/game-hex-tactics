# Render Quality & Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sharpen the canvas on HiDPI displays, fix unit draw-order overlap, migrate the last deprecated PIXI v7 Graphics calls to v8, and offload the world transform to a GPU render group.

**Architecture:** Four small, independent edits to the existing PIXI v8 + React canvas layer. No new files, no new dependencies. Each is behavior-preserving except HiDPI (sharper) and depth-sorting (correct overlap). Two further items from the review (`cacheAsTexture`, texture atlas) are deferred with rationale — see the "Deferred" section.

**Tech Stack:** PixiJS v8.17, React 19, GSAP, TypeScript, Vite.

---

## Verification approach (read first)

**This repo has no unit-test runner** (`CLAUDE.md`). These are rendering changes. Every task is gated by:

1. **`npm run build`** — `tsc -b` + `vite build`; type errors fail.
2. **`npm run lint`** — ESLint.
3. **`npx tsx scripts/sim-formations.ts`** — battle-sim regression (render-only changes must leave it identical / non-crashing). Only strictly needed for tasks touching `drawUnits.ts` (Task 2), but cheap to run on all.
4. **Visual smoke** — the Vite dev server is already running at http://localhost:5173 (HMR). Reload, dive into a tactical hex, and confirm the relevant visuals. The user is present and can eyeball; there is no automated screenshot diff.

**Branch:** continue on `feature/presentation` (this is the permanent presentation worktree per `CLAUDE.md` — never remove it). Commit after each task. Commit message bodies end with the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

Task order: **1 → 2 → 3 → 4**. All four are independent; this order does the highest-value/lowest-risk first.

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/canvas/PixiApp.ts` | PIXI lifecycle, world setup, container z-order | 1 (HiDPI init), 2 (sortableChildren), 4 (render group) |
| `src/canvas/render/drawUnits.ts` | Per-unit tactical rendering | 2 (per-unit `zIndex`) |
| `src/canvas/render/drawTerrain.ts` | Terrain prism sides | 3 (Graphics API) |
| `src/components/GameCanvas.tsx` | Hover highlight redraw | 3 (Graphics API) |
| `src/canvas/input/orderDrag.ts` | Order-mode formation preview | 3 (Graphics API) |

---

## Task 1: HiDPI rendering (`resolution` + `autoDensity`)

**Problem (review #7):** `PixiApp.ts` calls `app.init({ resizeTo: window, backgroundColor: 0x050a14, antialias: true })` with no `resolution` / `autoDensity`, so PIXI renders at the default resolution 1. On retina/4K the whole scene is upscaled → soft. (The army SVG is hand-rasterized to 160px to fight exactly this, but the rest of the scene still renders at resolution 1.)

**Fix:** set `resolution: window.devicePixelRatio` and `autoDensity: true`. `autoDensity` keeps the canvas CSS size equal to the window while scaling the backing store, so all existing screen-space math (`app.screen.width/height`, pointer `e.global`, wheel `e.clientX/Y`) stays in logical pixels — no coordinate changes needed.

**Files:**
- Modify: `src/canvas/PixiApp.ts` (the `app.init` call)

- [ ] **Step 1: Add resolution + autoDensity to `app.init`**

In `src/canvas/PixiApp.ts`, find (around line 130):

```typescript
      await app.init({ resizeTo: window, backgroundColor: 0x050a14, antialias: true });
```

Replace with:

```typescript
      await app.init({
        resizeTo: window,
        backgroundColor: 0x050a14,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success, no TypeScript errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Visual smoke**

Reload http://localhost:5173. On a HiDPI display the strategic map, terrain textures, unit sprites, HUD-adjacent canvas text, and the hover highlight should look noticeably sharper (no soft upscaling). Pan and zoom (wheel) — the cursor-anchored zoom and drag-to-pan must still behave exactly as before (this confirms the logical-pixel coordinate math is intact under `autoDensity`). No console errors. Confirm GPU memory is sane (the canvas backing store is now `dpr×` larger — expected).

- [ ] **Step 5: Commit**

```bash
git add src/canvas/PixiApp.ts
git commit -m "feat(render): render at device pixel ratio (HiDPI) via resolution + autoDensity"
```

---

## Task 2: Depth-sort units by screen-Y

**Problem (review #8):** Unit sprites are `UNIT_SPRITE_SIZE = 112`px over `HexUtils.size = 40` hexes, so a unit's sprite overflows its hex and overlaps neighbours. `unitsGfx` draws children in insertion order (array order of `units`), not back-to-front, so a unit physically "behind" (higher on screen, smaller y) can paint over one "in front". Fix: enable `sortableChildren` on `unitsGfx` and give each unit container a `zIndex` equal to its screen-Y, so lower-on-screen units (larger y, nearer the viewer) render on top.

**Files:**
- Modify: `src/canvas/PixiApp.ts` (enable `sortableChildren` on `unitsGfx`)
- Modify: `src/canvas/render/drawUnits.ts` (set `zIndex` on each unit container + on attack rings)

- [ ] **Step 1: Enable `sortableChildren` on `unitsGfx`**

In `src/canvas/PixiApp.ts`, find the world z-order block (around line 313):

```typescript
      world.addChild(ctx.unitsGfx.current);
```

Replace with:

```typescript
      // Units overlap neighbours (112px sprite over a 40px hex), so render them
      // back-to-front: zIndex = screen-Y is assigned per container in drawUnits.
      ctx.unitsGfx.current.sortableChildren = true;
      world.addChild(ctx.unitsGfx.current);
```

- [ ] **Step 2: Set `zIndex` when a unit container is created**

In `src/canvas/render/drawUnits.ts`, find the create branch inside the `units.forEach` loop:

```typescript
    if (!container) {
      container = new PIXI.Container() as UnitContainer;
      container.label = 'unit-container';
      container.position.set(pos.x, topY);
      container._targetKey = targetKey;
```

Add the `zIndex` line after `position.set`:

```typescript
    if (!container) {
      container = new PIXI.Container() as UnitContainer;
      container.label = 'unit-container';
      container.position.set(pos.x, topY);
      container.zIndex = topY;
      container._targetKey = targetKey;
```

- [ ] **Step 3: Update `zIndex` when a unit moves**

Still in `src/canvas/render/drawUnits.ts`, find the move branch:

```typescript
    } else if (container._targetKey !== targetKey) {
      container._targetKey = targetKey;
      // Stretch the tween over the destination terrain's cooldown so the unit GLIDES
```

Add the `zIndex` update right after `_targetKey` is set:

```typescript
    } else if (container._targetKey !== targetKey) {
      container._targetKey = targetKey;
      container.zIndex = topY;
      // Stretch the tween over the destination terrain's cooldown so the unit GLIDES
```

- [ ] **Step 4: Set `zIndex` on transient attack rings**

Still in `src/canvas/render/drawUnits.ts`, find the attack-ring block near the end:

```typescript
    const ring = new PIXI.Graphics();
    ring.circle(pos.x, topY, 22).stroke({ width: 3, color: TEAM_TINTS[order.team], alpha: 0.85 });
    ring.label = 'unit-detail';
    ring.visible = !isFar;
    c.addChild(ring);
```

Add `ring.zIndex = topY;` before `c.addChild(ring)`:

```typescript
    const ring = new PIXI.Graphics();
    ring.circle(pos.x, topY, 22).stroke({ width: 3, color: TEAM_TINTS[order.team], alpha: 0.85 });
    ring.label = 'unit-detail';
    ring.visible = !isFar;
    ring.zIndex = topY;
    c.addChild(ring);
```

> Note: the STRATEGIC-view army sprites and `removeChildren()` paths are unaffected — they keep the default `zIndex = 0`, which is fine (strategic markers don't overlap). `sortableChildren` re-sorts only when a child's `zIndex` changes (set on create/move here), so the per-frame cost is negligible for the small tactical unit count.

- [ ] **Step 5: Build + lint + sim**

Run: `npm run build` → success.
Run: `npm run lint` → no new errors.
Run: `npx tsx scripts/sim-formations.ts` → all scenarios run, no crash (render-only change).

- [ ] **Step 6: Visual smoke**

Reload http://localhost:5173, dive tactical, place several units in adjacent hexes (especially on terrain of different heights so their `topY` differs), and start a battle. Confirm: when sprites overlap, the unit lower on screen draws ON TOP of the one above/behind it (correct 2.5D layering), and this stays correct as units move between hexes. No flicker/z-fighting. No console errors.

- [ ] **Step 7: Commit**

```bash
git add src/canvas/PixiApp.ts src/canvas/render/drawUnits.ts
git commit -m "fix(render): depth-sort units by screen-Y so overlapping sprites layer correctly"
```

---

## Task 3: Migrate deprecated PIXI v7 Graphics calls to v8

**Problem (review #12):** Three sites still use the deprecated v7 Graphics API (`beginFill`/`endFill`/`lineStyle`/`drawCircle`), which routes through v8 compatibility shims (slower + deprecation warnings). Migrate to the v8 `.poly()/.circle().fill().stroke()` API. All three are behavior-preserving.

**Files:**
- Modify: `src/canvas/render/drawTerrain.ts` (the `drawSide` helper)
- Modify: `src/components/GameCanvas.tsx` (`updateHighlights`)
- Modify: `src/canvas/input/orderDrag.ts` (formation-preview hex)

- [ ] **Step 1: Migrate `drawSide` in `drawTerrain.ts`**

In `src/canvas/render/drawTerrain.ts`, find (around line 94):

```typescript
    const drawSide = (v1: number, v2: number, shade: number, bottomH = 0, color = tDef.color) => {
      tGfx.beginFill(PIXI.Color.shared.setValue(color).multiply([shade, shade, shade, 1]).toNumber());
      tGfx.moveTo(top[v1].x, top[v1].y)
          .lineTo(top[v2].x, top[v2].y)
          .lineTo(base[v2].x, base[v2].y - bottomH)
          .lineTo(base[v1].x, base[v1].y - bottomH)
          .closePath().endFill();
    };
```

Replace with:

```typescript
    const drawSide = (v1: number, v2: number, shade: number, bottomH = 0, color = tDef.color) => {
      tGfx.poly([
        top[v1].x, top[v1].y,
        top[v2].x, top[v2].y,
        base[v2].x, base[v2].y - bottomH,
        base[v1].x, base[v1].y - bottomH,
      ]).fill(PIXI.Color.shared.setValue(color).multiply([shade, shade, shade, 1]).toNumber());
    };
```

- [ ] **Step 2: Migrate `updateHighlights` in `GameCanvas.tsx`**

In `src/components/GameCanvas.tsx`, find (around line 689):

```typescript
  const updateHighlights = () => {
    const h = highlightGfx.current; h.clear(); if (!hoveredHex) return;
    const hexData = gridData.find(d => d.hex.q === hoveredHex.q && d.hex.r === hoveredHex.r);
    const pos = HexUtils.hexToPixel(hoveredHex);
    const topY = pos.y - (hexData ? TERRAINS[hexData.type].height : 0);
    if (isScanning) { h.lineStyle(4, 0x00e6ff, 0.9).beginFill(0x00e6ff, 0.1).drawCircle(pos.x, topY, HexUtils.size * 6.5).endFill(); }
    else {
      h.lineStyle(4, 0xffffff, 0.9); const s = HexUtils.size; for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        if (i === 0) h.moveTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r)); else h.lineTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
      }
      h.closePath();
    }
  };
```

Replace with:

```typescript
  const updateHighlights = () => {
    const h = highlightGfx.current; h.clear(); if (!hoveredHex) return;
    const hexData = gridData.find(d => d.hex.q === hoveredHex.q && d.hex.r === hoveredHex.r);
    const pos = HexUtils.hexToPixel(hoveredHex);
    const topY = pos.y - (hexData ? TERRAINS[hexData.type].height : 0);
    if (isScanning) {
      h.circle(pos.x, topY, HexUtils.size * 6.5)
        .fill({ color: 0x00e6ff, alpha: 0.1 })
        .stroke({ width: 4, color: 0x00e6ff, alpha: 0.9 });
    } else {
      const s = HexUtils.size;
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        pts.push(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
      }
      h.poly(pts).stroke({ width: 4, color: 0xffffff, alpha: 0.9 });
    }
  };
```

- [ ] **Step 3: Migrate the formation-preview hex in `orderDrag.ts`**

In `src/canvas/input/orderDrag.ts`, find (around line 232):

```typescript
    const isLieutenant = i === 0;
    const hex = new PIXI.Graphics();
    hex.lineStyle(isLieutenant ? 3 : 2, isLieutenant ? 0xfacc15 : teamColor, isLieutenant ? 0.95 : 0.75);
    hex.beginFill(isLieutenant ? 0xfacc15 : teamColor, 0.18);
    const s = HexUtils.size;
    for (let k = 0; k < 6; k++) {
      const r = Math.PI / 180 * (60 * k);
      if (k === 0) hex.moveTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
      else hex.lineTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
    }
    hex.closePath().endFill();
    gfx.addChild(hex);
```

Replace with:

```typescript
    const isLieutenant = i === 0;
    const hex = new PIXI.Graphics();
    const s = HexUtils.size;
    const pts: number[] = [];
    for (let k = 0; k < 6; k++) {
      const r = Math.PI / 180 * (60 * k);
      pts.push(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
    }
    hex.poly(pts)
      .fill({ color: isLieutenant ? 0xfacc15 : teamColor, alpha: 0.18 })
      .stroke({ width: isLieutenant ? 3 : 2, color: isLieutenant ? 0xfacc15 : teamColor, alpha: isLieutenant ? 0.95 : 0.75 });
    gfx.addChild(hex);
```

- [ ] **Step 4: Build + lint**

Run: `npm run build` → success.
Run: `npm run lint` → no new errors.
Also confirm no remaining deprecated calls: `npx rg -n "beginFill|endFill|lineStyle|drawCircle|drawRect" src` should return ZERO matches.

- [ ] **Step 5: Visual smoke**

Reload http://localhost:5173. Verify all three visuals are pixel-identical to before:
- **Terrain prism side walls** (the shaded S/SE/SW cliff faces on SAND/RIVER/SEA/ROCKY hexes) render with the same shading.
- **Hover highlight**: white hex outline normally; cyan filled circle in scanning (strategic) mode.
- **Order preview**: enter order mode and drag — the formation preview hexes (gold for the lieutenant slot, team color otherwise) fill + stroke as before.
No deprecation warnings in the console (previously these emitted v8 deprecation notices).

- [ ] **Step 6: Commit**

```bash
git add src/canvas/render/drawTerrain.ts src/components/GameCanvas.tsx src/canvas/input/orderDrag.ts
git commit -m "refactor(render): migrate deprecated v7 Graphics calls to v8 fill/stroke API"
```

---

## Task 4: Promote the world container to a GPU render group

**Problem (review #10):** The `world` container is panned and zoomed constantly (pointer drag, wheel, GSAP dive tweens). Without a render group, changing the world transform makes PIXI recompute world transforms for the whole static subtree (terrain, overlays, details, grid, units) on the CPU each frame the world moves. Marking `world` as a render group offloads its transform to the GPU, so pan/zoom updates only the group's transform.

**Files:**
- Modify: `src/canvas/PixiApp.ts` (call `world.enableRenderGroup()` after it's added to the stage)

- [ ] **Step 1: Enable the render group on `world`**

In `src/canvas/PixiApp.ts`, find the world setup (around line 298):

```typescript
      const world = ctx.worldRef.current;
      world.x = app.screen.width / 2;
      world.y = app.screen.height / 2;
      world.scale.set(ctx.zoom.current);
      app.stage.addChild(world);
```

Add `world.enableRenderGroup();` after `app.stage.addChild(world)`:

```typescript
      const world = ctx.worldRef.current;
      world.x = app.screen.width / 2;
      world.y = app.screen.height / 2;
      world.scale.set(ctx.zoom.current);
      app.stage.addChild(world);
      // Pan/zoom mutates the world transform every frame it moves; as a render group
      // that transform is applied on the GPU instead of re-walking every descendant on
      // the CPU. cacheAsTexture would also enable this, but we want the live transform,
      // not a rasterized snapshot (the world is freely zoomed 0.05–6×).
      world.enableRenderGroup();
```

- [ ] **Step 2: Build + lint**

Run: `npm run build` → success.
Run: `npm run lint` → no new errors.

- [ ] **Step 3: Visual smoke (regression-focused — render groups can subtly affect filters/masks)**

Reload http://localhost:5173 and exercise the whole pipeline, because the render group wraps everything under `world` (terrain masks, the water filter containers, units, highlights):
- **Pan** (drag) and **zoom** (wheel, cursor-anchored) — must behave exactly as before; the cursor-anchored zoom math (`world.toLocal(...)`) must still land correctly.
- **Dive animation**: click a strategic hex while scanning — the GSAP scale/position tween into tactical must animate smoothly and land correctly.
- **Water** must still animate (the displacement filter on the deepSea/coastal containers inside `world`).
- **Terrain overlay masks** must still clip each biome to its hexes (no bleeding, no full-screen texture).
- **Hover highlight** and **unit positions** must still register under the cursor (hex picking via `world.toLocal`).
No console errors / GL warnings.

> If pan/zoom picking or masks/filters visibly break under the render group, that's the known risk: report it. The fallback is to drop this one line (the other three tasks are independent and stand on their own).

- [ ] **Step 4: Commit**

```bash
git add src/canvas/PixiApp.ts
git commit -m "perf(render): promote world to a GPU render group for cheaper pan/zoom"
```

---

## Deferred (with rationale)

These two review items were requested but are **not** included as tasks, because planning them concretely surfaced blockers that make them net-negative or out-of-scope as written. Documented here so the decision is explicit, not forgotten.

### #9 `cacheAsTexture` on static terrain/details — NOT recommended for this app

`cacheAsTexture` rasterizes a container to a single texture at the **current** resolution. This app zooms the world freely from **0.05× to 6×** (`PixiApp.ts` wheel clamp). Two hard problems result:

1. **Zoom blur.** Cache at the current zoom, then zoom in → the cached texture is upscaled and goes soft. The whole point of Task 1 (HiDPI) is sharpness; a zoom-variant cache would undo it at high zoom.
2. **Texture-size limit.** The world is a `gridRadius = 35` axial disk (~thousands of px across). Caching `detailsGfx` (the only filter-free, static, high-sprite-count container) at `resolution = devicePixelRatio` (now 2×) would produce a texture in the ~8000px range, at or beyond the common 8192px GPU `maxTextureSize` — risking a silent cache failure.

Task 4's **render group** captures most of the CPU-transform benefit `cacheAsTexture` would give during pan/zoom, **without** rasterizing — so the scene stays vector-sharp at every zoom. Recommendation: rely on the render group; revisit `cacheAsTexture` only if profiling shows draw-call count (not transform cost) is the bottleneck, and then only for a bounded, zoom-stable sub-region (e.g. a strategic-only low-res cache), which deserves its own spike.

### #11 Texture atlas / spritesheet — needs its own plan (asset pipeline)

Packing the detail (8) + unit (~7) PNGs into one atlas for single-bind batching requires an **asset-build decision** this plan can't make inline: a build-time packer (e.g. a `scripts/pack-atlas.ts` using a packing lib) producing committed `public/atlas.{json,png}`, plus rewiring `PixiApp.ts` loading from `Assets.load(individual)` to `Assets.load(atlasJson)` + `Assets.get('frame.png')`. That's a new subsystem (tooling + generated binary assets), not a render-code tweak. Per the writing-plans scope check, it should be its own brainstormed plan. Note also the TilingSprite terrain textures need `addressMode='repeat'` and **cannot** live in an atlas, so the batching win is limited to the ~15 unit/detail sprites — modest payoff for the tooling cost. Recommend deferring until/unless it's prioritized.

---

## Self-review notes

- **Coverage:** review #7 → Task 1; #8 → Task 2; #12 → Task 3 (all three deprecated-API sites found via grep: `drawTerrain.ts:95`, `GameCanvas.tsx:698`, `orderDrag.ts:233`); #10 → Task 4. #9 and #11 → Deferred section with rationale.
- **Placeholder scan:** every code step shows complete before/after code; no TBD/TODO; verification commands are concrete.
- **Consistency:** `zIndex = topY` is used identically in Task 2's create branch, move branch, and ring block; `sortableChildren` is set on the same `unitsGfx` container those containers are added to. Task 3's `.poly(...).fill(...).stroke(...)` ordering (geometry → fill → stroke) is consistent across all three sites so strokes sit on top of fills. Task 1 and Task 4 each touch a single, distinct line in `PixiApp.ts` and don't overlap Task 2's `sortableChildren` edit (different lines).
- **No test runner:** verification is build + lint + sim + in-browser visual smoke, stated up top.
