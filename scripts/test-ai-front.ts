// Doctrine: a WIDE front of THREE lateral bands (groups 1-3) across the deploy-zone width, plus a
// RESERVE band (group 4) deployed at a spot further BACK (away from the enemy edge), not in the
// front line. Drives makeAiController over a wide strip and asserts the front spans most of the
// width and the reserve sits behind it. Run: npx tsx scripts/test-ai-front.ts
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickState } from '../src/battle/ai';
import type { Unit, GroupOrder, UnitType } from '../src/battle/simulate';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// Wide, thin deploy strip (top py-band of a hex disk) — the shape the real deployZoneFor produces.
const disk: Hex[] = [];
for (let q = -10; q <= 10; q++) for (let r = -10; r <= 10; r++) if (Math.abs(q + r) <= 10) disk.push({ q, r });
const ys = disk.map(h => HexUtils.hexToPixel(h).y);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const strip = disk.filter(h => HexUtils.hexToPixel(h).y <= minY + (maxY - minY) * 0.2);
const deployZone = new Set(strip.map(HexUtils.key));
const zoneXs = strip.map(h => HexUtils.hexToPixel(h).x);
const zoneW = Math.max(...zoneXs) - Math.min(...zoneXs);

const ctrl = makeAiController('blue', 'balanced', 'hard');
const units: Unit[] = [];
let roster: Record<UnitType, number> = { infantry: 200, cavalry: 200, skirmisher: 200 };
const orders = new Map<string, GroupOrder>();
let cp = 200;

const placeCohort = (gid: number, anchor: Hex, unitType: UnitType): boolean => {
  if (roster[unitType] <= 0) return false;
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

// Build phase only (no enemies, no movement): let the formation fill.
for (let t = 1; t <= 20; t++) {
  cp = Math.min(200, cp + 0.1);
  const state: AiTickState = {
    team: 'blue', tick: t, myUnits: units, enemyUnits: [],
    myOrders: [...orders.values()].filter(o => o.team === 'blue'),
    allOrders: orders, gridData: [], cp, roster, deployZone,
    issueOrder: (gid, change) => { const k = `blue:${gid}`;
      orders.set(k, { team: 'blue', groupId: gid, attackTarget: null, heading: 5, ...orders.get(k), ...change }); cp -= 2; return true; },
    clearOrder: () => {},
    placeCohort,
  };
  ctrl(state);
}

const py = (u: Unit) => HexUtils.hexToPixel(u.tacticalHex).y;
const inZone = units.filter(u => deployZone.has(HexUtils.key(u.tacticalHex)));
const front = inZone.filter(u => u.groupId !== 4);  // groups 1-3 = front line
const reserve = inZone.filter(u => u.groupId === 4); // group 4 = reserve
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

const frontXs = front.map(u => HexUtils.hexToPixel(u.tacticalHex).x);
const frontCoverage = front.length ? (Math.max(...frontXs) - Math.min(...frontXs)) / zoneW : 0;

check('front line spans most of the deploy-zone width', frontCoverage >= 0.6, `coverage=${frontCoverage.toFixed(2)}`);
check('front is built from the three non-reserve bands', new Set(front.map(u => u.groupId)).size === 3, `bands=${[...new Set(front.map(u => u.groupId))].sort()}`);
check('reserve band was deployed', reserve.length > 0, `n=${reserve.length}`);
// Blue marches toward larger py (front = high py), so "behind" = lower py.
check('reserve sits behind the front line', reserve.length > 0 && mean(reserve.map(py)) < mean(front.map(py)),
  `reserveY=${mean(reserve.map(py)).toFixed(0)} frontY=${mean(front.map(py)).toFixed(0)}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
