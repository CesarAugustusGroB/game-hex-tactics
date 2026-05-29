# Orders & Movement Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a cluster of confirmed bugs and refinements in unit orders and movement surfaced by the 2026-05-28 audit: re-shape RETREAT into disengaged-pull-back vs engaged-banish, fix the hold-reduction off-by-one, plug the `firstMarch` recycle leak, guard order-drag against committed groups, fix the per-team heading default, and rebuild the movement follower so it traces the real per-tick hex path at the delivered speed.

**Architecture:** Sim logic stays pure in `src/battle/*` (driven by the headless harnesses under `scripts/`). UI order intent lives in `src/components/GameCanvas.tsx` and `src/canvas/input/*`. Movement *rendering* is split: a new pure `src/canvas/render/followerPath.ts` plans the glide legs (unit-testable), and `drawUnits.ts` wires it into the PIXI containers. CP economy values live in `src/battle/command-points.ts`.

**Tech Stack:** TypeScript, PixiJS v8, React, GSAP (render only — the follower mutates `container.position` directly, no tweens), `tsx` headless harnesses (no test runner; assertion scripts that `process.exit(1)` on failure).

---

## File Structure

**Create:**
- `src/canvas/render/followerPath.ts` — pure `planFollowerLegs(oldHex, newHex, topPixel, moveCost)` + exported `PX_PER_HEX`. The single source of follower glide geometry.
- `scripts/test-follower-path.ts` — assertion harness for `planFollowerLegs`.
- `scripts/test-hold.ts` — assertion harness proving hold reduction applies on the engage tick.

**Modify:**
- `src/battle/command-points.ts` — add `banish`, lower `retreat`.
- `scripts/test-command-points.ts` — update the expected cost table.
- `src/components/GameCanvas.tsx` — RETREAT branch (banish vs pull-back), per-team heading default, pass `marchedGroupsRef`/`setMarchedGroups` into `useBattleTick`.
- `src/battle/simulate.ts` — hold-reduction off-by-one; doctype speed comments.
- `src/canvas/useBattleTick.ts` — extend `BattleTickCtx`; prune `marchedGroups` on group recycle.
- `src/canvas/input/orderDrag.ts` — committed-group guard in `beginOrderDrag`.
- `src/canvas/render/drawUnits.ts` — wire `planFollowerLegs`; add `_hex` to the container type; drop now-dead speed math.
- `CLAUDE.md`, `AGENTS.md` — correct the order-mode list (`defendHeight` doesn't exist on this branch).
- `scripts/sim-formations.ts` — refresh stale charge/speed comments; remove dead `defendHeight` fixtures (gated on a grep).

**Verification commands (Windows / PowerShell):**
- `npm run build` — `tsc -b && vite build`; type errors fail.
- `npm run lint` — `eslint .`.
- `npm run sim` — `tsx scripts/sim-formations.ts` (21 scenarios; prints, exit 0).
- `npm run test:cp` — `tsx scripts/test-command-points.ts` (exits 1 on failure).
- `npm run test:scoring` — `tsx scripts/sim-scoring.ts`.
- `npx tsx scripts/test-group-seals.ts`, `npx tsx scripts/test-worldgen.ts`, and the two new harnesses.

---

## Phase A — Orders

### Task A1: RETREAT splits into disengaged pull-back (cheap) vs engaged banish (costlier)

**Design (from the user):** if the group is *not* engaged in melee, RETREAT is an orderly pull-back toward the deploy zone via the sim's existing `mode:'retreat'` branch, for a low CP cost. If the group *is* engaged, RETREAT is "banish" — the current vanish + partial-roster-refund — for a higher CP cost. This also gives an unleashed/committed group a way out of melee (banish), which it previously lacked.

**Files:**
- Modify: `src/battle/command-points.ts:8-24` (cost table)
- Modify: `scripts/test-command-points.ts:98-100` (expected table)
- Modify: `src/components/GameCanvas.tsx:534-580` (RETREAT branch)

- [ ] **Step 1: Update the failing CP test first (red)** — change the expected table in `scripts/test-command-points.ts:98-100` to:

```ts
  const expected = { idle: 0, meta: 0, debug: 0,
    cycleHeading: 1, cycleFormation: 1, march: 2, placeCohort: 2, orderDrag: 3,
    firstMarch: 4, hold: 4, retreat: 2, banish: 4, charge: 6, unleash: 6 } as const;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:cp`
Expected: FAIL on "CP_COSTS matches spec table" — `expected 14 keys, got 13` (and `retreat` value mismatch). Exit 1.

- [ ] **Step 3: Add the cost in `command-points.ts`** — in `src/battle/command-points.ts`, change the `retreat` line and add `banish`:

```ts
  placeCohort: 2,
  orderDrag: 3,
  hold: 4,
  // Orderly pull-back of a disengaged group (sim 'retreat' mode walks it home). Cheap so
  // disengaging is preferable to feeding units into the line.
  retreat: 2,
  // Abandon a melee-locked group off the field for a partial roster refund — the only exit
  // for an engaged (incl. unleashed/committed) group. Costs more than an orderly retreat.
  banish: 4,
  charge: 6,
  unleash: 6,
```

- [ ] **Step 4: Run the CP test to verify it passes**

Run: `npm run test:cp`
Expected: PASS, `… passed` with exit 0.

- [ ] **Step 5: Rewrite the RETREAT branch in `GameCanvas.tsx`** — replace the comment block + branch at `src/components/GameCanvas.tsx:534-580`. Old (current) text begins `// RETREAT is a special case:` through the `clearOrder(team, gid); return; }` that closes the `if (mode === 'retreat')` block. Replace with:

```ts
  // RETREAT is a special case, branching on melee engagement:
  //   - disengaged → orderly pull-back: issue sim 'retreat' mode (walks the block home and
  //     auto-clears the order in the deploy zone). Cheap.
  //   - engaged    → banish: vanish the group off the field and refund RETREAT_REFUND_FRAC
  //     of each unit type to the roster. The only escape for a melee-locked group. Costlier.
  const toggleMode = useCallback((mode: Exclude<OrderMode, 'march'>) => {
    const gid = selectedGroupRef.current;
    const team = selectedTeamRef.current;
    const cur = groupOrdersRef.current.get(groupOrderKey(team, gid));
    if (mode === 'retreat') {
      const strategic = currentStrategicHexRef.current;
      if (!strategic) return;
      const sKey = HexUtils.key(strategic);
      const all = armiesRef.current.get(sKey) ?? [];
      const groupUnits = all.filter(u => u.team === team && u.groupId === gid && u.hp > 0);
      if (groupUnits.length === 0) return;
      const enemyHexes = new Set(
        all.filter(u => u.team !== team && u.hp > 0).map(u => HexUtils.key(u.tacticalHex)),
      );
      const engaged = groupUnits.some(u =>
        HexUtils.getNeighbors(u.tacticalHex).some(n => enemyHexes.has(HexUtils.key(n))),
      );
      if (engaged) {
        if (!chargeCP(team, 'banish')) {
          triggerBrokeFlash(team);
          return;
        }
        const refund: Record<UnitType, number> = { infantry: 0, cavalry: 0, skirmisher: 0 };
        for (const u of groupUnits) {
          refund[u.unitType ?? 'infantry']++;
        }
        setArmies(prev => {
          const next = new Map(prev);
          const arr = next.get(sKey) ?? [];
          next.set(sKey, arr.filter(u => !(u.team === team && u.groupId === gid)));
          return next;
        });
        setRosters(prev => {
          const next = new Map(prev);
          const r = next.get(team) ?? { ...INITIAL_ROSTER };
          next.set(team, {
            infantry: r.infantry + Math.floor(refund.infantry * RETREAT_REFUND_FRAC),
            cavalry: r.cavalry + Math.floor(refund.cavalry * RETREAT_REFUND_FRAC),
            skirmisher: r.skirmisher + Math.floor(refund.skirmisher * RETREAT_REFUND_FRAC),
          });
          return next;
        });
        clearOrder(team, gid);
        return;
      }
      if (!chargeCP(team, 'retreat')) {
        triggerBrokeFlash(team);
        return;
      }
      issueOrder(team, gid, {
        mode: 'retreat', chargeTicksRemaining: undefined, chargeDamagedIds: undefined, holdTicks: undefined,
      });
      return;
    }
```

Note: `issueOrder` already permits `mode:'retreat'` on a `committed` group (`GameCanvas.tsx:276-279`), so a committed group that has disengaged can pull back, and an engaged committed group can banish — no extra committed handling needed.

- [ ] **Step 6: Build + lint + sim regression**

Run: `npm run build; if ($?) { npm run lint }; if ($?) { npm run sim }`
Expected: build clean, lint clean, `npm run sim` exits 0 and still prints `retreat-disengage  marched=10  fightingTicks=0` (the sim retreat branch is unchanged; only the UI gate moved).

- [ ] **Step 7: Manual check (dev server)** — `npm run dev -- --port 5174`. Deploy a group, march it into enemy contact. With an enemy adjacent, press RETREAT: the group vanishes and the roster ticks up (banish, −4 CP). In a separate run, march a group out a few hexes with NO enemy adjacent and press RETREAT: the group walks back toward the deploy zone (−2 CP) and becomes re-orderable on arrival.

- [ ] **Step 8: Commit**

```bash
git add src/battle/command-points.ts scripts/test-command-points.ts src/components/GameCanvas.tsx
git commit -m "feat(orders): RETREAT = disengaged pull-back (cheap) vs engaged banish (costlier)"
```

---

### Task A2: Fix hold-reduction off-by-one (reduction applies on the engage tick)

**Files:**
- Create: `scripts/test-hold.ts`
- Modify: `src/battle/simulate.ts:850-856` (combat-phase reduction lookup)

- [ ] **Step 1: Write the failing test** — create `scripts/test-hold.ts`:

```ts
// Verifies hold's defensive reduction applies on the FIRST tick the group is on hold
// (holdTicks === 0 at that point — the motion phase increments it afterward). Mirrors the
// MapApi/Unit scaffolding of scripts/sim-formations.ts. Run: npx tsx scripts/test-hold.ts
import { simulateTick } from '../src/battle/simulate';
import type { Unit, GroupOrder, SimulationConfig, MapApi } from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const mapApi: MapApi = {
  isInside: () => true,
  isWalkable: () => true,
  getTerrainType: () => 'GRASSLAND',
  getTerrainMods: () => getTerrainMods('GRASSLAND'),
  getTerrainHeight: () => 12,
  isInDeployZone: () => false,
};
const config: SimulationConfig = { damagePerTick: 10, mapApi, currentTick: 1 };

// One red defender at (0,0) with a blue attacker E-adjacent at (1,0). The attacker has huge
// HP so it survives the tick; we only measure the defender's incoming damage.
const scene = (defenderOrder?: GroupOrder): { defenderHp: number } => {
  const defender: Unit = {
    id: 'd', team: 'red', unitType: 'infantry', tacticalHex: { q: 0, r: 0 }, homeHex: { q: 0, r: 0 },
    groupId: 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1,
  };
  const attacker: Unit = {
    id: 'a', team: 'blue', unitType: 'infantry', tacticalHex: { q: 1, r: 0 }, homeHex: { q: 1, r: 0 },
    groupId: 1, hp: 9999, state: 'idle', nextMoveTick: 0, visionRadius: 1,
  };
  const orders = new Map<string, GroupOrder>();
  if (defenderOrder) orders.set(`${defenderOrder.team}:${defenderOrder.groupId}`, defenderOrder);
  const res = simulateTick([defender, attacker], orders, config);
  const d = res.units.find(u => u.id === 'd')!;
  return { defenderHp: d.hp };
};

const control = scene(); // no order → no hold reduction
const held = scene({ team: 'red', groupId: 1, attackTarget: null, heading: 0, mode: 'hold', holdTicks: 0 });

check('control defender took damage', control.defenderHp < 100, `hp=${control.defenderHp}`);
check('hold reduces incoming damage on the engage tick',
  held.defenderHp > control.defenderHp, `held=${held.defenderHp} control=${control.defenderHp}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-hold.ts`
Expected: FAIL on "hold reduces incoming damage on the engage tick" — currently `held === control` because `holdTicks:0` yields no reduction on tick 1. Exit 1.

- [ ] **Step 3: Fix the combat-phase reduction lookup** — in `src/battle/simulate.ts`, replace the loop at lines 850-856:

```ts
  const holdReductionByUnit = new Map<string, number>();
  for (const u of working) {
    const order = orders.get(groupOrderKey(u.team, u.groupId));
    // Reduction applies from the tick hold is engaged: holdTicks is 0 on that tick (the
    // motion phase increments it afterward), so count it as the 1st held tick here.
    if (order?.mode === 'hold') {
      holdReductionByUnit.set(u.id, holdReduction((order.holdTicks ?? 0) + 1));
    }
  }
```

- [ ] **Step 4: Run the hold test to verify it passes**

Run: `npx tsx scripts/test-hold.ts`
Expected: PASS, `2/2 passed`, exit 0.

- [ ] **Step 5: Sim regression (hold curve shifted by one tick — confirm no scenario broke)**

Run: `npm run sim; if ($?) { npm run test:scoring }`
Expected: both exit 0; `npm run sim` scenario lines unchanged (no scenario uses `mode:'hold'`).

- [ ] **Step 6: Commit**

```bash
git add scripts/test-hold.ts src/battle/simulate.ts
git commit -m "fix(sim): hold reduction applies on the engage tick (off-by-one)"
```

---

### Task A3: Plug the `firstMarch` recycle leak (anti-drip-feed economy)

**Problem:** `marchedGroups` keys (`team:groupId`) are never cleared when a group empties (all units die or raid the line and return to roster). A recycled slot reusing that key pays the cheap `march` (2) instead of `firstMarch` (4) — leaking the anti-drip-feed surcharge.

**Files:**
- Modify: `src/canvas/useBattleTick.ts:24-51` (extend `BattleTickCtx`)
- Modify: `src/canvas/useBattleTick.ts:235-244` (prune on recycle)
- Modify: `src/components/GameCanvas.tsx` (pass the two new ctx fields into `useBattleTick`)

- [ ] **Step 1: Extend `BattleTickCtx`** — in `src/canvas/useBattleTick.ts`, add after `cpMaxRef` (line 50):

```ts
  cpMaxRef: MutableRefObject<number>;
  // Group-order keys whose firstMarch surcharge is already paid this battle. Pruned here
  // when a group empties so a recycled slot re-pays firstMarch.
  marchedGroupsRef: MutableRefObject<Set<string>>;
  setMarchedGroups: Dispatch<SetStateAction<Set<string>>>;
```

- [ ] **Step 2: Prune `marchedGroups` in the emptied-group pass** — in `src/canvas/useBattleTick.ts`, immediately after the order-reset loop (after line 243 `}` and before line 244 `if (orders !== ctx.groupOrdersRef.current) ctx.setGroupOrders(orders);`), insert:

```ts
      // Drop dead groups' keys from marchedGroups so a recycled slot re-pays firstMarch
      // (keeps the anti-drip-feed surcharge from leaking on recycle).
      const marched = ctx.marchedGroupsRef.current;
      let prunedMarched: Set<string> | null = null;
      for (const key of marched) {
        if (liveGroups.has(key)) continue;
        if (!prunedMarched) prunedMarched = new Set(marched);
        prunedMarched.delete(key);
      }
      if (prunedMarched) {
        ctx.marchedGroupsRef.current = prunedMarched;
        ctx.setMarchedGroups(prunedMarched);
      }
```

(`liveGroups` is already computed at line 235 as `new Set(survivors.map(u => \`${u.team}:${u.groupId}\`))` — same key format as `marchedGroups`.)

- [ ] **Step 3: Pass the fields from `GameCanvas.tsx`** — find the `useBattleTick({ … })` call in `src/components/GameCanvas.tsx` (search for `useBattleTick(`) and add to the context object literal (both symbols already exist — `marchedGroupsRef` at line 258, `setMarchedGroups` from the `useState` at line 136):

```ts
    marchedGroupsRef,
    setMarchedGroups,
```

- [ ] **Step 4: Build + lint**

Run: `npm run build; if ($?) { npm run lint }`
Expected: both clean (no type error about missing ctx fields).

- [ ] **Step 5: Manual check (dev server)** — `npm run dev -- --port 5174`. March a fresh group (HUD MARCH chip shows the firstMarch cost, 4). Let that group's units all die or reach the enemy line so the slot returns to roster. Re-place + MARCH a group on the same group id: the HUD chip again shows firstMarch (4), not march (2).

- [ ] **Step 6: Commit**

```bash
git add src/canvas/useBattleTick.ts src/components/GameCanvas.tsx
git commit -m "fix(orders): re-charge firstMarch when an emptied group slot is recycled"
```

---

### Task A4: Guard `beginOrderDrag` against committed groups

**Problem:** `beginOrderDrag`/`commitOrderDrag` have no `committed` check, so dragging a committed (unleashed) group charges 3 CP and teleports its units to new formation slots before `issueOrder` silently rejects the intent change — an incoherent state.

**Files:**
- Modify: `src/canvas/input/orderDrag.ts:50-57` (`beginOrderDrag`)

- [ ] **Step 1: Add the guard** — in `src/canvas/input/orderDrag.ts`, after the empty-group check at line 57 (`if (groupUnits.length === 0) return;`), insert:

```ts
  if (groupUnits.length === 0) return;
  // Committed (unleashed) groups are locked — don't begin a redeploy drag (it would charge
  // CP and teleport units before issueOrder rejects the change).
  if (ctx.groupOrdersRef.current.get(groupOrderKey(team, groupId))?.committed) return;
```

(`groupOrderKey` is already imported and used at line 60.)

- [ ] **Step 2: Build + lint**

Run: `npm run build; if ($?) { npm run lint }`
Expected: both clean.

- [ ] **Step 3: Manual check (dev server)** — unleash a group (it commits), then attempt an order-drag on it: nothing happens (no CP spent, no teleport, no preview commit). A non-committed group still drags/redeploys normally.

- [ ] **Step 4: Commit**

```bash
git add src/canvas/input/orderDrag.ts
git commit -m "fix(input): don't start an order-drag on a committed group"
```

---

### Task A5: Per-team default heading for the `issueOrder` skeleton

**Problem:** the order skeleton defaults `heading: 0` (E), which is outside red's forward cone. Any future `issueOrder` that omits `heading` on a fresh red order leaves it out of cone.

**Files:**
- Modify: `src/components/GameCanvas.tsx:281-285` (`issueOrder` skeleton)

- [ ] **Step 1: Make the default team-aware** — in `src/components/GameCanvas.tsx`, change the skeleton object at lines 281-285. Old:

```ts
    next.set(key, {
      team, groupId, attackTarget: null, heading: 0,
      ...existing,
      ...change,
    });
```

New (mirrors `marchForward`'s default at line 633):

```ts
    next.set(key, {
      team, groupId, attackTarget: null, heading: team === 'red' ? 2 : 5,
      ...existing,
      ...change,
    });
```

- [ ] **Step 2: Build + lint**

Run: `npm run build; if ($?) { npm run lint }`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/GameCanvas.tsx
git commit -m "fix(orders): default a new order's heading to the team's forward direction"
```

---

## Phase B — Movement follower

### Task B1: Pure `planFollowerLegs` helper + test

**Goal:** one function that, given a unit's one-tick move `oldHex → newHex`, returns the glide legs: one waypoint per intermediate hex center (via `HexUtils.hexLine`, no corner-cutting), all sharing one speed derived from the distance actually covered this tick so the whole move finishes in exactly one tick (lengthened by destination `moveCost`, matching the sim's `nextMoveTick = tick + 1 + moveCost`). This replaces the old "one waypoint at the final hex, speed = nominal hexes/tick" logic that pulsed on fractional speeds and cut corners on multi-hex ticks.

**Files:**
- Create: `src/canvas/render/followerPath.ts`
- Create: `scripts/test-follower-path.ts`

- [ ] **Step 1: Write the failing test** — create `scripts/test-follower-path.ts`:

```ts
// Verifies planFollowerLegs traces the per-tick hex path and finishes each tick's move in
// exactly one tick. Run: npx tsx scripts/test-follower-path.ts
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { planFollowerLegs, PX_PER_HEX } from '../src/canvas/render/followerPath';
import { TICK_MS } from '../src/canvas/constants';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};
const approx = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;
const flat = (h: Hex) => HexUtils.hexToPixel(h); // identity pixel map, no elevation

// dist 0 → no legs (nothing moved).
check('dist 0 yields no legs', planFollowerLegs({ q: 0, r: 0 }, { q: 0, r: 0 }, flat, 0).length === 0);

// dist 1 → one leg ending at the destination, covered in one tick (moveCost 0).
{
  const dest = HexUtils.directions[0];
  const legs = planFollowerLegs({ q: 0, r: 0 }, dest, flat, 0);
  const p = HexUtils.hexToPixel(dest);
  check('dist 1 yields one leg', legs.length === 1);
  check('dist 1 ends at destination', approx(legs[0].x, p.x) && approx(legs[0].y, p.y));
  check('dist 1 finishes in one tick', approx(legs[0].speed * (TICK_MS / 1000), PX_PER_HEX));
}

// dist 2 straight → two legs tracing hexLine centers, equal speed, total covered in one tick.
{
  const a = { q: 0, r: 0 }, b = { q: 2, r: 0 };
  const legs = planFollowerLegs(a, b, flat, 0);
  const line = HexUtils.hexLine(a, b).slice(1);
  check('dist 2 yields two legs', legs.length === 2);
  check('dist 2 legs share one speed', approx(legs[0].speed, legs[1].speed));
  check('dist 2 traces hex centers', line.every((h, i) => {
    const p = HexUtils.hexToPixel(h);
    return approx(legs[i].x, p.x) && approx(legs[i].y, p.y);
  }));
  check('dist 2 finishes in one tick', approx(legs[0].speed * (TICK_MS / 1000), 2 * PX_PER_HEX));
}

// moveCost lengthens the tick: cost 2 → one-third the speed of cost 0.
{
  const fast = planFollowerLegs({ q: 0, r: 0 }, HexUtils.directions[0], flat, 0)[0].speed;
  const slow = planFollowerLegs({ q: 0, r: 0 }, HexUtils.directions[0], flat, 2)[0].speed;
  check('moveCost 2 is one-third speed', approx(slow * 3, fast));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-follower-path.ts`
Expected: FAIL — `Cannot find module '../src/canvas/render/followerPath'` (helper not created yet). Exit 1.

- [ ] **Step 3: Create the helper** — create `src/canvas/render/followerPath.ts`:

```ts
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { TICK_MS } from '../constants';

/** Center-to-center pixel spacing of adjacent hexes — converts hex/tick speeds to px/sec. */
export const PX_PER_HEX = (() => {
  const o = HexUtils.hexToPixel({ q: 0, r: 0 });
  const n = HexUtils.hexToPixel(HexUtils.directions[0]);
  return Math.hypot(n.x - o.x, n.y - o.y);
})();

export interface FollowerLeg { x: number; y: number; speed: number }

/**
 * Plan the visual glide for a unit that moved oldHex→newHex in ONE sim tick.
 * Returns one leg per intermediate hex center (via HexUtils.hexLine) so the sprite traces
 * the real hex path instead of a straight diagonal, all sharing one speed so the whole move
 * completes in exactly one tick — lengthened by destination moveCost to match the sim's
 * entry cooldown (nextMoveTick = tick + 1 + moveCost). Returns [] when nothing moved.
 *
 * `topPixel` maps a hex to its on-screen position including terrain elevation (so legs glide
 * over hills/valleys, not through them).
 */
export function planFollowerLegs(
  oldHex: Hex,
  newHex: Hex,
  topPixel: (h: Hex) => { x: number; y: number },
  moveCostAtDest: number,
): FollowerLeg[] {
  const dist = HexUtils.distance(oldHex, newHex);
  if (dist === 0) return [];
  const tickSeconds = (TICK_MS * (1 + moveCostAtDest)) / 1000;
  const speed = (dist * PX_PER_HEX) / tickSeconds;
  return HexUtils.hexLine(oldHex, newHex).slice(1).map(h => {
    const p = topPixel(h);
    return { x: p.x, y: p.y, speed };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-follower-path.ts`
Expected: PASS, `8/8 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/canvas/render/followerPath.ts scripts/test-follower-path.ts
git commit -m "feat(render): pure planFollowerLegs — trace per-tick hex path at delivered speed"
```

---

### Task B2: Wire `planFollowerLegs` into `drawUnits.ts`

**Files:**
- Modify: `src/canvas/render/drawUnits.ts` — imports, `UnitContainer` type (line 40-42), `PX_PER_HEX` (lines 44-49), creation block (~330-343), the move branch (~344-367).

- [ ] **Step 1: Update imports** — in `src/canvas/render/drawUnits.ts`:
  - Add `type Hex` to the HexUtils import (it currently imports `HexUtils`): `import { HexUtils, type Hex } from '../../hex-engine/HexUtils';` (match the file's existing relative path).
  - Add: `import { planFollowerLegs, PX_PER_HEX } from './followerPath';`
  - Remove the now-unused `MARCH_HEXES_PER_TICK` / `CHARGE_HEXES_PER_TICK` from their import (only if not referenced elsewhere in the file — grep first; see Step 6).

- [ ] **Step 2: Delete the local `PX_PER_HEX`** — remove lines 44-49 (the `const PX_PER_HEX = (() => { … })();` block) now that it's imported from `followerPath`. (The IIFE in `followerPath.ts` is identical.)

- [ ] **Step 3: Add `_hex` to the container type** — in the `UnitContainer` type (lines 40-42), add `_hex?: Hex;`:

```ts
  _targetKey?: string; _hexKey?: string; _hex?: Hex; _visual?: UnitVisual;
  _path?: { x: number; y: number; speed: number }[];
};
```

- [ ] **Step 4: Seed `_hex` on container creation** — in the creation block, next to `container._hexKey = hexKey;` (line 336), add:

```ts
      container._hexKey = hexKey;
      container._hex = u.tacticalHex;
```

- [ ] **Step 5: Replace the move branch** — in the `else if (container._targetKey !== targetKey)` block, replace the body from `const path = …` through the `if (jump > PX_PER_HEX * 7) { … } else { path.push({ x: pos.x, y: topY, speed }); }` (lines ~350-367) with:

```ts
      const path = container._path ?? (container._path = []);
      const moveCost = getTerrainMods(tileType).moveCost;
      const oldHex = container._hex ?? u.tacticalHex;
      container._hex = u.tacticalHex;
      // Teleports (redeploy, order-drag reposition, world regen) jump farther than any single
      // tick's march/charge could — snap instead of gliding across the map.
      const tail = path.length > 0 ? path[path.length - 1] : from;
      const jump = Math.hypot(pos.x - tail.x, topY - tail.y);
      if (jump > PX_PER_HEX * 7) {
        path.length = 0;
        container.position.set(pos.x, topY);
      } else {
        // Trace the actual per-tick hex path (no corner-cutting) at the delivered speed (no
        // fast/slow pulsing on fractional speeds). Elevation per intermediate hex via tileType.
        const topPixel = (h: Hex) => {
          const t = tileTypeByKey.get(HexUtils.key(h));
          const p = HexUtils.hexToPixel(h);
          return { x: p.x, y: t != null ? p.y - TERRAINS[t].height : p.y };
        };
        const legs = planFollowerLegs(oldHex, u.tacticalHex, topPixel, moveCost);
        if (legs.length === 0) container.position.set(pos.x, topY); // same hex, new elevation
        else for (const leg of legs) path.push(leg);
      }
```

(`tileTypeByKey` is the per-frame Map already built earlier in `drawUnits` and used at line 313; `TERRAINS` and `getTerrainMods` are already imported.)

- [ ] **Step 6: Verify no dangling references** — confirm the old speed locals are gone and unused imports removed:

Run: `Grep` for `hexPerTick`, `MARCH_HEXES_PER_TICK`, `CHARGE_HEXES_PER_TICK` in `src/canvas/render/drawUnits.ts`.
Expected: zero matches for `hexPerTick`; the two `*_HEXES_PER_TICK` constants appear only if still used elsewhere — if zero matches, drop them from the import (Step 1).

- [ ] **Step 7: Build + lint**

Run: `npm run build; if ($?) { npm run lint }`
Expected: both clean (no unused-import or undefined-symbol errors).

- [ ] **Step 8: Manual check (dev server)** — `npm run dev -- --port 5174`. March infantry (speed 1.5 → alternating 1/2-hex ticks): motion is smooth and continuous, no fast/slow pulse, and the sprite stays centered on the hex lane (no diagonal corner-cut on the 2-hex ticks). Charge a mixed cavalry+infantry group: cavalry sprites no longer race ahead and stall — every unit glides at its delivered per-tick distance. Redeploy / regenerate world: units snap (no glide across the map).

- [ ] **Step 9: Commit**

```bash
git add src/canvas/render/drawUnits.ts
git commit -m "fix(render): follower traces real hex path at delivered speed (no pulse/corner-cut)"
```

---

## Phase C — Doc-rot & constants

### Task C1: Correct the order-mode docs, refresh stale speed comments, remove dead fixtures

**Files:**
- Modify: `CLAUDE.md` (order-modes sentence)
- Modify: `AGENTS.md` (order-modes sentence, if present)
- Modify: `src/battle/simulate.ts:24-32` (doctype march/charge speeds)
- Modify: `scripts/sim-formations.ts` (charge-clear comment; gated dead-fixture removal)

- [ ] **Step 1: Fix the CLAUDE.md mode list** — in `CLAUDE.md`, the "Battle simulator" section currently reads:
  `Five order modes (`march` / `charge` / `retreat` / `unleash` / `defendHeight`). … DefendHeight spreads to the perimeter of a sticky home-terrain blob.`
  Replace with the real modes (no `defendHeight` on this branch; `OrderMode` is `march | hold | idle | charge | retreat | unleash`):
  `Order modes (`march` / `charge` / `retreat` / `unleash` / `hold` / `idle`). March, charge, retreat are rigid-block — every unit waits on the slowest cooldown. Unleash is per-unit greedy. Hold stands still and accrues a defensive damage reduction. Retreat (UI): a disengaged group pulls back via sim `retreat` mode; an engaged group is banished off-field for a partial refund.`

- [ ] **Step 2: Fix AGENTS.md if it repeats the claim**

Run: `Grep` for `defendHeight` across the repo.
Expected: locate any remaining prose references (e.g. `AGENTS.md`). Edit each to drop `defendHeight` and match the corrected CLAUDE.md wording. Leave code/fixtures for Step 4.

- [ ] **Step 3: Refresh the simulate.ts doctype speeds** — in `src/battle/simulate.ts:24-32`, update any comment stating "infantry 2 hexes/tick march" / "cavalry 4 hexes/tick march" to the current `units.json` values (march 3/4/6 per second resolved via `stepsForTick`; charge per `CHARGE_HEXES_PER_TICK`). State the rates as "see `src/data/units.json`" rather than hard-coding numbers that drift again.

- [ ] **Step 4: Remove dead `defendHeight` fixtures (gated)** — in `scripts/sim-formations.ts`:

Run: `Grep` for each of `HILL_BLOB_WITH_RIVERS`, `RIDGELINE_BLOB`, `RIDGELINE_TERRAIN`, `RIDGELINE_WITH_RIVERS`, `HILL_DIRECTIONAL_TERRAIN` in `scripts/sim-formations.ts`.
For each symbol with exactly ONE match (its own declaration, no usage), delete the declaration and its doc comment. If any symbol is still referenced by a live scenario, leave it. Also drop the `THICKET`/`RIDGELINE` entries from `HARNESS_HEIGHTS` only if `Grep` shows neither string appears elsewhere in the file.

- [ ] **Step 5: Fix the charge-clear comment** — in `scripts/sim-formations.ts` near the `charge-clear` scenario (~line 229-231), update the comment "CHARGE_SPEED_HEXES (2) … = 13 total" to match the current charge speed/distance, or replace the hard numbers with "advances `CHARGE_HEXES_PER_TICK` per tick for `CHARGE_DURATION_TICKS` ticks, then reverts to march."

- [ ] **Step 6: Build + lint + full harness sweep**

Run: `npm run build; if ($?) { npm run lint }; if ($?) { npm run sim }; if ($?) { npm run test:cp }; if ($?) { npm run test:scoring }`
Expected: all clean / exit 0. `npm run sim` still runs all scenarios (removing unused fixtures doesn't change scenario output).

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md AGENTS.md src/battle/simulate.ts scripts/sim-formations.ts
git commit -m "docs(orders): correct mode list (no defendHeight), refresh speed comments, drop dead fixtures"
```

---

### Task C2 (optional, low value): Name the unleash beacon distance

**Files:**
- Modify: `src/battle/simulate.ts` (~lines 1112, 1272 — the `* 64` forward-beacon projections)

- [ ] **Step 1: Hoist the constant** — near the other sim tunables at the top of `src/battle/simulate.ts`, add:

```ts
// Unleash projects a "beacon" this many hexes forward as a direction, not a destination.
// Must exceed the grid diameter (gridRadius=35 → diameter 70) so it never lands on-grid.
const UNLEASH_BEACON_DIST = 64;
```

- [ ] **Step 2: Replace both `* 64` usages** — in `forwardBeacon` (line ~1112) and the unleash redirect fallback (line ~1272), replace the literal `64` (in the `* 64` projection) with `UNLEASH_BEACON_DIST`.

  Note: `UNLEASH_BEACON_DIST` (64) is currently < the grid diameter (70) — flag in the commit message that it should be raised above 70 if the beacon must always be off-grid; do NOT change the value in this task (behavior-preserving rename only).

- [ ] **Step 3: Build + lint + sim**

Run: `npm run build; if ($?) { npm run lint }; if ($?) { npm run sim }`
Expected: all clean; the `unleash-*` scenarios print identical results (rename only, no value change).

- [ ] **Step 4: Commit**

```bash
git add src/battle/simulate.ts
git commit -m "refactor(sim): name the unleash forward-beacon distance constant"
```

---

## Final verification gate

- [ ] Run the full suite and confirm every line is green:

```
npm run build
npm run lint
npm run sim
npm run test:cp
npm run test:scoring
npx tsx scripts/test-group-seals.ts
npx tsx scripts/test-worldgen.ts
npx tsx scripts/test-hold.ts
npx tsx scripts/test-follower-path.ts
```

Expected: build + lint clean; every harness exits 0.

- [ ] Push `feature/infra`:

```bash
git push origin feature/infra
```

---

## Self-Review

**Spec coverage** (each audit finding → task):
- Follower pulse + corner-cut + charge-group-min race → **B1 + B2** (delivered-speed legs auto-fix the charge race; buffer-trim splice becomes effectively dead).
- `firstMarch` recycle leak → **A3**.
- `defendHeight` doc-rot + stale comments + dead fixtures → **C1**.
- orderDrag committed guard → **A4**.
- retreat two-designs / engaged escape → **A1** (now the explicit disengaged-vs-engaged design).
- hold off-by-one → **A2**.
- `issueOrder` default heading out-of-cone for red → **A5**.
- `*64` beacon magic constant → **C2** (optional).
- Snap-threshold `*7` magic number → intentionally NOT planned (deriving it adds a data dependency for negligible gain; left as-is, noted here).

**Placeholder scan:** every code step shows full code; the two grep-gated steps (B2 Step 6, C1 Step 4) specify the exact command and the decision rule rather than "remove if unused" hand-waving.

**Type consistency:** `planFollowerLegs(oldHex, newHex, topPixel, moveCostAtDest)` and `PX_PER_HEX` are defined in B1 and consumed with the same names/signature in B2 and the test. `FollowerLeg` `{x,y,speed}` matches the existing `_path` element shape in `drawUnits.ts`. New CP key `banish` is added in A1 to both `command-points.ts` and the `test-command-points.ts` expected table. `BattleTickCtx` gains `marchedGroupsRef`/`setMarchedGroups` in A3 and they are passed from `GameCanvas.tsx` in the same task.

**Testability note:** A1/A4/A5 and B2 touch React/PIXI/input code that the headless harnesses cannot drive; their verification is build + lint + `npm run sim` (no regression) + the stated manual dev-server checklist. A2 and B1 are fully harness-tested (new `test-hold.ts`, `test-follower-path.ts`); A3's prune is verified by build/lint + manual recycle check (the logic is a one-line set intersection, not worth a React harness).
