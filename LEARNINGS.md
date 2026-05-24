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

## Gotchas worth remembering

- **Pointer events on `world.scale`**: gsap mutates `world.scale.x/y` directly during the dive animation. `zoom.current` is NOT updated mid-animation. Anything that needs the live zoom must read `world.scale.x`, not the ref.

- **PIXI v8 vs v7**: `.label` replaced `.name`. `Texture.source.scaleMode = 'linear'` is a setter that ALSO sets `mipmapFilter` to linear — there's no separate trilinear toggle.

- **`updateMipmaps()` call**: setting `autoGenerateMipmaps = true` AFTER `Assets.load` requires calling `updateMipmaps()` to force regeneration. If you set the flag in the texture's initial options at load time, you wouldn't need this.

- **The cluster outline only draws perimeter edges**: edge k is skipped if the neighbor in direction `(6 - k) % 6` is a same-team ally. Interior edges between allies have no outline. If you add a new "render an outline" feature, follow this pattern — overlapping hex outlines look terrible.

- **`onFormation` (defend) vs `onBlob`**: the defend tick check was renamed from `onBlob` to `onFormation` when the rank BFS was extended outside the blob. `onFormation` means "the unit is currently on a ranked hex (blob OR back-rank extension)." Units only constrained to stay in formation if currently in formation; outsiders march in freely.

- **The defend formation algorithm has 6 distinct steps**: blob BFS → border filter (by `defendFrom`) → segment BFS from anchor (barrier-aware) → rank BFS (now including back-rank extension when surplus exists) → perimeter walk for rank-0 slotIndex → slotIndex inheritance for deeper ranks → sort allSlots by (rank, slotIndex, key) → pair sorted units to first-N slots. If you're modifying this, do one step at a time; the interactions are tricky.

## Known limitations (deferred — see PLAN.md)

- Combat depth (F1): one-line damage formula. No unit types, no flanking, no terrain modifiers, no morale. Roman vs hoplite is cosmetic only.
- No enemy AI (F2): `<` swap is the only way to play both sides. Game can't be played solo against a challenge.
- `GameCanvas.tsx` size (F3): ~1800 lines after all this work. Needs a split.
- No automated assertions in `sim-formations.ts` (F4): the harness prints; humans verify.
- O(N²) gridData lookups in render paths (F5): trivial to index as `Map<key, tile>`.
- Movement deadlocks in pathological cases (F8): two units blocking each other's exact targets — no A* fallback.
- No save/load/replay (F9): the pure sim makes this cheap but it isn't built.

## File responsibility map

- `src/main.tsx`, `src/App.tsx`: trivial bootstrap.
- `src/components/GameCanvas.tsx`: everything visual + input + state. ~1800 lines. World gen, PIXI bootstrap, terrain draw, units draw, input modes, HUD, tick driver.
- `src/battle/simulate.ts`: pure sim. `simulateTick`, `computeDefendFormation`, the 5 motion-mode branches, combat phase.
- `src/hex-engine/HexUtils.ts`: axial hex math. Pointy-top, size=40, 111 lines, stable.
- `scripts/sim-formations.ts`: manual test harness. Prints scenario results for visual inspection.
- `PLAN.md`: prior architectural review with prioritized recommendations.
