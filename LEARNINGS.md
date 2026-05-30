# Learnings — `feature/units` worktree

What got built, what bit us, and what to remember when coming back to this code.

## Scope expansion: terrain rendering (`feature/terrain-modifiers`)

The branch grew beyond unit mechanics into a full terrain-rendering rework:

- **Flat-top hex grid.** `HexUtils` rotated 30° from pointy-top — flat edges face N/S, vertices E/W. Only the q/r↔pixel mapping changes; the 6 axial neighbour offsets stay the same.
- **Textured terrain pipeline.** Five "biomes" (`GRASSLAND`, `FOREST`, `HILL`, `MOUNTAIN`, `SNOW`) render via a global-UV `TilingSprite` + hex-mask overlay instead of per-polygon `Graphics.fill`. World-space UVs mean neighbouring hexes see different continuous patches of the texture rather than the same per-bbox-normalized stamp.
- **2.5D side walls.** Each hex is a faux-prism: top hexagon + S/SE/SW shaded quads (N/NE/NW are hidden from the top-down camera). Hexes render in ascending `TERRAINS[type].height` so taller terrain overlaps shorter neighbours.
- **Chunked grass patches.** Per-`(6×6 axial chunk, seed)` patch type (`NONE/DRY/DENSE/FLOWERY`), each with its own overlay layer (separate masks, separate textures) so a single grassland reads as a varied landscape.
- **Macro noise overlay.** Low-frequency luminance variation across grassland to break up the tile repetition without per-hex work.
- **Three-layer scatter sprites.** `embedded`/`small`/`landmark` per biome (grass/flower/rock sets), density modulated by a simplex zone field, deterministic per hex via seeded RNG.

## Visual target: beautiful continuous hex terrain

Core rule: a hex should not look like an individually decorated cell. The map should read as continuous terrain with a subtle hex grid on top. If each hex screams "tile," the whole map turns into a visible honeycomb.

Do **not** restart texture sampling inside every hex:

```ts
drawTextureInsideEachHex(hex);
```

Do render a continuous world-space texture, clipped by hex masks:

```ts
drawContinuousTextureWithHexMask(hex);
textureU = worldX * textureScale;
textureV = worldY * textureScale;
```

Recommended visual order:

```ts
renderTerrainBase();          // grass, forest, hills, sand, water
renderTerrainNoiseLarge();    // readable at zoom-out
renderTerrainPatches();       // dry, dense, floral, moss, etc.
renderTerrainNoiseSmall();    // fine microdetail
renderSmallDetails();         // sparse grass, flowers, rocks
renderBiomeBorders();         // soft terrain transitions
renderCoastlineDetails();     // sand/wet sand/water blending
renderHexGrid();              // subtle, never dominant
renderUnits();
renderSelection();
renderUI();
```

Terrain formulas:

- **Grass:** base texture + macro variation + dry patch + dense patch + flower speck patch + very few small details. The grass should feel alive from texture and large patches, not from oversized decorative flowers.
- **Hills:** base texture + macro variation + dry patch + dense patch + micro noise + a few rocks / dry grass. Read as terrain mass and elevation, not repeated little mountains. Ratio: 80% base + macro variation, 15% patches, 5% small details.
- **Forest:** base texture + macro variation + dense forest patch + moss patch + small dark foliage details. Density should come from mass and colour, not hundreds of pasted shrubs.
- **Sand / coast:** sand base + dry/wet sand variation + coastline detail + shallow water transition. Coast should blend `sand -> wet sand -> shallow water -> deep water`; avoid hard cuts unless intentionally stylized.
- **Water:** coastal water is clear cyan/turquoise, deep water is darker blue, river water is medium blue with subtle flow. Water needs continuous texture and visible depth variation.

Zoom-out priorities: small details disappear first, so rely on macro variation, large patches, biome shapes, and controlled colour contrast. Use LOD:

```ts
if (zoom > 0.85) renderSmallDetails();
if (zoom <= 0.85) renderEmbeddedDetailsOnly();
if (zoom <= 0.55) {
  hideSmallDetails();
  renderMacroPatches();
}
```

Small details are final decoration, not the base look. Good starting config:

```ts
const grassSmallDetailsConfig = {
  chancePerHex: 0.16,
  maxPerHex: 1,
  grassWeight: 80,
  flowerWeight: 12,
  rockWeight: 8,
  scale: {
    grass: [0.08, 0.18],
    flower: [0.05, 0.10],
    rock: [0.06, 0.13],
  },
  alpha: {
    grass: [0.35, 0.60],
    flower: [0.30, 0.50],
    rock: [0.35, 0.55],
  },
};
```

Natural scatter rules:

- Details should be smaller, less saturated, lower alpha, integrated into the terrain, and not present on every hex.
- Do not place detail sprites at exact hex centres. Offset inside the hex footprint:

```ts
x = hex.centerX + randomRange(-hexRadius * 0.35, hexRadius * 0.35);
y = hex.centerY + randomRange(-hexRadius * 0.35, hexRadius * 0.35);
```

- Prefer density by zones/chunks instead of `forEach(hex) spawnFlower()`:

```ts
function getDetailDensity(hex) {
  const patchNoise = noise2D(hex.q * 0.08, hex.r * 0.08);
  if (patchNoise > 0.65) return 0.28; // rich zone
  if (patchNoise < 0.30) return 0.08; // clean zone
  return 0.16;
}
```

- Use fixed seeds, never `Math.random()` per frame:

```ts
function getHexSeed(q: number, r: number, worldSeed: number) {
  return q * 73856093 ^ r * 19349663 ^ worldSeed;
}
```

Hex grid guidance:

```ts
renderHexGrid({
  color: "#1b2a13",
  alpha: zoom < 0.6 ? 0.08 : 0.15,
  lineWidth: 1,
});
```

The grid should help orientation, not dominate the art.

Biome borders are required to avoid ugly cuts:

```ts
if (hex.terrain !== neighbor.terrain) {
  drawBorderEdge(hex, dir, hex.terrain, neighbor.terrain);
}
```

Useful border rules:

```ts
const biomeBorderRules = {
  "grass-forest": "soft_dark_green_edge",
  "grass-sand": "dry_grass_to_sand_edge",
  "sand-water": "wet_sand_coast_edge",
  "grass-water": "muddy_water_edge",
  "hill-grass": "soft_hill_blend_edge",
  "forest-hill": "dark_forest_hill_edge",
};
```

Final formula for every terrain: continuous base texture + macro variation + patches + micro noise + sparse small details + biome borders + subtle grid.

## More patterns that paid off

### Z-sort by `TERRAINS[type].height` instead of per-vertex push

Early attempt to make taller hexes visually overhang shorter neighbours pushed each hex's top vertices outward by some `(height − neighbourHeight)` factor. That distorts shared vertices between neighbouring hexes — adjacent hex tops no longer line up at the same point in screen space, and you get a visible double-line / notch artefact along every elevation step.

The fix is conceptually simpler: leave vertices alone, render hexes in ascending-height order. A taller hex's top + walls draw *after* its shorter neighbour, so they cover the neighbour's polygon along the shared edge with no vertex math. The "overhang" is just z-order, not geometry.

Pattern: when "thing A should visually cover thing B," prefer draw-order over geometric trickery. Cheaper, no shared-vertex artefacts, no special cases for 3-way corners.

### `taller-owns` rule for shared-edge strokes

The hex grid is drawn as a single stroke per edge. Naïvely, each hex strokes its own 6 edges → every shared edge gets stroked twice, at slightly different y values when the two hexes have different heights → a visible double line on every elevation step.

Fix: each edge is owned by exactly one hex (the taller; tiebreak by axial-key string compare). Each hex iterates its 6 edges and skips any it doesn't own. Single stroke per edge, at the taller hex's elevation, which is also where the cliff/wall sits — the line reads correctly.

Same pattern applies if you ever add biome border strokes or any other per-edge stroke layer.

## Bugs we caught, and the lessons (continued)

### PIXI v8 filter vertex shader must use `uOutputFrame` / `uInputSize` / `uOutputTexture`

`createWaterFilter` shipped with a vertex shader that did `gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0); vTextureCoord = aPosition;`. That treats `aPosition` as if PIXI gave a full-viewport quad and the input texture as a full-frame sampler. Neither is true in PIXI v8.

PIXI v8's `FilterSystem` allocates each filter pass into a sub-rectangle of a shared framebuffer atlas, and auto-binds three `vec4` uniforms describing that allocation: `uInputSize` (1/width, 1/height of the input texture), `uOutputFrame` (xy = offset, zw = size of the output region in pixels), and `uOutputTexture` (the target texture dimensions, with z encoding flip). The standard `passthrough.vert` (in `pixi.js/lib/filters/defaults/passthrough/`) uses these to map `aPosition ∈ [0,1]` to the correct NDC slice and the correct sampler sub-rect. If you skip them, the quad covers the full viewport and the sampler reads from corner to corner of the atlas — wherever the actual content sits in the atlas, you get something else (typically the cleared atlas background, a single uniform color).

Visible symptom in this codebase: the `DEEP_SEA` and `SEA` overlays — each a `TilingSprite` in a `Container` clipped by a hex-union `Graphics` mask — rendered as a flat rectangular blob inside the hex-shaped mask boundary, instead of the tiled noise texture they were supposed to show. The mask was clipping correctly; the filter was producing garbage that happened to read as a constant color, so the clipped region looked uniform. Confirmed by side-by-side screenshots before/after replacing the vertex shader with the canonical PIXI v8 pattern.

Lesson: when you write a custom PIXI v8 filter, copy `passthrough.vert` first and only modify the fragment. The vertex shader is essentially boilerplate that translates aPosition into the filter's allocated region — getting it wrong silently corrupts the output for any filter applied to anything smaller than the viewport. The bug had been live for the entire history of the water rendering and was only caught when a regenerated world happened to produce a large enough sea region for the flat-color rectangle to be visually obvious.

### Hover-highlight stale-closure bug, surfaced by the canvas split

The PIXI ticker was registered inside the mount-only `useEffect([])` and called `updateHighlights()` directly. `updateHighlights` was redeclared on every render and read React state (`hoveredHex`, `gridData`, `isScanning`) by name. Because the ticker captured the mount-time identity of the function, it kept calling the original closure forever — the one that saw `hoveredHex === null` and returned early. **Hover highlighting was silently doing nothing for the entire history of the project.** No one noticed because the cursor-crosshair cue made it feel responsive enough.

Surfaced during the Phase 7 split of `GameCanvas.tsx` into hooks: pulling the ticker registration into `usePixiApp` forced the closure boundary to become explicit. The fix is the standard "current-ref" pattern — a sibling `updateHighlightsRef` synced to the latest function via a no-dep `useEffect`, and the ticker calls `ref.current()` instead of the captured closure.

Lesson: when a long-lived callback (`app.ticker.add`, `setInterval`, `window.addEventListener` set in a mount-only effect) calls a function defined alongside it in the same component, that call is frozen to the first render unless you route through a ref. The eslint rule that should have flagged the stale closure is `react-hooks/exhaustive-deps`. The mount-only effect had a `// eslint-disable-next-line react-hooks/immutability` directive on it (which IS a real rule — the React Compiler immutability check fires when you assign to `ctx.someRef.current` from inside a hook-argument object, even though that's exactly what `useRef` exists for). That suppression covered a different complaint, not the stale closure. The fix had to come from a refactor (current-ref pattern), not from any lint warning. Be suspicious of any `eslint-disable` in a long-lived effect: it may be silencing one real rule but leaving an unrelated bug exposed.

### PIXI v8 `Color.multiply(number)` is a hex-int bit-shift, not a scalar multiply

```ts
PIXI.Color.shared.setValue(0xC0C0C0).multiply(0.7).toNumber()
// → 0  (BLACK)
```

`Color.multiply` expects an RGBA-normalised array `[r, g, b, a]` (each in 0..1). Passing a bare number treats it as a hex integer that gets bit-shifted into channels — `0.7 | 0 === 0`, so every channel multiplies by 0, every wall renders black.

Fix:

```ts
.multiply([shade, shade, shade, 1]).toNumber()
```

Bit us hard: the 2.5D walls rendered as black slabs across the entire map until a code-review agent flagged this with 97% confidence. The TS type accepted both forms, so the compiler didn't catch it.

Lesson: when a PIXI v8 API takes "a colour-like thing," check whether bare scalars round-trip through `Color` the way you expect. The bit-shift dispatch on `number` is easy to miss if you're used to a "tint" or "modulate" call from another engine that does take scalars.

### Per-polygon UVs vs world-space UVs — the per-hex repetition trap

`PIXI.Graphics.fill({ texture, matrix })` normalises UVs to the *polygon bounding box*. Every hex draws the same patch of the source texture, stretched to its bbox. A map of textured grass hexes shows the same tile in every cell — visually like wallpaper.

The fix is `TilingSprite` + hex-shaped `Graphics` mask. The tile sprite has a single world-space coordinate origin; tiling repeats over world coordinates; the mask clips the visible region to the hex shape. Neighbouring hexes see *different* patches of the same continuous texture, so the result reads as one large landscape, not many identical stamps.

Cost: one `TilingSprite` + one mask `Graphics` per biome (per layer for chunked patches), instead of `Graphics.fill` per hex. For ~1000 hexes this is fewer draw calls, not more.

Lesson: bbox-normalised UVs are correct for "this single polygon shows this texture" (an icon, a sprite). They're wrong for "many polygons sample the same world-space pattern." Pick the right primitive based on whether the texture should follow the polygon or the world.

### Wall extends to base + dark shade = "dark wedge between biomes"

Each 2.5D side wall drew from the hex's elevated top down to absolute base (`y - 0`). With the render order *ascending height*, the taller hex's wall was drawn *after* the shorter neighbour's top fill — meaning the wall painted *over* the shorter neighbour's top in the region where the wall extended below the shared edge.

For FOREST (h=18) over GRASSLAND (h=12): 6 px of "visible cliff" between the two tops (correct), plus 12 px of wall protruding *into* the grass polygon below the shared edge (wrong, looks like a dark green slab). With shade `0.55 × forest_base_color`, the wall reads as near-black — the "dark wedge" complaint.

We tried two fixes and walked into the same trap twice:

1. **Clamp wall bottom to neighbour's top** (`neighborH = sH` so wall stops at the shorter neighbour's elevation). Works for a single edge. *Breaks at 3-way corners*: when a hex's three lower neighbours have different heights, the wall's bottom corners end at three different y values, so adjacent walls of the same hex don't meet at the shared bottom vertex — vertical slot gaps appear at every 3-way corner.

2. **Extend wall fully to base, let the shorter neighbour's overlay clip the protrusion**. The overlay container already draws after `terrainGfx`, so its mask should clip the wall in the shorter neighbour's polygon footprint. The visible 6-px cliff above the shared edge is still painted as a dark shaded wall (the dark wedge persists, just narrower).

The real fix: **move the cliff face into the taller biome's overlay mask** as part of the textured surface, and remove the wall entirely for textured biomes. Each base-biome layer's mask now includes the hex top polygon *plus* a quadrilateral per shorter neighbour spanning from the hex's top edge down to the neighbour's top edge. The biome's `TilingSprite` paints continuous texture over both the top and the cliff face. No dark shade. No `neighborH` clamp. No 3-way corner gap (the mask is a 2D region — corners just close cleanly).

Non-textured biomes (`SAND`, `RIVER`, `SEA`, `DEEP_SEA`, `ROCKY`) still draw shaded walls in `terrainGfx`, since they have no overlay to extend.

Lesson: "draw a wall and hope something clips it later" is fragile. If the surface and the cliff are both meant to *be* the same biome material, render them together as one continuous masked region. The overlay mask doesn't have to follow the hex polygon — it can be the hex polygon *plus whatever cliff faces belong to this biome*.

### Cliff geometry: matching vertex pairs share an x, differ in y by `Δheight`

For flat-top hexes, the taller hex's S/SE/SW top edge vertices and the shorter neighbour's matching N/NE/NW top edge vertices have *the same x*, with `y_short = y_tall + (h_tall − h_short)`. That makes the cliff quad trivial to build:

```ts
const dh = hexH - neighborH;
mask.poly([
  topV[v1].x, topV[v1].y,            // top edge corner 1 (taller)
  topV[v2].x, topV[v2].y,            // top edge corner 2 (taller)
  topV[v2].x, topV[v2].y + dh,       // bottom edge corner 2 (shorter)
  topV[v1].x, topV[v1].y + dh,       // bottom edge corner 1 (shorter)
]).fill({ color: 0xffffff });
```

Edge → axial direction mapping (flat-top, vertex i at angle 60°·i):
- `v0–v1` (SE edge) → `directions[0]` = `(+1, 0)` SE neighbour
- `v1–v2` (S edge)  → `directions[5]` = `(0, +1)` S neighbour
- `v2–v3` (SW edge) → `directions[4]` = `(−1, +1)` SW neighbour

Worth saving — every edge/direction question in this codebase wants the same six lines.

## Scope of the branch

This worktree took `hex-tactics` from "two coordinate systems and a noise-based world generator" to a working tactical battle sandbox:

- A pure `simulateTick(units, orders, config) → newState` battle engine (`src/battle/simulate.ts`).
- Five motion modes: `march`, `charge`, `retreat`, `unleash`, `defendHeight` — each with its own discipline for advance/block/spread.
- Group-based command system: assign units to G1/G2/…, issue ATTACK/CHARGE/RETREAT/UNLEASH/DEFEND per group.
- Team-tinted rendering: sprite per team (Roman legionary, Greek hoplite), cluster perimeter outline, HP bars, lieutenant ★, attack-target ring.
- Zoom-aware level-of-detail (LOD): far zoom swaps soldier sprites for a solid team-colored hex token.

## Architecture decisions worth keeping

### 1. The sim is pure; everything else mirrors via refs

`simulateTick` takes `(units, orders, config)` and returns new state. No globals, no closures over React state, no side-channels. That's why `scripts/sim-formations.ts` works at all — you can replay any scenario from a clean input.

The corollary in `GameCanvas.tsx`: long-lived PIXI handlers (`pointerdown`, ticker callbacks) close over **refs**, not state. State that handlers need to read is mirrored into a ref via `useEffect`. See `isScanningRef`, `noiseOffsetRef`, `inputModeRef`, `worldRef`, `gridDataRef`, `armiesRef`. When you add new state that the long-lived handlers read, mirror it. Don't re-register handlers per render.

### 2. Order = player intent + transient sim state, mixed

`GroupOrder` carries player intent (`attackTarget`, `heading`, `hold`, `mode`, `defendTerrain`, `defendFrom`) AND transient sim state (`chargeTicksRemaining`, `chargeDamagedIds`, `defendAssignments`). The sim returns a (possibly mutated) orders map from each tick.

The mix is convenient now and a serialization debt later — see PLAN.md F7. When save/load comes, you'll want to split these into "command" and "scratch".

### 3. The dive mechanic is a noise-coordinate trick

Strategic ↔ tactical isn't two separate maps. It's the same procedural noise field re-sampled at a different resolution + offset. A click captures the hex's noise-space coordinates and the next view samples exactly that patch:

```
targetOffsetQ = (hex.q + currentOffset.q) * DIVE_ZOOM
resolution    = currentResolution * DIVE_ZOOM
```

Infinite worlds, no level data, same procgen function for both views. Cheap and elegant.

## Patterns that paid off

### Sticky assignment to kill oscillation

The defend-formation algorithm assigns each unit to a specific blob hex via a global pairing pass. Without sticky storage, the pairing re-runs every tick and the projected slot can shift as units move — units oscillate between two assignments forever.

Fix: `commitDefend` computes the assignment ONCE and stores it as `order.defendAssignments: Record<string, Hex>`. The tick loop reads from this stored map (sticky path) instead of re-pairing. Falls back to re-pair only on the legacy first-tick-without-commit path.

When you add a new mode that needs per-unit slot pairing, do the same: compute once at activation, store on the order.

### Lateral fallback to break ally jams

Greedy "step closer to target" gets stuck when allies block all closer-distance neighbors. The lateral fallback tries SAME-distance neighbors that aren't the unit's previous-tick position (anti-backtrack). It's how dense formations un-jam.

Pattern lives in:
- `defendHeight` tick (`simulate.ts:1136-1158` ish) — `prevTacticalHex` anti-backtrack.
- `unleash` tick — same idea for crowd-spread to targets.

### Spatial-order iteration for per-unit advance

`march` and `retreat` are rigid blocks: validate every unit's projected hex, then commit all-or-nothing. Order of iteration doesn't matter because the validation phase precedes any mutation.

`charge` and `unleash` advance per-unit. Naive iteration over the group array means **a rear unit can be blocked by a forward ally that hasn't moved yet this sub-step** — straggler behavior becomes array-order-dependent instead of spatial. Fix: sort by projection along the move direction, descending. Forward-most moves first, vacates its hex, rear ally finds it empty.

See `simulate.ts:980-1015` (charge spatial-order sort). If you add another per-unit move mode, do this.

### `.label` tags + ticker visibility toggling for LOD

PIXI v8 `Container.label` is a first-class property on all display objects. We use it as a cheap "layer membership" tag:

- `'unit-sprite'` — close-zoom soldier
- `'unit-marker'` — far-zoom team-tinted hex
- `'unit-detail'` — HP bar, ★, arrow, attack-target ring (also hidden at far zoom)

Per-frame `app.ticker` reads `world.scale.x`, computes `isFar = scale < LOD_THRESHOLD`, and toggles `.visible` on labeled children. A `lastLodFar` boolean caches the threshold state so the iteration only runs on crossings.

Important: read `world.scale.x` directly, NOT `zoom.current`. `gsap` mutates `world.scale` during the dive animation without touching `zoom.current`, so LOD should follow the live scale.

## Bugs we caught, and the lessons

### `(6 - k) % 6` — vertex/direction index mismatch

The hex-top vertex angles in `drawUnits` go `60*k - 30` degrees (k=0..5). Edge k is the segment from vertex k to vertex (k+1)%6. Vertices go CLOCKWISE in screen coordinates (y-down).

`HexUtils.directions` runs E → NE → NW → W → SW → SE (indices 0..5). The compass directions go COUNTERCLOCKWISE in screen coordinates.

So edge k faces direction (6 - k) % 6, NOT direction k. Only edges 0 (E) and 3 (W) coincidentally align.

The bug: a "this edge is shared with the neighbor at `HexUtils.directions[k]`" assumption produced an outline that traced INTERIOR cluster edges instead of the perimeter. The fix is one character of arithmetic — but the false premise sat in three places (the loop, two comment blocks). Lesson: when you spot a same-index assumption between two arrays whose ordering origins differ (one defined geometrically, one defined arbitrarily), derive the mapping rather than assuming it.

### Redundant guards in charge ally-blocking

```ts
if (occupant && !groupIds.has(occupant.id)) continue;  // enemy blocks
if (occupant && groupIds.has(occupant.id)) continue;   // ally blocks
```

Together = `if (occupant) continue`. The two cover all `occupant` states. A reviewer flagged "just delete the second line" — but that creates a worse bug (two units stack on one hex when the rear ally steps onto the forward ally's hex before the forward ally has moved).

The real fix is the spatial-order iteration above. The guards then simplify to `if (occupant) continue` — correctly meaning "any occupant blocks, and rear units only check after forward allies have moved."

Lesson: when a reviewer's literal recommendation feels off, treat their **diagnosis** as gold but redesign the fix. The diagnosis (iteration-order-dependence) was exactly right; the prescribed action (drop a guard) would have broken occupancy invariants.

### Overlays escape LOD

The first LOD pass tagged sprite and marker. The HP bar, lieutenant ★, heading arrow, and attack-target ring were UNTAGGED, so the ticker ignored them. At far zoom these floated over the colored marker blob — defeating the "clean army token" intent.

Lesson: when you introduce a layer-toggle mechanism, decide upfront which child types belong to which layer. Untagged means "always on" — that's a default, not an opinion. We added a `'unit-detail'` tag for the always-hide-at-far-zoom set.

### Surplus units stack when N > blob.size

The defend formation algorithm took `formation = allSlots.slice(0, liveUnits.length)`. When `liveUnits > blob.size`, formation = blob.size and the surplus had no `assignment` entry. In the tick: `if (!target) continue;` — surplus stood still where they were placed.

Symptom: 58 units defending a 25-hex blob → ~33 units never move. Looks like the formation is "broken" or "clustering on one side"; really half the army got no orders.

Fix: continue the rank BFS **outside** the blob into walkable non-`defendFrom` hexes when surplus exists. Back-rank columns form behind the segment (in safe terrain). Movement constraint widens from `blob.has(...)` to `rank.has(...)` — "stay within the formation footprint" rather than "stay on home terrain."

Lesson: any algorithm whose output size scales with one input but whose demand scales with another input needs an explicit overflow strategy. "Truncate silently" almost always reads as a bug.

### Mipmap is one-line, LOD is a design choice

At far zoom, PIXI's default sampling minifies a 1024×1024 sprite to 30 screen-pixels by picking one source pixel out of every ~12. Result: shimmer + aliasing.

Mipmaps (`source.autoGenerateMipmaps = true`, then `updateMipmaps()`) pre-build a chain of pre-downscaled levels. The GPU picks an appropriate level and bilinear-filters within it. Combined with `scaleMode = 'linear'` (which sets all three of magFilter, minFilter, mipmapFilter to linear), you get trilinear filtering: smooth at any zoom.

But mipmap alone doesn't solve "145 tiny pixelated soldiers read as a smear." At extreme zoom-out, no amount of filtering makes individual soldier features legible — they shouldn't be drawn at all. That's LOD's job. The two are complements, not alternatives.

### Render groups + nested filters/masks: verify off-center, not just centered

`world.enableRenderGroup()` moves the panned/zoomed world transform onto the GPU (pan/zoom no longer re-walks every descendant's world transform on the CPU). It's a near-free win for a big static scene — but it interacts with two things already living *inside* `world`: the water displacement filters (on the `deepSea`/`coastal` containers in `terrainOverlay`) and the per-biome hex masks. Filters + Graphics masks nested inside a render group is a combination with open bugs in the PIXI v8 line (#11577, #11607) where a filter's output frame / viewport can get computed relative to the render-group root instead of the screen — which makes the filtered content (here, the animated water) offset or vanish, but **only once the world is translated away from the origin or pushed to an extreme zoom**.

The trap: a smoke test that just loads the page checks the world at its initial transform, where the render-group viewport and the screen happen to coincide — so the bug is invisible. To actually rule it out you must **pan the world far off-center and zoom to both extremes (≈0.05× and ≈6×)** and confirm the water is still present, masked to its hexes, correctly positioned, and animating. We did, and the water shader (which maps via the canonical `uOutputFrame`/`uOutputTexture` uniforms — see `water-filter.ts`) holds up; but the next person who adds a filter under `world` should re-run that off-center check, not trust a centered screenshot.

Related: `cacheAsTexture` was deliberately *not* used to batch the static terrain/details. It rasterizes at the current resolution, and this world zooms freely 0.05×–6×, so a cache either blurs when you zoom in past it or — at HiDPI resolution over the whole `gridRadius=35` map — produces a texture near/over the 8192px GPU limit. The render group captures most of the CPU-transform benefit without rasterizing, so the scene stays vector-sharp at every zoom.

### Render groups don't flush GSAP-animated CHILD transforms per frame — so we removed it

**Update: `world.enableRenderGroup()` was ultimately removed.** The off-center/filter check above passed, but a render group has a second, worse interaction we only caught once a real battle ran: it breaks the smooth per-frame motion of anything inside it that you animate with GSAP.

A render group caches its draw-instruction set and re-uploads a child's transform only when the group **rebuilds** (on a structural change — child added/removed/reordered). Our unit containers and dust particles move by GSAP mutating `container.position` **every frame**, but the group only flushes those transforms to the GPU when it rebuilds — which here happens ≈once per tick (the attack-ring churn in `drawUnits` adds/removes children each tick). Net effect: units **jump once per tick instead of gliding per frame** — they look stuck between ticks, then teleport to the tween's advanced position. Pan/zoom and the dive tween were fine (those animate `world` itself — the group *root* — not a child), so a check that only exercised those missed it. It only showed when units marched in battle.

Rule of thumb: **do not put GSAP-per-frame-animated objects inside a render group.** A render group is for a subtree whose internal transforms are static (or change only structurally) and that you move/scale as a unit. Our `world` is panned/zoomed as a unit, but it *contains* per-frame-animated children, so it's disqualified. The CPU-transform win wasn't worth it anyway: the per-tick ring churn already forced a rebuild every tick.

(Same reason the FX/dust containers must NOT be render groups either — the dust is GSAP-animated, so isolating it in its own group would freeze/teleport the particles.)

### A GSAP tween on a PIXI child must be killed before destroy — or it crashes the whole tween pass

A surviving GSAP tween whose target was destroyed is not a quiet leak — it's an exception **every frame**. After `container.destroy()`, PIXI nulls the object's fields, so GSAP's next rAF update does `target.y = …` on `null` and throws. Critically, **one uncaught throw inside GSAP's rAF tick aborts that tick's entire tween pass**: every *other* unit's position tween stops updating for that frame, then jumps to its caught-up value next frame. So the symptom is **stutter / "teleport," not a leak and not an FPS drop** — and it scales with churn (the more units dying/spawning, the more orphaned tweens, the more frames get aborted).

The trap is that killing tweens on the container + its `position` is *not enough* if you also animate a CHILD. Our melee lunge tweens the `unit-sprite` child, so destroying a unit mid-lunge (e.g. attrition deaths while many units march) orphaned that child's tween. Every destroy path must kill the container, its `position`, AND every child's tweens (`position`/`scale` too):

```ts
const killUnitTweens = (cont) => {
  gsap.killTweensOf(cont); gsap.killTweensOf(cont.position);
  for (const ch of cont.children) { gsap.killTweensOf(ch); gsap.killTweensOf(ch.position); gsap.killTweensOf(ch.scale); }
};
```

Apply it in *all* teardown paths (per-unit death, destroy-all on view change, AND the unmount cleanup), and guard get-or-create against a destroyed container left in a map (`if (cont?.destroyed) recreate`). Debugging tip: this presents as a perf problem ("everything stutters with many units") but the console TypeError (`Cannot set properties of null (setting 'y')` from a rAF) is the real tell — check the console before chasing frame budgets.

## Gotchas worth remembering

- **Pointer events on `world.scale`**: gsap mutates `world.scale.x/y` directly during the dive animation. `zoom.current` is NOT updated mid-animation. Anything that needs the live zoom must read `world.scale.x`, not the ref.

- **PIXI v8 vs v7**: `.label` replaced `.name`. `Texture.source.scaleMode = 'linear'` is a setter that ALSO sets `mipmapFilter` to linear — there's no separate trilinear toggle.

- **`updateMipmaps()` call**: setting `autoGenerateMipmaps = true` AFTER `Assets.load` requires calling `updateMipmaps()` to force regeneration. If you set the flag in the texture's initial options at load time, you wouldn't need this.

- **The cluster outline only draws perimeter edges**: edge k is skipped if the neighbor in direction `(6 - k) % 6` is a same-team ally. Interior edges between allies have no outline. If you add a new "render an outline" feature, follow this pattern — overlapping hex outlines look terrible.

- **`onFormation` (defend) vs `onBlob`**: the defend tick check was renamed from `onBlob` to `onFormation` when the rank BFS was extended outside the blob. `onFormation` means "the unit is currently on a ranked hex (blob OR back-rank extension)." Units only constrained to stay in formation if currently in formation; outsiders march in freely.

- **The defend formation algorithm has 6 distinct steps**: blob BFS → border filter (by `defendFrom`) → segment BFS from anchor (barrier-aware) → rank BFS (now including back-rank extension when surplus exists) → perimeter walk for rank-0 slotIndex → slotIndex inheritance for deeper ranks → sort allSlots by (rank, slotIndex, key) → pair sorted units to first-N slots. If you're modifying this, do one step at a time; the interactions are tricky.

## Victory points & scoring (`feature/systems`)

The win condition changed from a single "hold the centre" tug-of-war to a victory-points race (`src/battle/scoring.ts` pure `scoreTick`, tunables in `src/data/scoring.json`): a living unit reaching the **enemy** deploy zone scores a point and a unit holding the centre uncontested accrues points per tick; first team to `pointsToWin` (default 100) wins. Two non-obvious things came out of it.

### "No units on the field" is not a loss — raid-and-return makes it normal

A unit that reaches the enemy back line doesn't just score; it **leaves the field and returns to that team's roster** (raid & return — `scoreTick` puts it in `reachedUnitIds`, the tick filters it out of `survivors`, and `setRosters` adds it back). So a team can legitimately have zero units on the map mid-battle while sitting on a full roster, about to redeploy. The old annihilation fallback ("one team has no units left → declare the other the winner") therefore became actively wrong — it would call a winner during a routine raid lull. We removed it: **victory is points-only.** A stalemate (neither side reaching the threshold) just continues; the player pauses/resets. Lesson: when you add a mechanic that makes a unit legitimately vanish from the board, audit every "board is empty / one side is empty" terminal check — they were written assuming presence-on-board equals alive-in-game, and that equivalence no longer holds.

### Single-scoring relies on a sub-`TICK_MS` React-flush timing invariant

The tick reads its units from `armiesRef.current`, but `armiesRef` is only ever written by the async mirror effect (`useEffect(() => { armiesRef.current = armies }, [armies])` in `GameCanvas.tsx`). A reached unit is removed only via `setArmies(survivors)` — also async. Meanwhile `scoreRef.current` is updated **synchronously** in the tick. So the no-double-count guarantee rests entirely on React committing the `setArmies` update *and* running the mirror effect within one `TICK_MS` window (500 ms): if two interval callbacks ever ran before the flush, the same unit would still be in `armiesRef`, sit in the enemy zone again, and score a second time (score advances synchronously, board lags). At 500 ms ticks this never happens, and it's the same `setArmies → armiesRef` removal path that `retreat` already relies on safely — but it's load-bearing and silent. There's a WHY comment at the `survivors` filter in `useBattleTick.ts` flagging it. Lesson: when correctness depends on an async state-setter winning a race against a timer, and a sibling ref updates synchronously, the asymmetry is a real invariant — document it at the site, or a future "let's lower the tick interval" / "let's batch differently" change silently reintroduces the bug.

### GSAP: never destroy a PIXI object inside one tween's `onComplete` while a sibling tween on it is still queued

Movement dust ran three independent tweens per sprite — `alpha`, `scale`, and a `move` tween whose `onComplete` did `dust.destroy()`. They normally complete on separate frames, so by the time `move` finishes the others are long done. But in any frame long enough to complete more than one at once (a GC pause, a heavy combat frame, or a tab whose rAF is being throttled), GSAP renders them all in a single tick. Tween creation order is `alpha, move, scale`, so within that tick GSAP renders `move` → its `onComplete` destroys the sprite (PIXI nulls `sprite.position`) → GSAP then renders the still-queued `scale` tween → the `dust.scale` / `.y` setter hits the null position → **`TypeError: Cannot set properties of null (setting 'y')` thrown inside GSAP's `_tick`**. That throw aborts the *entire* tween pass for the frame: every unit's position tween stops (units freeze), then jumps on the next good frame (teleport), and FX `onComplete` cleanup stops firing so dust piles up and compounds the lag. Same failure class as the unit-sprite version (kill child tweens before `destroy`), but the trigger here is sibling tweens on the *same* object, not a stale tween across a destroy.

Fix: give each FX object a single `gsap.timeline()` holding all its sub-tweens and destroy in the **timeline's** `onComplete` — it fires only after every child is done, so the target is never destroyed while a sibling is still pending. Rule: if an object has multiple concurrent tweens and one of them destroys it, that's a latent rAF-throw; co-own them in one timeline (or destroy outside the tick). A cleanup created *last* (e.g. a separate `gsap.delayedCall` after all the element's tweens, as `meleeFx` does) is safe because it renders after its siblings in the same tick.

### Diagnosing render perf under Playwright: rAF is throttled, timers are not

Driving the app with the Playwright MCP, a battle looked frozen at ~1 FPS — `requestAnimationFrame` fired ~once per ~1000 ms and GSAP-driven FX never drained, which looks exactly like a render death-spiral. It isn't. The controlled browser window isn't the OS-foreground window, so Chromium throttles rAF (and therefore PIXI's ticker and GSAP) to ~1 Hz **even though `document.visibilityState` is `visible` and `document.hasFocus()` returns `true`**. Give-aways: an exactly-`1000 ms` rAF gap, and the decisive check — run a `setInterval(…, 50)` alongside an rAF counter; the timer fires its full ~32/1.6 s (thread is healthy) while rAF fires ~1–2 (only the frame loop is throttled). With rAF clamped, GSAP's `lagSmoothing` makes tweens crawl, so any "FX leak / 1 FPS / freeze" measured under Playwright is a tooling artifact, not the game. Lesson: you can't measure real frame-rate or animation smoothness through Playwright — use it to drive state and read the **console** (thrown errors are real), and confirm smoothness on a real foreground window.

## Known limitations (deferred — see PLAN.md)

- Combat depth (F1): one-line damage formula. No unit types, no flanking, no terrain modifiers, no morale. Roman vs hoplite is cosmetic only.
- No enemy AI (F2): `<` swap is the only way to play both sides. Game can't be played solo against a challenge.
- `GameCanvas.tsx` size (F3): ~1800 lines after all this work. Needs a split.
- No automated assertions in `sim-formations.ts` (F4): the harness prints; humans verify.
- ~~O(N²) gridData lookups in render paths (F5): trivial to index as `Map<key, tile>`.~~ **Done** (`feature/hexgrid-fixes`) — see "Derive once per `gridData`, not once per consumer" below.
- Movement deadlocks in pathological cases (F8): two units blocking each other's exact targets — no A* fallback.
- No save/load/replay (F9): the pure sim makes this cheap but it isn't built.

## File responsibility map

- `src/main.tsx`, `src/App.tsx`: trivial bootstrap.
- `src/components/GameCanvas.tsx`: everything visual + input + state. ~1800 lines. World gen, PIXI bootstrap, terrain draw, units draw, input modes, HUD, tick driver.
- `src/battle/simulate.ts`: pure sim. `simulateTick`, `computeDefendFormation`, the 5 motion-mode branches, combat phase.
- `src/hex-engine/HexUtils.ts`: axial hex math. Pointy-top, size=40, 111 lines, stable.
- `scripts/sim-formations.ts`: manual test harness. Prints scenario results for visual inspection.
- `PLAN.md`: prior architectural review with prioritized recommendations.

## Group seal/fill: derive the state, don't store it (`feature/systems`)

The "groups seal when they march, free up when empty or back home" rule (4-group cap, single auto-fill pointer) is tempting to implement as a `sealedGroups` set you mutate on march and clear in the tick loop. Don't. That path has two traps: (1) a **march-moment race** — the instant you issue the march order, units are still standing in the deploy zone, so a position-based "all units home → unseal" check in the tick loop immediately un-seals the group you just sent; (2) ongoing bookkeeping that has to be reset, kept in sync with React, and reconciled with order-clears (Backspace, redeploy).

Instead derive it from state you already have:

```ts
sealed(g) = liveCount(g) > 0 && (hasActiveAdvanceOrder(g) || someUnitOutsideDeployZone(g))
active    = unsealedGroupWithUnits ?? lowestUnsealedGroup ?? null
```

`hasActiveAdvanceOrder` (attackTarget set, mode ≠ idle/hold) seals **immediately** on march with no race — units haven't moved yet but the order is already advance-mode. The position term keeps a committed group sealed while it's out on the field even under hold/idle. The empty case (`liveCount === 0`) and the redeploy case fall out for free: the sim already **blanks the order** (`attackTarget: null`) when every living unit lands back in its deploy zone (`simulate.ts` retreat branch), so a redeployed group has no active advance order and no unit outside the zone → unsealed. One pure predicate, computed both in `GameCanvas` (for the HUD's 🔒/▶ markers, via `useMemo`) and in `paintMode.paintPlace` (to pick the fill group) — no stored state, nothing to reset.

Keep this **separate** from the per-battle `marchedGroups` cost flag. Sealing is about *placement* (toggles as the group leaves/returns/empties); `marchedGroups` is about *CP cost* (first march costs double, never un-set until battle reset). A recycled slot re-marches at normal cost precisely because the two concepts don't share storage.

## Render perf pass (`feature/hexgrid-fixes`)

### A PIXI `Filter` must be created once and reused — recreating it per draw recompiles a `GlProgram` and leaks the old one

The terrain rebuild (`drawTerrain`) destroys and recreates the whole overlay hierarchy each call. The two animated water filters were being recreated alongside it — `createWaterFilter(...)` inside the per-draw `ensureWaterParent`. Each `new PIXI.Filter({ glProgram: new PIXI.GlProgram(...) })` compiles a fresh shader program on first use, and the *previous* filter's program is never freed (a `Container.destroy()` does **not** dispose the filters attached to it in v8). So every regenerate-world / dive / GRID-toggle quietly stacked another compiled GL program. The fix: cache one handle per kind (`deepSea` / `coastal`) for the app's lifetime in the same `ctx.waterFilters` array the ticker already walks for `uTime`, and reassign `parent.filters = [handle.filter]` to each freshly-built container. A filter object is happily shared across containers and across rebuilds; only the *container* is disposable. One subtlety: before destroying the old water-parent containers, null their `.filters` so the shared filter isn't pulled along by anything that *does* cascade. The general rule: filters (like baked textures) live on the app, not on the per-frame display objects — never construct one inside a function that runs more than once.

### Derive once per `gridData`, not once per consumer — a 1-entry identity cache (closes F5)

Several hot paths each rebuilt the same `Map<key, type>` / deploy-zone `Set` from `gridData` from scratch: the battle tick (every 500 ms), `drawUnits` (every tick), the order-drag preview (every pointer frame, with an O(n) `gridData.find` *per formation slot* on top). `gridData` is a stable array reference that only changes on world regen, so the derivations are pure functions of its identity. `constants.ts` now owns a 1-entry cache keyed on that identity — `terrainMapFor` / `gridKeySetFor` / `deployZoneFor` all call `ensureGridCache(gridData)`, which rebuilds only when `gridData !== cached`. `deployZoneFor` kept its old signature, so it's a drop-in everywhere (GameCanvas `useMemo`, the tick, drawTerrain) and they all now share one build. Two guard rails make the shared-mutable-cache safe: the returned `Map`/`Set` are **read-only by contract** (no caller mutates them — they only `.get`/`.has`), and a single entry is enough because no two *different* `gridData` arrays alternate within a frame (strategic vs tactical are distinct phases, never interleaved). The `useBattleTick` interval is created once (stable effect deps), so a closure-local cache would also have worked there; centralizing in `constants.ts` lets the render and drag paths share the same build instead of each keeping its own.

## The AI must obey the same group rule as the player — and a `hold` in the deploy zone does NOT seal (`feature/systems`)

The enemy AI's deploy planner laid out all four groups at once (one per lateral band) and reinforced every group every tick, with no notion of the player's seal/fill rhythm. Making it follow the player rule (`activeFillGroup` / `isGroupSealed`, now in the pure `src/battle/groups.ts` so the AI can import them without a battle→canvas cycle) exposed two non-obvious traps:

1. **`isGroupSealed` is order-or-position based, and `hold` is explicitly NOT a sealing order** (the predicate excludes `mode === 'idle' | 'hold'`). So a group massed at the start line that the utility scorer puts on `hold` stays *unsealed* — it never frees the fill pointer, and the AI piles its whole army into one group forever. The fix isn't to change the seal rule; it's that a group **still entirely inside its deploy zone must keep an advance order (march), never `hold`** — an advance is the only thing that both seals it and walks it out of the zone, after which the position term keeps it sealed and the full scorer (charge/hold/retreat) can take over. "Mass, then *march* out, then think" — holding at the start line is a deadlock, not a tactic.

2. **The commander's role-assignment cadence starved fresh groups.** Roles were reassigned only every `commanderCadence` ticks (or when the map was empty). A group that just massed had no role until the next cadence tick — up to 12 ticks of a full group sitting idle in the zone before it could launch. Fix: also refresh the moment any non-empty group lacks a role. A cadence is fine for *re-evaluating* existing roles; it must not gate *first* assignment.

Separately, a testing trap from the same change: `test-ai-battle` asserted `hard.placements >= easy.placements` (cumulative units deployed over a battle) as the difficulty→force-scaling check. That metric is dominated by how fast the battle hits `POINTS_TO_WIN` (similar for both difficulties), not by force scale — so a legitimate behavior change flipped a 3 % margin. The deterministic difficulty signal is **peak standing force on the field** (tracks `forceTarget` 16 vs 32), not lifetime placements. When an integration assertion is really measuring "ends at the same score cap," it isn't testing what its name claims.
