# Learnings — `feature/units` worktree

What got built, what bit us, and what to remember when coming back to this code.

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
