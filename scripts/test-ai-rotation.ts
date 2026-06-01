// Under scarce CP and continuous waves, the AI must keep deploying ALL unit types — not just
// infantry. Regression for the bug where the fixed [1,2,3,4] amass order let infantry bands (1,2)
// drain the per-tick CP budget every tick, starving the cavalry (3) and skirmisher (4) bands
// forever once the initial CP buffer was gone. Run: npx tsx scripts/test-ai-rotation.ts
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickState } from '../src/battle/ai';
import type { Unit, GroupOrder, UnitType } from '../src/battle/simulate';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// Wide rectangular deploy strip (the tactical map is a wide rectangle, not a disk).
const strip: Hex[] = [];
for (let q = -16; q <= 16; q++) for (let r = -3; r <= 0; r++) strip.push({ q, r });
const deployZone = new Set(strip.map(HexUtils.key));

const ctrl = makeAiController('blue', 'balanced', 'normal');
const units: Unit[] = [];
let roster: Record<UnitType, number> = { infantry: 200, cavalry: 200, skirmisher: 200 };
const orders = new Map<string, GroupOrder>();
let cp = 200;

const placeCohort = (gid: number, anchor: Hex, unitType: UnitType): boolean => {
  if (roster[unitType] <= 0 || cp < 2) return false;
  const occ = new Set(units.map(u => HexUtils.key(u.tacticalHex)));
  const spots = [anchor, ...HexUtils.getNeighbors(anchor)]
    .filter(h => deployZone.has(HexUtils.key(h)) && !occ.has(HexUtils.key(h))).slice(0, 4);
  if (spots.length === 0) return false;
  cp -= 2;
  for (const h of spots) {
    if (roster[unitType] <= 0) break;
    units.push({ id: `u${units.length}`, team: 'blue', unitType, tacticalHex: h, homeHex: h,
      groupId: gid as 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1 });
    roster = { ...roster, [unitType]: roster[unitType] - 1 };
  }
  return true;
};

const enemy: Unit = { id: 'e', team: 'red', unitType: 'infantry', tacticalHex: { q: 0, r: 40 }, homeHex: { q: 0, r: 40 }, groupId: 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1 };

const lateDeploys: Record<string, number> = { infantry: 0, cavalry: 0, skirmisher: 0 };

for (let t = 1; t <= 400; t++) {
  cp = Math.min(200, cp + 0.1); // real regen: regenN=10 → ~0.1 CP/tick
  const before = units.map(u => u.unitType);
  const state: AiTickState = {
    team: 'blue', tick: t, myUnits: units, enemyUnits: [enemy],
    myOrders: [...orders.values()].filter(o => o.team === 'blue'),
    allOrders: orders, gridData: [], cp, roster, deployZone,
    issueOrder: (gid, change) => { if (cp < 2) return false; const k = `blue:${gid}`;
      orders.set(k, { team: 'blue', groupId: gid, attackTarget: null, heading: 5, ...orders.get(k), ...change }); cp -= 2; return true; },
    clearOrder: () => {},
    placeCohort,
  };
  ctrl(state);

  // Count deploys made THIS tick (only after the initial CP buffer is gone: t > 120).
  if (t > 120) for (let i = before.length; i < units.length; i++) lateDeploys[units[i].unitType]++;

  // Wave departure: marched groups leave the zone → slots recycle, AI re-amasses (continuous waves).
  for (let i = units.length - 1; i >= 0; i--) {
    if (orders.get(`blue:${units[i].groupId}`)?.mode === 'march') units.splice(i, 1);
  }
  for (const [k, o] of orders) if (o.mode === 'march') orders.delete(k);
}

console.log('late-game deploys (t>120):', lateDeploys);
check('keeps deploying cavalry in the sustained battle', lateDeploys.cavalry > 0, `cav=${lateDeploys.cavalry}`);
check('keeps deploying skirmishers in the sustained battle', lateDeploys.skirmisher > 0, `skirm=${lateDeploys.skirmisher}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
