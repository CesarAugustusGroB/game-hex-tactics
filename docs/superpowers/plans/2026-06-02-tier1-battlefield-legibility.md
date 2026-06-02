# Tier 1 — Battlefield Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each group's order and the current selection readable straight from the battlefield, and collapse the always-on 4×8 command matrix into a contextual accordion that shows only the selected group's actions.

**Architecture:** Two consumer-side features over existing state — no new game state. A single shared order→glyph/color table (`ORDER_BADGE`) feeds both (a) the React HUD accordion and (b) a per-lieutenant glyph + selection emphasis in the PIXI unit renderer. Selection is set from three already-wired entry points (canvas click, HUD rows, number keys 1–4) through the existing `setSelectedGroup`.

**Tech Stack:** React (HUD, inline styles), PIXI.js v8 (`drawUnits.ts`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-02-tier1-battlefield-legibility-design.md`

---

## Testing note (project reality, overrides skill default)

This repo has **no unit-test runner** (see `CLAUDE.md`). The TDD/pytest loop in the writing-plans skill does not apply. Each task's verification uses the project's actual gates:

- `npm run build` — `tsc -b` + vite build; **type errors fail the build** (primary gate).
- `npm run lint` — ESLint.
- `npx tsx scripts/sim-formations.ts` — headless battle harness; these are render/HUD-only changes, so its output must be **byte-identical to baseline** (proves the pure sim is untouched).
- Visual check in-app via the running dev server (`npm run dev -- --port 5176`) and Playwright screenshots.

Capture a harness baseline once before starting:

```bash
npx tsx scripts/sim-formations.ts > /tmp/sim-baseline.txt
```

Re-run and `diff` against it after any change that touches `src/canvas/render/` or `src/components/GameCanvas.tsx`.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/canvas/constants.ts` | shared canvas/HUD constants | **Add** `ORDER_BADGE` table + `badgeForOrder()` |
| `src/canvas/render/drawUnits.ts` | unit rendering | **Add** per-lieutenant order glyph; selection outline + glyph emphasis; consume `selectedGroup` |
| `src/components/GameCanvas.tsx` | composition root | **Modify** `drawUnits` ctx (pass `selectedGroup`) |
| `src/canvas/PixiApp.ts` | pointer handlers | **Modify** `pointertap` — friendly-unit click selects its group |
| `src/canvas/HUD.tsx` | HUD panel | **Add** `GroupSummaryRow`; gate the action grid behind selection (accordion); optional inline cost |

---

## Task 1: Shared order→glyph/color table

**Files:**
- Modify: `src/canvas/constants.ts:2` (import) and append a new export block.

The single source of truth both consumers read. Monochrome single-letter glyphs are used deliberately: PIXI `.tint` does not color multicolor emoji cleanly (same family of gotcha as the `Color.multiply` note in `LEARNINGS.md`), whereas a white letter tints to any color reliably, and CSS `color` works on it too. The full word lives in `label` for the HUD.

- [ ] **Step 1: Add `OrderMode` to the existing simulate import**

In `src/canvas/constants.ts`, line 2 currently reads:

```ts
import type { Unit, UnitType, Team, GroupOrder, FormationType } from '../battle/simulate';
```

Change it to:

```ts
import type { Unit, UnitType, Team, GroupOrder, FormationType, OrderMode } from '../battle/simulate';
```

- [ ] **Step 2: Append the `ORDER_BADGE` table and helper**

Add at the end of `src/canvas/constants.ts`:

```ts
// Shared order→glyph/color mapping — single source of truth for the HUD accordion
// (src/canvas/HUD.tsx) and the on-canvas group glyph (src/canvas/render/drawUnits.ts).
// Glyphs are monochrome single letters on purpose: PIXI .tint colors a white letter
// reliably but muddies multicolor emoji. `label` carries the full word for the HUD.
export interface OrderBadge {
  glyph: string;
  label: string;
  colorHex: string; // for CSS (HUD)
  colorInt: number; // for PIXI .tint
}

export const ORDER_BADGE: Record<OrderMode | 'none', OrderBadge> = {
  hold:    { glyph: 'H', label: 'HOLD',    colorHex: '#f59e0b', colorInt: 0xf59e0b },
  march:   { glyph: 'M', label: 'MARCH',   colorHex: '#10b981', colorInt: 0x10b981 },
  charge:  { glyph: 'C', label: 'CHARGE',  colorHex: '#dc2626', colorInt: 0xdc2626 },
  unleash: { glyph: 'U', label: 'UNLEASH', colorHex: '#a855f7', colorInt: 0xa855f7 },
  retreat: { glyph: 'R', label: 'RETREAT', colorHex: '#3b82f6', colorInt: 0x3b82f6 },
  idle:    { glyph: 'I', label: 'IDLE',    colorHex: '#64748b', colorInt: 0x64748b },
  none:    { glyph: '·', label: '—', colorHex: '#64748b', colorInt: 0x64748b },
};

// No order entry => 'none' (freshly deployed). Order entry without an explicit mode =>
// 'march' (the sim's movement default).
export const badgeForOrder = (order?: { mode?: OrderMode } | null): OrderBadge =>
  order ? ORDER_BADGE[order.mode ?? 'march'] : ORDER_BADGE.none;
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: build succeeds (no type errors). `ORDER_BADGE` is unused so far — that is fine; it is `export`ed, so no unused-var lint error.

- [ ] **Step 4: Commit**

```bash
git add src/canvas/constants.ts
git commit -m "feat(canvas): shared ORDER_BADGE glyph/color table"
```

---

## Task 2: On-canvas order glyph per lieutenant

**Files:**
- Modify: `src/canvas/render/drawUnits.ts` (imports, `UnitVisual`, `createUnitVisual`, per-unit update loop).

Adds a small colored letter above each group's lieutenant showing its current order. Reuses the existing lieutenant computation (`lieutenantIds`) and the `star` text pattern.

- [ ] **Step 1: Import the badge table and a glyph style constant**

In `src/canvas/render/drawUnits.ts`, line 9 currently imports from `../constants`:

```ts
import { TEAM_TINTS, HEADING_ARROWS, LOD_THRESHOLD, TICK_MS, terrainMapFor, type Armies, type GroupOrders } from '../constants';
```

Change it to add `badgeForOrder`:

```ts
import { TEAM_TINTS, HEADING_ARROWS, LOD_THRESHOLD, TICK_MS, terrainMapFor, badgeForOrder, type Armies, type GroupOrders } from '../constants';
```

Then, directly below the existing `STAR_STYLE` export (currently line 45), add:

```ts
// Order glyph above the lieutenant. White base so PIXI .tint colors it per order mode.
const GLYPH_STYLE = { fontSize: 13, fontWeight: '900' as const, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } };
const GLYPH_X = -15; // sits left of the ★ (x=0); → arrow is at x=14 on the right
```

- [ ] **Step 2: Add `glyph` + `glyphMode` to `UnitVisual`**

In the `UnitVisual` interface (currently lines 64–75), add two fields after `arrowHeading`:

```ts
interface UnitVisual {
  marker: PIXI.Graphics;
  outline: PIXI.Graphics;
  shadow: PIXI.Sprite;
  boatHull: PIXI.Graphics;
  sprite: PIXI.Sprite;
  hpBg: PIXI.Sprite;
  hpFg: PIXI.Sprite;
  star: PIXI.Text;
  arrow: PIXI.Text;
  arrowHeading: string;
  glyph: PIXI.Text;
  glyphChar: string;
}
```

- [ ] **Step 3: Create the glyph in `createUnitVisual`**

In `createUnitVisual`, after the `arrow` text block (currently ends line 238 with `container.addChild(arrow);`) and before `return { ... }`, add:

```ts
  const glyph = new PIXI.Text({ text: '·', style: GLYPH_STYLE });
  glyph.anchor.set(0.5);
  glyph.x = GLYPH_X;
  glyph.y = BADGE_Y;
  glyph.label = 'unit-detail';
  glyph.visible = false;
  container.addChild(glyph);
```

Then update the return statement (currently line 240) to include the new fields:

```ts
  return { marker, outline, shadow, boatHull, sprite, hpBg, hpFg, star, arrow, arrowHeading: '→', glyph, glyphChar: '·' };
```

- [ ] **Step 4: Update the glyph each tick in the unit loop**

In `drawUnits`, the per-unit lieutenant block currently reads (lines 471–483):

```ts
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
```

Append, immediately after that block (still inside the `units.forEach`):

```ts
    // Order glyph: shown for every lieutenant (one per group). Colored per order mode via
    // .tint (cheap); .text only re-set when the glyph char changes (Text re-raster is costly).
    const badge = badgeForOrder(order);
    v.glyph.visible = isLt && !isFar;
    if (isLt) {
      v.glyph.tint = badge.colorInt;
      if (badge.glyph !== v.glyphChar) {
        v.glyph.text = badge.glyph;
        v.glyphChar = badge.glyph;
      }
    }
```

(`order` is already declared just above — do not redeclare it.)

- [ ] **Step 5: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 6: Confirm the sim is untouched**

Run: `npx tsx scripts/sim-formations.ts > /tmp/sim-after-t2.txt && diff /tmp/sim-baseline.txt /tmp/sim-after-t2.txt`
Expected: no diff output (identical).

- [ ] **Step 7: Visual check**

Start the dev server (`npm run dev -- --port 5176`), dive into a tactical map, deploy a group, and confirm a colored letter appears above the group's lieutenant (`·` slate before any order; `M`/`H`/`C`/`U` in the matching color after issuing march/hold/charge/unleash). Confirm it disappears when zoomed far out.

- [ ] **Step 8: Commit**

```bash
git add src/canvas/render/drawUnits.ts
git commit -m "feat(render): per-lieutenant order glyph on the battlefield"
```

---

## Task 3: Selection emphasis on the battlefield

**Files:**
- Modify: `src/canvas/render/drawUnits.ts` (`UnitsRenderContext`, outline stroke, glyph scale).
- Modify: `src/components/GameCanvas.tsx:241-263` (pass `selectedGroup` into the ctx + dep array).

The selected group's units get a brighter, thicker outline and an enlarged glyph. No ground markers.

- [ ] **Step 1: Import `GroupId` in drawUnits**

`src/canvas/render/drawUnits.ts` line 6 currently:

```ts
import type { Unit, Team } from '../../battle/simulate';
```

Change to:

```ts
import type { Unit, Team, GroupId } from '../../battle/simulate';
```

- [ ] **Step 2: Add `selectedGroup` to `UnitsRenderContext`**

In `UnitsRenderContext` (currently lines 115–140), add a field next to `selectedTeam`:

```ts
  selectedTeam: Team;
  selectedGroup: GroupId;
```

- [ ] **Step 3: Compute per-unit selection and apply outline emphasis**

In the unit loop, the outline is drawn at lines 445–454:

```ts
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
```

Replace **only the final `stroke(...)` line** with selection-aware styling. Add the `isSelGroup` const just before the loop's `v.outline.clear()` and change the stroke:

```ts
    const isSelGroup = u.team === ctx.selectedTeam && u.groupId === ctx.selectedGroup;
    v.outline.clear();
    for (let k = 0; k < 6; k++) {
      const dir = HexUtils.directions[(6 - k) % 6];
      const nKey = HexUtils.key({ q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r });
      if (teamByKey.get(nKey) === u.team) continue;
      const a = UNIT_VERTS[k];
      const b = UNIT_VERTS[(k + 1) % 6];
      v.outline.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    v.outline.stroke(isSelGroup
      ? { color: 0xffffff, width: 4, alpha: 1 }
      : { color: teamColor, width: 3, alpha: 0.95 });
```

- [ ] **Step 4: Enlarge the glyph for the selected group**

In the glyph block added in Task 2 (`if (isLt) { ... }`), add a scale line so the selected group's glyph is larger. The block becomes:

```ts
    const badge = badgeForOrder(order);
    v.glyph.visible = isLt && !isFar;
    if (isLt) {
      v.glyph.tint = badge.colorInt;
      v.glyph.scale.set(isSelGroup ? 1.4 : 1);
      if (badge.glyph !== v.glyphChar) {
        v.glyph.text = badge.glyph;
        v.glyphChar = badge.glyph;
      }
    }
```

(`isSelGroup` is in scope from Step 3.)

- [ ] **Step 5: Pass `selectedGroup` from GameCanvas**

In `src/components/GameCanvas.tsx`, the `drawUnits` callback builds the ctx (lines 241–262). Add `selectedGroup` next to `selectedTeam` (line 259):

```ts
      viewMode,
      selectedTeam,
      selectedGroup,
      fogOfWar,
      worldScale: worldRef.current.scale.x,
```

Then add `selectedGroup` to the callback's dependency array (currently line 263):

```ts
  }, [armies, viewMode, gridData, currentStrategicHex, groupOrders, fogOfWar, selectedTeam, selectedGroup]);
```

This makes a selection change re-run `drawUnits` (via the existing `useEffect(() => { drawUnits(); }, [drawUnits])` at line 800), so the highlight updates immediately even while the battle is paused.

- [ ] **Step 6: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 7: Confirm the sim is untouched**

Run: `npx tsx scripts/sim-formations.ts > /tmp/sim-after-t3.txt && diff /tmp/sim-baseline.txt /tmp/sim-after-t3.txt`
Expected: no diff.

- [ ] **Step 8: Visual check**

Deploy 2+ groups, select different groups via the HUD `G1`/`G2` buttons (and number keys 1–4), and confirm the selected group's units show a white thick outline and a larger glyph while the others stay team-colored.

- [ ] **Step 9: Commit**

```bash
git add src/canvas/render/drawUnits.ts src/components/GameCanvas.tsx
git commit -m "feat(render): selection emphasis (outline + glyph) for selected group"
```

---

## Task 4: Click-to-select a friendly group on the battlefield

**Files:**
- Modify: `src/canvas/PixiApp.ts:395-428` (the `pointertap` handler).

In neutral pointer state (not scanning, not order mode, not painting), tapping a hex that holds a unit of the **currently selected team** selects that unit's group. Enemy taps do nothing. All other behavior is unchanged. `pointertap` already early-returns on order mode and drags; the scanning branch is untouched. No new ctx field is needed — `armiesRef`, `currentStrategicHexRef`, `selectedTeamRef`, and `setSelectedGroup` are all already on `PixiAppCtx` (lines 102–123).

- [ ] **Step 1: Add the friendly-select branch**

The handler currently ends its scanning branch and then closes (lines 401–428). Inside the `pointertap` callback, **after** the existing `if (ctx.isScanningRef.current) { ... }` block and before the handler closes, add an `else` branch that runs only in tactical neutral state:

```ts
        if (ctx.isScanningRef.current) {
          // ... existing dive-on-scan block, unchanged ...
        } else if (ctx.currentStrategicHexRef.current) {
          // Tactical neutral tap: select the friendly group occupying this hex.
          const tapKey = HexUtils.key(hex);
          const units = ctx.armiesRef.current.get(HexUtils.key(ctx.currentStrategicHexRef.current)) ?? [];
          const team = ctx.selectedTeamRef.current;
          const hit = units.find(u =>
            u.team === team && u.hp > 0 && HexUtils.key(u.tacticalHex) === tapKey
          );
          if (hit) ctx.setSelectedGroup(hit.groupId);
        }
```

Note: the `local`/`hex` consts are already computed at the top of the handler (lines 399–400) — reuse them, do not recompute.

- [ ] **Step 2: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 3: Visual check**

Deploy units into two groups at distinct hexes. With the battle paused, click one group's units on the canvas and confirm: (a) the selected-group white outline + enlarged glyph jumps to the clicked group, and (b) the HUD accordion (after Task 5) / group highlight follows. Click an empty hex or (after switching team) an enemy unit and confirm nothing changes.

- [ ] **Step 4: Commit**

```bash
git add src/canvas/PixiApp.ts
git commit -m "feat(input): click a friendly unit to select its group"
```

---

## Task 5: Contextual command panel (accordion)

**Files:**
- Modify: `src/canvas/HUD.tsx` — add `GroupSummaryRow` component; in the `GROUP_IDS.map` block (lines 473–739), render the full action grid only for the selected group and a one-line summary for the rest.

Only the selected group shows its 8-button action grid; the other three collapse to clickable summary rows that spell out their current order. Because only one grid renders at a time, the cost-chip crowding is resolved structurally.

- [ ] **Step 1: Import the badge helper into HUD**

`src/canvas/HUD.tsx` line 7–10 imports from `./constants`. Add `badgeForOrder`:

```ts
import {
  POINTS_TO_WIN, COHORT_SIZE, RETREAT_REFUND_FRAC,
  TEAM_TINTS, HEADING_ARROWS, groupOrderKey, GROUP_IDS, isGroupEngaged, badgeForOrder,
} from './constants';
```

- [ ] **Step 2: Add the `GroupSummaryRow` component**

Add this component just above `HUDInner` (before line 137, `const HUDInner`):

```tsx
const GroupSummaryRow: React.FC<{
  gid: GroupId;
  count: number;
  order: import('../battle/simulate').GroupOrder | undefined;
  isSealed: boolean;
  isActiveFill: boolean;
  onSelect: () => void;
}> = ({ gid, count, order, isSealed, isActiveFill, onSelect }) => {
  const badge = badgeForOrder(order);
  const empty = count === 0;
  return (
    <button
      onClick={onSelect}
      title={`Select G${gid} (shortcut: ${gid})`}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        padding: '8px 10px', marginBottom: '6px', borderRadius: '8px',
        background: 'rgba(255,255,255,0.03)',
        border: isActiveFill ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.06)',
        color: '#cbd5e1', cursor: 'pointer', textAlign: 'left',
        fontSize: '11px', fontWeight: 700,
        opacity: isSealed ? 0.82 : empty ? 0.6 : 1,
      }}
    >
      <span style={{ fontWeight: 900 }}>G{gid}</span>
      <span style={{
        width: '7px', height: '7px', borderRadius: '50%',
        background: badge.colorHex, display: 'inline-block',
      }} />
      <span style={{ color: badge.colorHex, fontWeight: 800 }}>{empty ? '—' : badge.label}</span>
      <span style={{ marginLeft: 'auto', color: '#64748b', fontWeight: 600 }}>
        ×{count}{isSealed ? ' 🔒' : isActiveFill ? ' ▶' : ''}
      </span>
    </button>
  );
};
```

- [ ] **Step 3: Gate the action grid behind selection and render the summary otherwise**

In the `GROUP_IDS.map(gid => { ... })` body, the per-group container currently always renders Row 1 (lines 516–624) and Row 2 (lines 625–736). Restructure the `return (...)` of the map callback so:

- the **selected** group renders the existing container with Row 1 + Row 2 unchanged;
- every **other** group renders `<GroupSummaryRow>`.

Replace the map callback's `return (` block. The new shape:

```tsx
              if (!isSelectedRow) {
                return (
                  <GroupSummaryRow
                    key={gid}
                    gid={gid}
                    count={count}
                    order={order}
                    isSealed={isSealed}
                    isActiveFill={isActiveFill}
                    onSelect={() => setSelectedGroup(gid)}
                  />
                );
              }
              return (
                <div key={gid} style={{
                  marginBottom: '6px',
                  padding: '4px 6px',
                  borderLeft: `3px solid ${teamColorHex}`,
                  background: `${teamColorHex}14`,
                  borderRadius: '6px',
                  opacity: isSealed ? 0.82 : 1,
                  transition: 'background 120ms, border-color 120ms',
                }}>
                  {/* Row 1 ──────── G  Q  W  E  R ──────── */}
                  {/* ...EXISTING Row 1 div (lines 517–624) unchanged... */}
                  {/* Row 2 ──────── A  S  D  F ──────── */}
                  {/* ...EXISTING Row 2 div (lines 625–736) unchanged... */}
                </div>
              );
```

Keep the two existing `<div style={{ ...rowStyle ... }}>` blocks (Row 1 and Row 2) exactly as they are — only the wrapping `return`/container and the early `GroupSummaryRow` return are new. The per-gid consts above the return (`count`, `order`, `orderMode`, `isSealed`, `isActiveFill`, `teamColorHex`, etc., lines 474–505) stay unchanged and are still used by the expanded grid.

- [ ] **Step 4: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 5: Visual check**

Dive to tactical. Confirm: exactly one group (the selected one) shows the full 8-button grid; the other three show compact `G2 ● HOLD ×8` rows colored by order. Clicking a summary row expands it and collapses the previous one. Number keys 1–4 and canvas click (Task 4) drive the same accordion. Sealed groups show 🔒, the active-fill group shows ▶.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/HUD.tsx
git commit -m "feat(hud): contextual accordion command panel"
```

---

## Task 6: Inline cost chips (polish)

**Files:**
- Modify: `src/canvas/HUD.tsx` — remove the `CostChip` corner badges in the expanded grid; show cost inline in the button label and tint the whole button red when unaffordable.

This is the spec's "cost moves inline" item. With the accordion (Task 5) the chips no longer collide across rows, so this is lower-risk polish — keep it as its own task so the core lands first. Do this for each of the eight action buttons in Row 1 + Row 2.

- [ ] **Step 1: Define a small inline-cost helper near `CostChip`**

Replace the `CostChip` component (lines 99–115) with a label helper and an unaffordable-tint helper:

```tsx
const costLabel = (text: string, cost: number): string =>
  cost > 0 ? `${text} · ${cost}` : text;

// red tint applied to a button when the team cannot afford the action
const UNAFFORD_BG = 'rgba(239,68,68,0.12)';
const UNAFFORD_BORDER = '1px solid rgba(239,68,68,0.55)';
```

- [ ] **Step 2: Apply to each action button**

For each of the eight buttons, two edits:

1. Remove its `{!... && <CostChip ... />}` (or `<CostChip ... />`) child.
2. Wrap its visible text with `costLabel(...)` and, when the action is the affordable-gated one, switch its `background`/`border` to the unafford styles if `!canAfford(selectedTeam, <intent>)`.

Worked example — the **HOLD** button (currently lines 558–579). After:

```tsx
                    <button
                      disabled={!canEdit || (!holdActive && !canAfford(selectedTeam, 'hold'))}
                      title={/* unchanged */
                        committed ? '🔒 Group committed — retreat to redeploy'
                        : !canHold ? 'No active order to hold'
                        : holdActive ? `Holding — ${holdPct}% damage reduction (cap ${Math.round(HOLD_REDUCTION_CAP * 100)}%). Click to cancel (shortcut: W).`
                        : `Hold: stand still, accrue +${Math.round(HOLD_REDUCTION_PER_TICK * 100)}% damage reduction per tick up to ${Math.round(HOLD_REDUCTION_CAP * 100)}% cap (shortcut: W)`
                      }
                      onClick={() => { if (canEdit) toggleMode('hold'); }}
                      style={{
                        ...btnBase,
                        background: holdActive ? '#f59e0b'
                          : (!holdActive && !canAfford(selectedTeam, 'hold')) ? UNAFFORD_BG
                          : 'rgba(255,255,255,0.04)',
                        color: !canEdit ? '#475569' : holdActive ? 'white' : '#94a3b8',
                        border: holdActive ? '1px solid #f59e0b'
                          : (!holdActive && !canAfford(selectedTeam, 'hold')) ? UNAFFORD_BORDER
                          : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canEdit ? 'not-allowed' : 'pointer',
                        opacity: !canEdit ? 0.5 : 1,
                      }}
                    >
                      {holdActive ? `HOLD ${holdPct}% (W)` : costLabel('HOLD (W)', CP_COSTS.hold)}
                    </button>
```

Apply the same pattern to DEPLOY (`CP_COSTS.orderDrag`), CHARGE (`CP_COSTS.charge`), UNLEASH (`CP_COSTS.unleash`), MARCH (`CP_COSTS[marchIntent]`), IDLE (`CP_COSTS.idle`), BANISH (`CP_COSTS[banishIntent]`), RETREAT (`CP_COSTS[retreatIntent]`). Each: remove the `<CostChip>`, wrap the label with `costLabel(...)`, and (where the button has an affordability gate) apply the `UNAFFORD_BG`/`UNAFFORD_BORDER` swap. The `position: 'relative'` on each button style was only there to anchor the removed corner chip — it is harmless to leave, but may be removed.

- [ ] **Step 3: Confirm `CostChip` has no remaining references**

Run: `npm run build`
Expected: build passes. If it fails with "CostChip is not defined", a usage was missed — search `CostChip` in `HUD.tsx` and convert it.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: passes (no unused `CostChip`).

- [ ] **Step 5: Visual check**

Confirm each action button shows its cost inline (e.g. `HOLD · 4`), and that an unaffordable action tints the button red instead of showing a corner badge.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/HUD.tsx
git commit -m "feat(hud): inline action cost, drop corner cost chips"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Build + lint clean**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 2: Sim harness identical to baseline**

Run: `npx tsx scripts/sim-formations.ts > /tmp/sim-final.txt && diff /tmp/sim-baseline.txt /tmp/sim-final.txt`
Expected: no diff (the pure sim is untouched by these render/HUD changes).

- [ ] **Step 3: End-to-end visual pass**

Start `npm run dev -- --port 5176`. Dive to tactical and verify the full flow:
1. Deploy three groups; each lieutenant shows a slate `·` glyph.
2. Issue different orders (march/hold/charge); glyphs change letter + color; HUD summary rows spell the orders.
3. Select each group via (a) HUD summary row click, (b) number keys 1–4, (c) canvas click on the group's units — all three select the same group, expand its accordion grid, and move the white outline + enlarged glyph.
4. Clicking an empty hex / enemy unit selects nothing.
5. Action costs render inline; an unaffordable action tints red.
6. Zoom far out: glyphs and HP bars hide (LOD), no errors in console.

- [ ] **Step 4: Final confirmation**

Confirm all task commits are present:

```bash
git log --oneline -7
```

Expected: the six feature commits (Tasks 1–6) plus this plan's spec commit are in history.

---

## Self-review checklist (completed by planner)

- **Spec coverage:** Shared mapping → Task 1. Accordion panel → Task 5. Inline cost → Task 6. Order glyph → Task 2. Selection emphasis → Task 3. Click-to-select → Task 4. All spec sections mapped.
- **Refinement vs spec:** (1) Spec suggested extracting both `GroupRow` and `GroupActions`; the plan extracts `GroupSummaryRow` and keeps the action grid inline-but-selection-gated — lower risk, same legibility outcome. (2) Spec mentioned `setSelectedTeam` on click; since selection is friendly-only (= current team), team never changes, so only `setSelectedGroup` is wired (no new ctx field). (3) Glyphs are monochrome letters, not emoji, to keep PIXI `.tint` reliable. These are deliberate and documented.
- **Type consistency:** `badgeForOrder`/`ORDER_BADGE`/`OrderBadge` names consistent across Tasks 1/2/3/5. `selectedGroup: GroupId` added to `UnitsRenderContext` (Task 3) and supplied by GameCanvas (Task 3). `glyph`/`glyphChar` fields on `UnitVisual` consistent (Tasks 2/3).
- **No placeholders:** every code step shows complete code or an exact, anchored relocation of existing lines.
