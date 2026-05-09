# Units MVP — Design

Date: 2026-05-09
Branch: `feature/units`
Status: Approved

## Goal

Add a decorative units layer on top of the existing hex map. Players can drop individual unit markers in TACTICAL view; the STRATEGIC view derives an "army" icon per strategic hex that contains units. No combat, movement, ownership, or persistence — this is the visual/data foundation that future iterations build on.

## Non-Goals (YAGNI)

- Deleting or moving placed units.
- Multiple unit types (infantry, cavalry, …).
- Count badges on the army icon.
- Team / faction colors.
- Persistence across page reloads.
- Combat, pathfinding, turns.
- Recursive dives (TACTICAL → deeper TACTICAL). MVP assumes a single STRATEGIC ↔ TACTICAL transition.
- GSAP animations when placing.

## Prerequisite: Stable Noise

`GameCanvas.tsx:56` currently does `const noise = createNoise2D();` *inside* `generateWorldData`. Each call (including the implicit one fired by `RETURN TO STRATEGIC OVERVIEW` resetting `genSettings`) creates a fresh seed, so the strategic map is non-reproducible across regenerations.

This breaks the units feature: a unit placed at strategic hex `(5, 3)` would, after a return-to-strategic, point to a hex whose terrain has changed (different height, possibly different type — even potentially out of the rendered grid radius).

**Fix:** hoist the noise function into a ref created once on mount and reused across regenerations. `REGENERATE ECOSYSTEM` resets the ref so a new seed is drawn.

```ts
const noiseRef = useRef<ReturnType<typeof createNoise2D> | null>(null);
// inside generateWorldData:
if (!noiseRef.current) noiseRef.current = createNoise2D();
const noise = noiseRef.current;
```

Strictly speaking this is a pre-existing bug, but the units feature requires it, so the implementation plan owns the fix.

## Data Model

```ts
type UnitId = string;

interface Unit {
  id: UnitId;          // crypto.randomUUID()
  tacticalHex: Hex;    // axial coords inside the tactical view
}

// Armies indexed by the STRATEGIC hex the player dove from.
// Key format: HexUtils.key(strategicHex)
type Armies = Map<string, Unit[]>;
```

New React state in `GameCanvas`:

- `armies: Armies` — the canonical store of placed units.
- `currentStrategicHex: Hex | null` — set when the player dives in (the hex they clicked); used as the bucket key for units placed during this tactical session and as the position for the army icon back in STRATEGIC view. Reset to `null` by "RETURN TO STRATEGIC OVERVIEW".
- `isPlacing: boolean` — UI mode flag. Mutually exclusive with `isScanning`.

`generateWorldData` clears `armies` (resets to an empty Map) because regenerating the noise field invalidates strategic hex meaning.

## Rendering

A new `unitsGfx: PIXI.Container` is added to `worldRef` after `terrainGfx` (so it renders on top of terrain, below `highlightGfx`).

A `drawUnits()` callback rebuilds `unitsGfx` from scratch, triggered by a `useEffect` on `[armies, viewMode, currentStrategicHex, gridData]`.

### STRATEGIC view

For each `(strategicHexKey, units[])` entry in `armies`:

1. Look up the hex in `gridData` to get its terrain height.
2. Compute world position with `HexUtils.hexToPixel`.
3. Place an "army" sprite at `(pos.x, pos.y - terrainHeight - 6)` (small visual lift).
4. Sprite size ≈ 40px wide, anchored center.

If `gridData` does not contain the strategic hex (e.g., out of grid radius after offset change), skip rendering that army. This shouldn't happen in normal flow.

### TACTICAL view

If `currentStrategicHex === null`, render nothing.

Otherwise read `armies.get(HexUtils.key(currentStrategicHex)) ?? []` and, for each `Unit`:

1. Compute pixel position of `unit.tacticalHex`.
2. Look up the tactical hex's terrain height.
3. Place a "unit" sprite at `(pos.x, pos.y - terrainHeight - 4)`.
4. Sprite size ≈ 32px wide, anchored center.

### Sprite assets

Two new files under `public/units/`:

- `army.svg` — banner / standard silhouette. Used in STRATEGIC.
- `unit.svg` — soldier silhouette. Used in TACTICAL.

Style: flat fill `#f8fafc` (matches HUD foreground) with stroke `#1e293b` for legibility on every terrain. Pure SVG, no external dependencies.

Loaded once at PIXI mount via `PIXI.Assets.load(['/units/army.svg', '/units/unit.svg'])`. The two textures are stored in refs (`armyTextureRef`, `unitTextureRef`) and reused for every sprite.

Sprites are created fresh each `drawUnits()` call (cleared and rebuilt), matching the existing `drawMap` rebuild pattern. Texture reuse keeps this cheap.

## Input / UX

### Click handling

The existing `pointertap` handler gains a third branch:

| Active mode    | Click on hex does                                                                 |
|----------------|------------------------------------------------------------------------------------|
| neither flag   | nothing (drag/hover unchanged)                                                     |
| `isScanning`   | dive — same as today, **plus**: `setCurrentStrategicHex(clickedHex)`              |
| `isPlacing`    | append `Unit { id, tacticalHex: clickedHex }` to `armies[currentStrategicHex]`    |

Toggling `isPlacing` on disables `isScanning` and vice versa.

Re-clicking the same tactical hex while in placing mode adds another unit to the same hex (multi-stack). MVP renders only one sprite per hex regardless of stack depth — count is invisible. (Acceptable: matches "decorative" scope.)

### Refs mirror

`isPlacingRef` and `currentStrategicHexRef` are kept in sync with their state via `useEffect`, following the existing `isScanningRef` / `noiseOffsetRef` pattern. The `pointertap` handler reads only refs.

### HUD additions

A new button row below the existing "INITIATE TACTICAL DIVE":

- **`PLACE UNIT`** / **`STOP PLACING`** — toggles `isPlacing`. Disabled (greyed out, `cursor: not-allowed`) when `viewMode === 'STRATEGIC'`. Tooltip on hover when disabled: "Dive into a tactical view first".

Cursor changes to `crosshair` whenever `isPlacing || isScanning`.

### State transitions

- "RETURN TO STRATEGIC OVERVIEW" sets `currentStrategicHex = null` and `isPlacing = false` (in addition to its current resets).
- "REGENERATE ECOSYSTEM" sets `armies = new Map()`, `currentStrategicHex = null`, and `noiseRef.current = null` (so a fresh seed is drawn on the next `generateWorldData` call).

## Files Touched

- `src/components/GameCanvas.tsx` — all logic. The component already houses everything; keeping units there avoids premature splitting. If the file grows past ~500 lines as a result, a follow-up task can extract `units/` into its own module.
- `public/units/army.svg` — new asset.
- `public/units/unit.svg` — new asset.

No changes to `HexUtils.ts`, `App.tsx`, `main.tsx`, or build config.

## Verification

There is no test runner; verification is type-check + build + lint + manual.

1. `npm run build` — type-check passes, vite build succeeds.
2. `npm run lint` — clean.
3. Stable-noise sanity check: regenerate world, dive into hex A, return — terrain should be identical to before the dive. (Verifies the prerequisite fix.)
4. Manual flow in browser:
   - Generate world → STRATEGIC.
   - Initiate tactical dive → click hex A → enter TACTICAL.
   - Toggle `PLACE UNIT` → click 3 different tactical hexes → see 3 unit sprites.
   - `RETURN TO STRATEGIC OVERVIEW` → see one army sprite on hex A.
   - Initiate tactical dive → click hex A again → previous 3 unit sprites reappear.
   - Initiate tactical dive → click hex B → empty (no units yet); placing here doesn't affect hex A's units.
   - `REGENERATE ECOSYSTEM` → all units gone.

## Open Questions / Future Work

- Should the strategic army icon include a count badge or pulse for stacks of >1? Out of MVP, easy to add later.
- Recursive dive support (TACTICAL → deeper TACTICAL) would require a strategic-hex *path* as the bucket key, not a single hex. Out of MVP.
- Selection / deletion: a follow-up will likely add click-to-select + delete-key removal.
