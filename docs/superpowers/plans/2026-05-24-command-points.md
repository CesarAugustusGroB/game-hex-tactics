# Command Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-team Command Points pool (cap 20, +1 every 4 ticks) that gates every battlefield decision (deploy, orders, mode toggles) for both player and AI through a single `chargeCP` layer.

**Architecture:** Pure CP module (`src/battle/command-points.ts`) owns the types, constants, and pure helpers (`canAfford`, `debit`, `applyRegen`). `GameCanvas` wraps the helpers with ref + state-mirror plumbing (`chargeCP`, `triggerBrokeFlash`) and threads them into every handler/hook ctx that mutates orders or units. The sim (`simulate.ts`) is untouched — CP is an authorisation layer above `issueOrder`, not part of the simulation.

**Tech Stack:** TypeScript, React, Vite, PIXI v8, `tsx` (for the headless test harness — there is no test runner; the project uses script-based scenario harnesses, mirroring `scripts/sim-formations.ts`).

---

## File map

**New files:**
- `src/battle/command-points.ts` — pure module: types, constants, `canAfford`, `debit`, `applyRegen`, `makeInitialCommandPoints`.
- `scripts/test-command-points.ts` — scenario harness for the pure module.

**Modified files:**
- `package.json` — add `test:cp` npm script.
- `src/components/GameCanvas.tsx` — own `commandPointsRef` + state mirror; expose `chargeCP`/`canAfford`/`triggerBrokeFlash` callbacks; thread into every hook ctx; reset CP alongside other state on regen/return/reset.
- `src/canvas/useBattleTick.ts` — accept `commandPointsRef`, `setCommandPoints` in ctx; call `applyRegen` on tick.
- `src/canvas/HUD.tsx` — render bottom-center CP bar; add per-button cost chips; gate `disabled` on `canAfford`; trigger red flash via prop.
- `src/canvas/input/paintMode.ts` — `paintPlace` gates on `chargeCP('placeCohort')` after validating non-empty target.
- `src/canvas/input/orderDrag.ts` — `commitOrderDrag` rejects drags outside deploy zone; on valid drop, gates on `chargeCP('orderDrag')`.
- `src/battle/ai.ts` — extend `AiTickState`: add `cp: number`; change `issueOrder` to `(gid, change, intent) => boolean`.

---

### Task 1: Pure Command Points module + test harness

**Files:**
- Create: `src/battle/command-points.ts`
- Create: `scripts/test-command-points.ts`
- Modify: `package.json`

- [ ] **Step 1.1: Write the pure module.**

Create `src/battle/command-points.ts`:

```ts
import type { Team } from '../battle/simulate';

export const CP_CAP = 20;
export const CP_REGEN_PER_N_TICKS = 4;
export const CP_INITIAL = CP_CAP;

export const CP_COSTS = {
  assign: 0,
  idle: 0,
  meta: 0,
  debug: 0,
  cycleHeading: 1,
  cycleFormation: 1,
  march: 2,
  placeCohort: 2,
  orderDrag: 3,
  hold: 4,
  retreat: 4,
  charge: 6,
  unleash: 6,
} as const;

export type CpIntent = keyof typeof CP_COSTS;

export type CommandPoints = Record<Team, number>;

export function makeInitialCommandPoints(): CommandPoints {
  return { red: CP_INITIAL, blue: CP_INITIAL };
}

export function canAfford(cp: CommandPoints, team: Team, intent: CpIntent): boolean {
  return cp[team] >= CP_COSTS[intent];
}

/** Returns a new CommandPoints with `team` debited by `CP_COSTS[intent]`, or null
 *  if the team can't afford it. Never mutates the input. */
export function debit(cp: CommandPoints, team: Team, intent: CpIntent): CommandPoints | null {
  const cost = CP_COSTS[intent];
  if (cp[team] < cost) return null;
  return { ...cp, [team]: cp[team] - cost };
}

/** Returns new CommandPoints with both teams incremented by 1 (clamped to CP_CAP)
 *  if `tick % CP_REGEN_PER_N_TICKS === 0`. Otherwise returns the input unchanged. */
export function applyRegen(cp: CommandPoints, tick: number): CommandPoints {
  if (tick % CP_REGEN_PER_N_TICKS !== 0) return cp;
  const r = Math.min(CP_CAP, cp.red + 1);
  const b = Math.min(CP_CAP, cp.blue + 1);
  if (r === cp.red && b === cp.blue) return cp;
  return { red: r, blue: b };
}
```

- [ ] **Step 1.2: Write the test harness FIRST (TDD — it will fail to compile until 1.1 is done; or run before 1.1 to confirm failure mode).**

Create `scripts/test-command-points.ts`:

```ts
/**
 * Headless harness for the pure Command Points module. Verifies cost table, debit
 * (success + broke + immutability), regen cadence and cap clamping, initial state.
 *
 * Mirrors the pattern of scripts/sim-formations.ts. Run with: npm run test:cp
 */
import {
  CP_CAP, CP_COSTS, CP_REGEN_PER_N_TICKS, makeInitialCommandPoints,
  canAfford, debit, applyRegen,
} from '../src/battle/command-points';

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function check(name: string, cond: boolean, detail?: string) {
  results.push({ name, pass: cond, detail });
}

// makeInitialCommandPoints
{
  const cp = makeInitialCommandPoints();
  check('initial both teams at cap', cp.red === CP_CAP && cp.blue === CP_CAP,
    `red=${cp.red} blue=${cp.blue}`);
}

// canAfford
{
  const cp = { red: 6, blue: 0 };
  check('canAfford true when exactly enough', canAfford(cp, 'red', 'charge'));
  check('canAfford false when broke', !canAfford(cp, 'blue', 'march'));
  check('canAfford true for 0-cost actions even at 0', canAfford(cp, 'blue', 'idle'));
}

// debit — happy path
{
  const cp = { red: 10, blue: 5 };
  const after = debit(cp, 'red', 'charge');
  check('debit returns new object on success', after !== null && after !== cp);
  check('debit does not mutate input', cp.red === 10);
  check('debit deducts cost from team', after !== null && after.red === 4);
  check('debit leaves other team alone', after !== null && after.blue === 5);
}

// debit — broke
{
  const cp = { red: 3, blue: 20 };
  const after = debit(cp, 'red', 'charge'); // costs 6
  check('debit returns null when broke', after === null);
}

// debit — 0-cost
{
  const cp = { red: 0, blue: 20 };
  const after = debit(cp, 'red', 'idle');
  check('debit with 0-cost at 0 CP still succeeds', after !== null && after.red === 0);
}

// applyRegen — off-cadence
{
  const cp = { red: 5, blue: 5 };
  const t = applyRegen(cp, 1);
  check('regen no-op on off-cadence tick', t === cp);
}

// applyRegen — on-cadence
{
  const cp = { red: 5, blue: 5 };
  const t = applyRegen(cp, CP_REGEN_PER_N_TICKS);
  check('regen +1 both teams on cadence tick', t.red === 6 && t.blue === 6);
}

// applyRegen — clamp at cap
{
  const cp = { red: CP_CAP, blue: CP_CAP };
  const t = applyRegen(cp, CP_REGEN_PER_N_TICKS);
  check('regen clamped at cap (no-op same ref)', t === cp);
}

// applyRegen — one capped, one not
{
  const cp = { red: CP_CAP - 1, blue: CP_CAP };
  const t = applyRegen(cp, CP_REGEN_PER_N_TICKS);
  check('regen one team capped, other ticks up', t.red === CP_CAP && t.blue === CP_CAP);
}

// CP_COSTS table consistency
{
  const expected = { assign: 0, idle: 0, meta: 0, debug: 0,
    cycleHeading: 1, cycleFormation: 1, march: 2, placeCohort: 2, orderDrag: 3,
    hold: 4, retreat: 4, charge: 6, unleash: 6 } as const;
  const ok = (Object.keys(expected) as (keyof typeof expected)[])
    .every(k => CP_COSTS[k] === expected[k]);
  check('CP_COSTS matches spec table', ok);
}

// Report
for (const r of results) {
  console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 1.3: Add the npm script.**

Modify `package.json` — add `test:cp` after `sim`:

```json
"sim": "tsx scripts/sim-formations.ts",
"test:cp": "tsx scripts/test-command-points.ts"
```

- [ ] **Step 1.4: Run the harness.**

Run: `npm run test:cp`
Expected: all 13 lines `✓`, exit 0, footer `13/13 passed`.

- [ ] **Step 1.5: Commit.**

```
git add src/battle/command-points.ts scripts/test-command-points.ts package.json
git commit -m "Add pure command-points module with test harness"
```

---

### Task 2: GameCanvas — CP state, chargeCP, brokeFlash, reset wiring

**Files:**
- Modify: `src/components/GameCanvas.tsx`

- [ ] **Step 2.1: Add imports near the top of GameCanvas.tsx.**

Find the existing canvas-module imports (the block that imports `STRATEGIC_RESOLUTION`, etc. from `'../canvas/constants'`) and append a new import line:

```ts
import {
  CP_CAP, CP_INITIAL, CP_COSTS, type CommandPoints, type CpIntent,
  makeInitialCommandPoints, debit,
} from '../battle/command-points';
```

- [ ] **Step 2.2: Add the ref, state mirror, and broke-flash state.**

Find the block where other refs are declared (near `lastTickHadBothTeamsRef`, `tickCounterRef`). Insert after `tickCounterRef`:

```ts
const commandPointsRef = useRef<CommandPoints>(makeInitialCommandPoints());
const [commandPoints, setCommandPoints] = useState<CommandPoints>(makeInitialCommandPoints());
const [brokeFlash, setBrokeFlash] = useState<{ red: boolean; blue: boolean }>({ red: false, blue: false });
```

- [ ] **Step 2.3: Add chargeCP, canAfford, triggerBrokeFlash callbacks.**

Find the block where `issueOrder` and `clearOrder` are defined with `useCallback`. After `clearOrder`, add:

```ts
const canAfford = useCallback((team: Team, intent: CpIntent): boolean => {
  return commandPointsRef.current[team] >= CP_COSTS[intent];
}, []);

const chargeCP = useCallback((team: Team, intent: CpIntent): boolean => {
  const next = debit(commandPointsRef.current, team, intent);
  if (next === null) return false;
  commandPointsRef.current = next;
  setCommandPoints(next);
  return true;
}, []);

const triggerBrokeFlash = useCallback((team: Team) => {
  setBrokeFlash(prev => ({ ...prev, [team]: true }));
  window.setTimeout(() => {
    setBrokeFlash(prev => ({ ...prev, [team]: false }));
  }, 200);
}, []);
```

- [ ] **Step 2.4: Reset CP on each lifecycle wipe.**

In `resetBattle`, `returnToStrategic`, and `regenerateWorld`, add the two lines below alongside the existing `tickCounterRef.current = 0;`:

```ts
commandPointsRef.current = makeInitialCommandPoints();
setCommandPoints(makeInitialCommandPoints());
```

- [ ] **Step 2.5: Type-check.**

Run: `npm run build`
Expected: build succeeds. (Unused `canAfford`, `chargeCP`, `triggerBrokeFlash`, `brokeFlash`, `setBrokeFlash`, `commandPoints` warnings are fine — wired in later tasks.)

If build fails because TS is strict about unused locals, temporarily prefix unused names with `_` or add `// eslint-disable-next-line` lines, then remove the disable in the task that uses them.

- [ ] **Step 2.6: Commit.**

```
git add src/components/GameCanvas.tsx
git commit -m "Wire CP state, chargeCP helper, and broke-flash into GameCanvas"
```

---

### Task 3: Battle tick regen

**Files:**
- Modify: `src/canvas/useBattleTick.ts`
- Modify: `src/components/GameCanvas.tsx` (extend the BattleTickCtx assembly)

- [ ] **Step 3.1: Extend BattleTickCtx interface.**

In `src/canvas/useBattleTick.ts`, add two fields to `BattleTickCtx`:

```ts
commandPointsRef: MutableRefObject<CommandPoints>;
setCommandPoints: Dispatch<SetStateAction<CommandPoints>>;
```

Add the import at the top of the file:

```ts
import { applyRegen, type CommandPoints } from '../battle/command-points';
```

- [ ] **Step 3.2: Call applyRegen inside the tick callback.**

Inside `useBattleTick`, immediately after the line `ctx.tickCounterRef.current += 1;`, add:

```ts
const cpBefore = ctx.commandPointsRef.current;
const cpAfter = applyRegen(cpBefore, ctx.tickCounterRef.current);
if (cpAfter !== cpBefore) {
  ctx.commandPointsRef.current = cpAfter;
  ctx.setCommandPoints(cpAfter);
}
```

- [ ] **Step 3.3: Wire the new fields from GameCanvas.**

In `src/components/GameCanvas.tsx`, find the `battleCtx: BattleTickCtx = { ... }` object literal and add the two fields:

```ts
commandPointsRef,
setCommandPoints,
```

- [ ] **Step 3.4: Type-check.**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3.5: Manual smoke (optional but recommended).**

Run: `npm run dev`
Open the app, dive into a tactical view, place a unit (no CP cost yet — that's later tasks), press START BATTLE. Open browser devtools console and log `commandPointsRef`-equivalent via React DevTools — confirm both teams' CP tick up by 1 every ~2 seconds (since TICK_MS=500 and regen every 4 ticks). Will visually show only when HUD bar is wired in Task 4.

- [ ] **Step 3.6: Commit.**

```
git add src/canvas/useBattleTick.ts src/components/GameCanvas.tsx
git commit -m "Tick CP regen in useBattleTick"
```

---

### Task 4: HUD bottom-center CP bar

**Files:**
- Modify: `src/canvas/HUD.tsx`

- [ ] **Step 4.1: Extend HUDProps.**

In `src/canvas/HUD.tsx`, add to the `HUDProps` interface:

```ts
commandPoints: { red: number; blue: number };
brokeFlash: { red: boolean; blue: boolean };
```

Add the corresponding import at the top:

```ts
import { CP_CAP } from '../battle/command-points';
```

- [ ] **Step 4.2: Destructure in the HUD component body.**

In the `HUD` component's destructure list (where the existing props like `viewMode`, `isScanning`, etc. are pulled), add `commandPoints` and `brokeFlash`.

- [ ] **Step 4.3: Render the bar.**

Inside the `<div>` that wraps the whole HUD (where the capture-progress strip lives), AFTER the capture-progress strip block, add the bottom-center CP bar block:

```tsx
{viewMode === 'TACTICAL' && currentStrategicHex && (
  <div style={{
    position: 'absolute',
    bottom: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 20px',
    background: 'rgba(15,23,42,0.92)',
    border: '1px solid rgba(250,204,21,0.5)',
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
    backdropFilter: 'blur(12px)',
    zIndex: 150,
    minWidth: '300px',
    color: '#f8fafc',
    pointerEvents: 'none',
  }}>
    <div style={{
      textAlign: 'center', fontSize: '10px', letterSpacing: '2px',
      color: '#facc15', fontWeight: 800, marginBottom: '6px',
    }}>COMMAND POINTS</div>
    {(['red', 'blue'] as const).map(team => {
      const v = commandPoints[team];
      const pct = (v / CP_CAP) * 100;
      const baseColor = team === 'red' ? '#ef4444' : '#3b82f6';
      const flashing = brokeFlash[team];
      return (
        <div key={team} style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          marginBottom: team === 'red' ? '4px' : 0,
        }}>
          <span style={{
            fontSize: '10px', color: baseColor, fontWeight: 800, width: '38px', letterSpacing: '1px',
          }}>{team.toUpperCase()}</span>
          <div style={{
            flex: 1, height: '8px',
            background: flashing ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.08)',
            borderRadius: '4px', overflow: 'hidden',
            transition: 'background 80ms',
          }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: baseColor,
              transition: 'width 120ms ease',
            }} />
          </div>
          <span style={{
            fontSize: '10px', color: '#cbd5e1', fontWeight: 700, width: '40px', textAlign: 'right',
          }}>{v}/{CP_CAP}</span>
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 4.4: Pass the new props from GameCanvas.**

In `src/components/GameCanvas.tsx`, find the `<HUD ... />` JSX and add:

```tsx
commandPoints={commandPoints}
brokeFlash={brokeFlash}
```

- [ ] **Step 4.5: Manual verification.**

Run: `npm run dev`
Open the app, dive tactical, see the bar appear at the bottom-center showing `20/20` for both teams. Press START BATTLE. Confirm both bars tick up by 1 every 2 seconds (they're already at cap so visually no change — drop the cap or manually edit `CP_CAP=10` in command-points.ts to confirm cap behaviour, then revert).

Better: skip the cap toggle. Instead, temporarily set `CP_INITIAL = 0` in `command-points.ts` to start at 0 and watch the bar fill. Then revert.

- [ ] **Step 4.6: Commit.**

```
git add src/canvas/HUD.tsx src/components/GameCanvas.tsx
git commit -m "Render bottom-center CP bar with both teams and broke-flash"
```

---

### Task 5: paintPlace — gate cohort placement on CP

**Files:**
- Modify: `src/canvas/input/paintMode.ts`
- Modify: `src/components/GameCanvas.tsx` (extend the paintMode ctx wiring)

- [ ] **Step 5.1: Extend PaintModeCtx with the two new dependencies.**

In `src/canvas/input/paintMode.ts`, extend the interface:

```ts
chargeCP: (team: Team, intent: 'placeCohort') => boolean;
triggerBrokeFlash: (team: Team) => void;
```

- [ ] **Step 5.2: Insert the CP gate in paintPlace.**

In `paintPlace`, find the line `if (target.length === 0) return;` and add IMMEDIATELY AFTER it (before `const groupId = ...`):

```ts
if (!ctx.chargeCP(team, 'placeCohort')) {
  ctx.triggerBrokeFlash(team);
  return;
}
```

- [ ] **Step 5.3: Wire the dependencies from GameCanvas.**

In `src/components/GameCanvas.tsx`, find where the `PaintModeCtx` is assembled and passed (search for `paintMode` or `paintPlace` references — they live in the paint pointer-handler wiring inside `usePixiApp` or its ctx). Add `chargeCP` and `triggerBrokeFlash` to that ctx.

If the paint ctx is constructed inside `pixiCtx`, add the two fields to `PixiAppCtx` in `src/canvas/PixiApp.ts` as well and thread through. Follow the existing pattern of other shared callbacks like `issueOrder`.

- [ ] **Step 5.4: Verify the chain compiles.**

Run: `npm run build`
Expected: success.

- [ ] **Step 5.5: Manual verification.**

Run: `npm run dev`. Dive tactical. Note CP `20/20` (or `0/20` if you kept the test override — restore CP_INITIAL=CP_CAP first). Click an INFANTRY button, then click 5 different deploy-zone hexes. Watch CP drop from 20 → 18 → 16 → 14 → 12 → 10. On a 6th click when at 0 CP (force by changing CP_INITIAL temporarily), expect no placement + red flash on red bar.

- [ ] **Step 5.6: Commit.**

```
git add src/canvas/input/paintMode.ts src/components/GameCanvas.tsx src/canvas/PixiApp.ts
git commit -m "Gate cohort placement on CP (paintPlace charges placeCohort)"
```

---

### Task 6: commitOrderDrag — deploy-zone restriction + CP gate

**Files:**
- Modify: `src/canvas/input/orderDrag.ts`
- Modify: `src/components/GameCanvas.tsx` and/or `src/canvas/PixiApp.ts` (threading)

- [ ] **Step 6.1: Extend OrderDragCtx.**

In `src/canvas/input/orderDrag.ts`:

```ts
chargeCP: (team: Team, intent: 'orderDrag') => boolean;
triggerBrokeFlash: (team: Team) => void;
```

Add an import:

```ts
import { deployZoneFor } from '../constants';
```

(`deployZoneFor` already exists in `constants.ts`.)

- [ ] **Step 6.2: Add the deploy-zone gate at the top of commitOrderDrag.**

In `commitOrderDrag`, immediately after `const drag = ctx.orderDragRef.current; if (!drag) return;`, insert:

```ts
const zone = deployZoneFor(drag.team, ctx.gridDataRef.current);
if (!zone.has(HexUtils.key(drag.targetHex))) {
  ctx.setInputMode(null);
  cancelOrderDrag(ctx);
  return;
}
```

- [ ] **Step 6.3: Insert the CP charge before the mutation.**

In `commitOrderDrag`, find the `if (deployValid && strategic) {` block. Wrap the inside with a CP check — change:

```ts
if (deployValid && strategic) {
  ctx.setArmies(prev => { /* ... */ });
  {
    const prior = ctx.groupOrdersRef.current.get(groupOrderKey(drag.team, drag.groupId));
    const change: OrderChange = { attackTarget: drag.targetHex, heading: snapToForwardCone(drag.team, heading) };
    if (!prior?.mode) change.mode = 'idle';
    ctx.issueOrder(drag.team, drag.groupId, change);
  }
}
```

to:

```ts
if (deployValid && strategic) {
  if (!ctx.chargeCP(drag.team, 'orderDrag')) {
    ctx.triggerBrokeFlash(drag.team);
    ctx.setInputMode(null);
    cancelOrderDrag(ctx);
    return;
  }
  ctx.setArmies(prev => { /* ... */ });
  {
    const prior = ctx.groupOrdersRef.current.get(groupOrderKey(drag.team, drag.groupId));
    const change: OrderChange = { attackTarget: drag.targetHex, heading: snapToForwardCone(drag.team, heading) };
    if (!prior?.mode) change.mode = 'idle';
    ctx.issueOrder(drag.team, drag.groupId, change);
  }
}
```

- [ ] **Step 6.4: Thread `chargeCP` + `triggerBrokeFlash` from GameCanvas through pixi/order-drag ctx.**

Same pattern as Task 5. Add to `PixiAppCtx` if not already there; assemble in GameCanvas.

- [ ] **Step 6.5: Type-check.**

Run: `npm run build`
Expected: success.

- [ ] **Step 6.6: Manual verification.**

Run: `npm run dev`. Dive tactical. Deploy 4 units in red zone. Click "DEPLOY (Q)". Drag from a deploy-zone hex outward — formation should preview. Release inside zone: order issued, CP drops by 3. Click Q again, drag and release OUTSIDE deploy zone: drag silently cancels, no CP charged.

- [ ] **Step 6.7: Commit.**

```
git add src/canvas/input/orderDrag.ts src/components/GameCanvas.tsx src/canvas/PixiApp.ts
git commit -m "Restrict Q drag to deploy zone, gate commit on orderDrag CP"
```

---

### Task 7: toggleMode CP gate

**Files:**
- Modify: `src/components/GameCanvas.tsx`

- [ ] **Step 7.1: Update toggleMode to charge per-mode and trigger broke flash on rejection.**

In `src/components/GameCanvas.tsx`, replace the existing `toggleMode` `useCallback` body. Keep the same outer structure (retreat branch first, then no-target/committed early returns, then cancel branch, then enter-new-mode branch), but insert CP gates:

Old retreat branch (after `if (engaged) return;`) — INSERT BEFORE the `refund` / `setArmies` / `setRosters` / `clearOrder` calls:

```ts
if (!chargeCP(team, 'retreat')) {
  triggerBrokeFlash(team);
  return;
}
```

Old cancel branch (the `if (isActive)` block) — leave as is. **No CP charged on cancel-to-idle.**

Old "enter new mode" branch (the final `issueOrder(team, gid, { mode, ... })`) — INSERT BEFORE the `issueOrder` call:

```ts
const intent: CpIntent = mode; // 'hold' | 'charge' | 'unleash' | 'idle' all match CP_COSTS keys
if (!chargeCP(team, intent)) {
  triggerBrokeFlash(team);
  return;
}
```

Update the `useCallback` deps array to include `chargeCP, triggerBrokeFlash`:

```ts
}, [issueOrder, clearOrder, chargeCP, triggerBrokeFlash]);
```

- [ ] **Step 7.2: Type-check.**

Run: `npm run build`

If TypeScript complains that `mode` (an `Exclude<OrderMode, 'march'>`) isn't assignable to `CpIntent`, add an explicit narrowing:

```ts
const INTENT_BY_MODE: Record<Exclude<OrderMode, 'march'>, CpIntent> = {
  hold: 'hold',
  charge: 'charge',
  unleash: 'unleash',
  idle: 'idle',
  retreat: 'retreat',
};
const intent: CpIntent = INTENT_BY_MODE[mode];
```

Place that lookup once above the `toggleMode` definition.

- [ ] **Step 7.3: Manual verification.**

Run: `npm run dev`. Place units, Q-drag to set initial order (cost 3). Now press W: HOLD active, CP drops by 4. Press W again: cancel → idle, CP unchanged. Press E: CHARGE, CP drops by 6. Press R: UNLEASH, CP drops by 6, group locks. Press F (retreat): CP drops by 4 if not engaged, units vanish, 80% refund applied.

Try when broke: bring red CP near 0 (use the START BATTLE pause to let regen tick down via spending), then press E. Expect: no mode change, red bar flashes red.

- [ ] **Step 7.4: Commit.**

```
git add src/components/GameCanvas.tsx
git commit -m "Gate toggleMode (hold/charge/unleash/retreat) on CP; idle and cancel stay free"
```

---

### Task 8: marchForward and cycleFormation CP gates

**Files:**
- Modify: `src/components/GameCanvas.tsx`

- [ ] **Step 8.1: Update marchForward.**

In `marchForward`, after the `if (cur?.committed) return;` early return, before each of the two branches (`if (isMarching) ...` and the else `issueOrder({mode:'march', ...})`), insert the appropriate `chargeCP`:

```ts
if (isMarching) {
  if (!chargeCP(team, 'cycleHeading')) { triggerBrokeFlash(team); return; }
  issueOrder(team, gid, { heading: cycleConeHeading(team, cur!.heading) });
  return;
}
// ... existing block computing heading & attackTarget ...
if (!chargeCP(team, 'march')) { triggerBrokeFlash(team); return; }
issueOrder(team, gid, {
  mode: 'march', attackTarget, heading,
  chargeTicksRemaining: undefined, chargeDamagedIds: undefined, holdTicks: undefined,
});
```

Update deps:

```ts
}, [issueOrder, chargeCP, triggerBrokeFlash]);
```

- [ ] **Step 8.2: Update cycleFormation.**

Replace the body of `cycleFormation`:

```ts
const cycleFormation = useCallback((gid: GroupId) => {
  const team = selectedTeamRef.current;
  if (!chargeCP(team, 'cycleFormation')) { triggerBrokeFlash(team); return; }
  const key = groupOrderKey(team, gid);
  setGroupFormations(prev => {
    const next = new Map(prev);
    const cur = next.get(key) ?? 'line';
    const idx = FORMATION_CYCLE.indexOf(cur);
    next.set(key, FORMATION_CYCLE[(idx + 1) % FORMATION_CYCLE.length]);
    return next;
  });
}, [chargeCP, triggerBrokeFlash]);
```

- [ ] **Step 8.3: Type-check.**

Run: `npm run build`

- [ ] **Step 8.4: Manual verification.**

Run: `npm run dev`. Place units, Q-drag. Press A on idle group: CP drops by 2, group marches. Press A again while marching: CP drops by 1, heading cycles. Press D: CP drops by 1, formation cycles. When broke, each is a no-op + flash.

- [ ] **Step 8.5: Commit.**

```
git add src/components/GameCanvas.tsx
git commit -m "Gate marchForward (start/cycleHeading) and cycleFormation on CP"
```

---

### Task 9: HUD per-button cost chips + disabled gating

**Files:**
- Modify: `src/canvas/HUD.tsx`

- [ ] **Step 9.1: Extend HUDProps with canAfford.**

In `src/canvas/HUD.tsx`:

```ts
canAfford: (team: Team, intent: CpIntent) => boolean;
```

Add the import:

```ts
import { CP_COSTS, type CpIntent } from '../battle/command-points';
```

- [ ] **Step 9.2: Pass canAfford from GameCanvas.**

In `src/components/GameCanvas.tsx`, in the `<HUD ... />` JSX, add `canAfford={canAfford}`.

- [ ] **Step 9.3: Add a reusable `<CostChip>` inside HUD.tsx.**

Above the `HUD` component definition:

```tsx
const CostChip: React.FC<{ cost: number; affordable: boolean }> = ({ cost, affordable }) => {
  if (cost === 0) return null;
  return (
    <span style={{
      position: 'absolute',
      top: '-5px', right: '-5px',
      background: affordable ? '#facc15' : '#ef4444',
      color: affordable ? '#0b1220' : 'white',
      borderRadius: '8px',
      padding: '1px 5px',
      fontSize: '8px',
      fontWeight: 900,
      border: '1px solid #0b1220',
      pointerEvents: 'none',
    }}>{cost}</span>
  );
};
```

- [ ] **Step 9.4: Wrap each costed button.**

For every button that triggers a costed action, do TWO things:

1. Make the button's container `position: 'relative'` if not already (the existing buttons already use `position:'relative'` inside `.btn` styles via the cost chip pattern in the spec mockup — verify against current code).
2. Append `<CostChip cost={CP_COSTS[intent]} affordable={canAfford(selectedTeam, intent)} />` as the last child.

Costed buttons and their intents:

- Place cohort buttons (INFANTRY/CAVALRY/SKIRMISH): intent `'placeCohort'`. Disabled gate: existing `outOfStock || viewMode !== 'TACTICAL'` + `!canAfford(selectedTeam, 'placeCohort')`.
- DEPLOY (Q): intent `'orderDrag'`. Disabled gate: existing `count === 0` + `!canAfford(selectedTeam, 'orderDrag')`.
- HOLD (W): intent `'hold'`. Show chip ONLY when NOT currently active (cancel = free).
- CHARGE (E): intent `'charge'`. Same rule (chip hidden when active).
- UNLEASH (R): intent `'unleash'`. Same rule.
- ASSIGN (T): intent `'assign'` — `CP_COSTS.assign === 0`, so `CostChip` renders null automatically.
- MARCH (A): intent depends on state:
  - `isMarching` → `'cycleHeading'` (1)
  - else → `'march'` (2)
  Compute the chip's cost from the same `isMarching` flag.
- IDLE (S): intent `'idle'` (0) — chip auto-hides.
- FORMATION (D): intent `'cycleFormation'` (1).
- RETREAT (F): intent `'retreat'` (4). Existing engagement check still applies — disabled = existing OR `!canAfford(selectedTeam, 'retreat')`.

For HOLD/CHARGE/UNLEASH, **add a condition** to skip the chip when that mode is currently active (because the next press would be a cancel = free). e.g.:

```tsx
{!holdActive && <CostChip cost={CP_COSTS.hold} affordable={canAfford(selectedTeam, 'hold')} />}
```

For each costed button's `disabled`, OR the existing condition with `!canAfford(selectedTeam, intent)`:

```tsx
disabled={!canEdit || !canAfford(selectedTeam, 'hold')}
```

(The keyboard shortcut path already calls back to the handler, which gates internally. So this `disabled` is purely UX — it greys the button and stops onClick, but the keyboard would also be rejected at the handler level.)

- [ ] **Step 9.5: Type-check.**

Run: `npm run build`

- [ ] **Step 9.6: Manual verification.**

Run: `npm run dev`. Dive tactical. Every costed button shows a yellow chip with its CP cost. When you can't afford an action, the chip turns red and the button greys out. Cancel-eligible mode buttons (HOLD/CHARGE/UNLEASH while active) show no chip — clicking them is free.

- [ ] **Step 9.7: Commit.**

```
git add src/canvas/HUD.tsx src/components/GameCanvas.tsx
git commit -m "Show per-button CP cost chips; gate disabled on canAfford"
```

---

### Task 10: AI integration — extend AiTickState and wrap issueOrder

**Files:**
- Modify: `src/battle/ai.ts`
- Modify: `src/canvas/useBattleTick.ts`

- [ ] **Step 10.1: Extend AiTickState and change the issueOrder signature.**

In `src/battle/ai.ts`:

```ts
import { type CpIntent } from './command-points';
```

Update the interface:

```ts
export interface AiTickState {
  team: Team;
  tick: number;
  myUnits: Unit[];
  enemyUnits: Unit[];
  myOrders: GroupOrder[];
  allOrders: ReadonlyMap<string, GroupOrder>;
  gridData: ReadonlyArray<{ hex: Hex; type: string }>;
  /** Snapshot of the team's CP at the start of the tick. */
  cp: number;
  /** Returns true if the order was issued, false if rejected (broke). */
  issueOrder: (groupId: GroupId, change: OrderChange, intent: CpIntent) => boolean;
  clearOrder: (groupId: GroupId) => void;
}
```

- [ ] **Step 10.2: Wrap issueOrder inside useBattleTick.**

In `src/canvas/useBattleTick.ts`, find the AI loop where it currently calls:

```ts
issueOrder: (gid, change) => ctx.issueOrder(team, gid, change),
```

Change to:

```ts
issueOrder: (gid, change, intent) => {
  // Cost gate — same as the player UI path.
  const cost = CP_COSTS[intent];
  if (ctx.commandPointsRef.current[team] < cost) return false;
  const nextCp = { ...ctx.commandPointsRef.current,
    [team]: ctx.commandPointsRef.current[team] - cost };
  ctx.commandPointsRef.current = nextCp;
  ctx.setCommandPoints(nextCp);
  ctx.issueOrder(team, gid, change);
  return true;
},
```

Add `cp: ctx.commandPointsRef.current[team]` to the `fn({...})` object:

```ts
fn({
  team,
  tick: ctx.tickCounterRef.current,
  myUnits,
  enemyUnits,
  myOrders,
  allOrders: ctx.groupOrdersRef.current,
  gridData: grid,
  cp: ctx.commandPointsRef.current[team],
  issueOrder: /* wrapped above */,
  clearOrder: (gid) => ctx.clearOrder(team, gid),
});
```

Add the import:

```ts
import { CP_COSTS } from '../battle/command-points';
```

- [ ] **Step 10.3: Type-check.**

Run: `npm run build`
Expected: success.

- [ ] **Step 10.4: Run the existing sim harness to confirm nothing in the sim broke.**

Run: `npm run sim`
Expected: same pass-rate as before this branch's CP changes (no behavioural regressions in the pure sim — CP doesn't touch it).

- [ ] **Step 10.5: Commit.**

```
git add src/battle/ai.ts src/canvas/useBattleTick.ts
git commit -m "Wire AI issueOrder through CP gate; add cp snapshot to AiTickState"
```

---

### Task 11: End-to-end manual verification

**Files:**
- None (verification only)

- [ ] **Step 11.1: Start the dev server.**

Run: `npm run dev -- --port 5174` (the parent worktree may use 5173 — per CLAUDE.md).

- [ ] **Step 11.2: Walk through the deploy scenario.**

Open the app, regenerate a world, click a hex to dive tactical. Confirm:
- CP bar at bottom shows `20/20` for both teams.
- Every costed button has a yellow chip with its number.
- Placing a cohort drops CP by 2 per painted hex.
- Q-drag inside deploy zone drops CP by 3.
- Q-drag released outside deploy zone is silently cancelled, no CP charged.
- ASSIGN button has no chip and is free.
- Switching team (RED ↔ BLUE) shows each team's chip affordability independently.

- [ ] **Step 11.3: Walk through the battle scenario.**

Press START BATTLE. Confirm:
- Both bars tick +1 every ~2 seconds.
- HOLD/CHARGE/UNLEASH drop CP by 4/6/6 each on first press; second press cancels (idle) at no cost.
- MARCH start = 2 CP; cycle heading while marching = 1 CP.
- Cycle formation = 1 CP.
- RETREAT (when not engaged) = 4 CP; refund still applies.

- [ ] **Step 11.4: Walk through the broke scenario.**

Spend until red CP < 6. Press CHARGE: no state change, red bar flashes red briefly. Chip on CHARGE button is now red. Wait for regen to fill, retry, succeeds.

- [ ] **Step 11.5: Walk through reset paths.**

Press RESET BATTLE: both bars back to 20/20. Press RETURN TO STRATEGIC, then dive again: bars at 20/20. Regenerate world: bars at 20/20.

- [ ] **Step 11.6: Final type-check + lint + sim regression.**

Run all three in parallel:
- `npm run build`
- `npm run lint`
- `npm run sim`
- `npm run test:cp`

Expected: all green.

- [ ] **Step 11.7: Final commit (only if any cleanup landed).**

If the verification surfaced any small follow-ups (typo, missing chip, wrong cost shown), fix and commit:

```
git add -p
git commit -m "Verification fixes for command points UI"
```

---

## Out of scope (do NOT add to this plan)

- Event-driven CP bonuses (kill +X, hold zone +X).
- Asymmetric pools / difficulty knobs.
- CP-cost tooltips with breakdown.
- Persisting CP across battles in a campaign sense.
- An actual AI controller — `feature/ai-enemy` will add one in a separate branch/plan.
