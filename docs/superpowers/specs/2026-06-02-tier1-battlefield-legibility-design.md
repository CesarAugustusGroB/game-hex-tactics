# Tier 1 — Battlefield Legibility

**Date:** 2026-06-02
**Status:** Approved design, ready for planning

## Goal

Make group state and selection readable from the battlefield instead of only from
a dense side panel, and collapse the always-on 4×8 command matrix into a contextual
panel that shows only the selected group's actions.

Two features:

- **A. Contextual command panel** (accordion) — HUD/React.
- **B. On-canvas group state** (order glyph + selection emphasis) — PIXI render + input.

**Explicitly out of scope:** on-battlefield order preview (path lines, destination/target
markers, ghost-formation drawing for march/charge). No ground markers of any kind.

## Shared concept: current order per group

Both features read one derived value, with no new state:

```
modeOf(team, groupId) = groupOrders.get(`${team}:${groupId}`)?.mode ?? null
```

`null` = no order entry yet (freshly deployed) and is displayed as **IDLE**. This is
distinct from an explicit `mode: 'march'`. (Note the sim's own default is
`undefined ⇒ 'march'` for movement; that default is irrelevant to display — display
keys off presence of an order entry.)

`groupOrders` is `Map<string, GroupOrder>` keyed by `${team}:${groupId}`
(`groupOrderKey`). `GroupOrder.mode: OrderMode` where
`OrderMode = 'march' | 'hold' | 'idle' | 'charge' | 'retreat' | 'unleash'`
(`src/battle/simulate.ts:89`).

Order → color/glyph mapping (colors match existing HUD button colors):

| mode        | color           | glyph |
|-------------|-----------------|-------|
| hold        | amber `#f59e0b` | 🛡    |
| march       | emerald `#10b981` | ➤   |
| charge      | red `#dc2626`   | ⚔     |
| unleash     | purple `#a855f7`| ✦     |
| retreat     | blue `#3b82f6`  | ⮌     |
| idle / none | slate `#64748b` | ⏸     |

This mapping is the single source of truth for both the panel and the canvas. It
lives as one small exported table in `src/canvas/constants.ts` (both consumers —
`HUD.tsx` and `drawUnits.ts` — are in the canvas layer, so this keeps the module
graph one-directional and prevents the two views from drifting).

## Feature A — Contextual command panel (accordion)

Replaces the current always-on 4-group button matrix in `src/canvas/HUD.tsx`
(approx. lines 462–751).

### Structure

Groups render in fixed `G1…G4` order. Only the **selected** group is expanded.

- **Selected group** → accordion header (`G1 ×7` + order label, colored by `modeOf`)
  followed by its full 8-button action grid: the existing two rows
  DEPLOY/HOLD/CHARGE/UNLEASH and MARCH/IDLE/BANISH/RETREAT.
- **Other 3 groups** → one-line summary rows: `G2  🛡 HOLD  ×8`, colored by order,
  clickable to select.
- **Empty group** (`×0`) → summary row stays, dimmed, label `—`.

### Behavior

- Clicking a summary row calls `setSelectedGroup(n)` (the same setter the number keys
  use), which expands it and collapses the previously-selected group.
- Cost chips move inline into button labels (e.g. `HOLD · 4cp`); the whole button
  tints red when the team cannot afford it. This removes the colliding corner-badge
  `CostChip` component (`HUD.tsx:99-115`).
- Keyboard (1–4, Q/W/E/R/A/S/D/F) is unchanged — these already act on `selectedGroup`.
- Sealed groups (🔒) keep their existing seal treatment in the header / summary row.

### Code shape

Extract two focused sub-components inside `HUD.tsx`:

- `<GroupRow>` — collapsed summary row (number, glyph, order label, count, status,
  click-to-select).
- `<GroupActions>` — the expanded 8-button grid for the selected group.

This turns the ~290-line inline block into two small pieces that can be reasoned
about independently.

## Feature B — On-canvas group state

Two render additions in `src/canvas/render/drawUnits.ts` plus one input wiring in
`src/components/GameCanvas.tsx`.

### B1. Order glyph per group

Each group already has a computed lieutenant (`lieutenantIds`,
`drawUnits.ts:300-319`). Add a glyph badge floating above each lieutenant, reusing
the existing `BADGE_Y` offset and the `star` `PIXI.Text` pattern (a sibling text on
the unit container). Glyph character + color come from the shared mapping.

- The existing gold ★ lieutenant marker stays; the glyph sits above/beside it.
- Shown for all groups (friendly and, when not fogged, enemy).
- Hidden at strategic zoom (`isFar`), same gate as the star.

### B2. Selection emphasis (no ground markers)

Pass `selectedGroup` (and selected team) into the `drawUnits` ctx.

- Selected group's units: intensify the **existing** team outline
  (`drawUnits.ts:445-454`) — brighter/white, thicker stroke. Non-selected groups keep
  the normal team outline.
- Selected group's glyph: enlarged with a white border.
- No ground rings, halos, or floor markers.

### B3. Click-to-select

In the canvas `pointertap` handler (GameCanvas): when a tap lands on a hex occupied
by a **friendly** unit, call `setSelectedGroup(unit.groupId)` and
`setSelectedTeam(unit.team)`, then fall through. Enemy taps do nothing new. All other
taps keep existing deploy/order behavior.

Selection state is shared across all three entry points (canvas click, HUD G-buttons,
number keys) via the single `setSelectedGroup` setter and `selectedGroupRef`
(`GameCanvas.tsx:132,320,339`), so the canvas emphasis, the panel accordion, and the
keyboard all stay in sync automatically.

## Data flow

```
groupOrders (Map) ──┬─→ HUD: modeOf(selected & others) → accordion + summary rows
                    └─→ drawUnits ctx → per-lieutenant glyph + color

selectedGroup (state + ref) ──┬─→ HUD: which group is expanded
                              ├─→ drawUnits ctx → outline emphasis + glyph emphasis
                              └─→ set by: canvas pointertap, HUD GroupRow click, keys 1–4
```

No new state is introduced. `selectedGroup` and `groupOrders` already exist; the only
new wiring is passing `selectedGroup`/team into the `drawUnits` ctx and the
friendly-unit branch in `pointertap`.

## Edge cases

- Selected group with `×0` units → still expands; action grid disabled (current
  behavior preserved).
- Group emptied mid-battle → summary row dims to `—`; remains selectable.
- Sealed groups (🔒) → existing seal treatment retained in row/header.
- Fog of war → enemy glyphs follow existing hidden-unit rules (no glyph when fogged).
- Never-ordered group → `modeOf` is `null` → displayed as IDLE (`⏸`, slate).

## Verification

No test runner is configured. Verify via:

- `npm run build` — `tsc -b` must pass (type errors fail the build).
- `npm run lint`.
- `npx tsx scripts/sim-formations.ts` — confirms the pure sim is untouched; these are
  render/HUD-only changes and the harness output should be identical to baseline.
- Manual / Playwright in-app: deploy 3 groups, issue different orders, and confirm the
  panel summary rows, the canvas glyphs, and the selection emphasis all stay in sync
  when switching the selected group via (a) canvas click, (b) HUD G-buttons, and
  (c) number keys 1–4.

## Files touched

- `src/canvas/HUD.tsx` — accordion panel, `GroupRow` / `GroupActions`, inline cost,
  remove `CostChip`.
- `src/canvas/render/drawUnits.ts` — order glyph per lieutenant, selection outline +
  glyph emphasis, consume `selectedGroup` from ctx.
- `src/components/GameCanvas.tsx` — pass `selectedGroup`/team into `drawUnits` ctx;
  friendly-unit branch in `pointertap`.
- `src/canvas/constants.ts` — new shared order→glyph/color mapping table.
