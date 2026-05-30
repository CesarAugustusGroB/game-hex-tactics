// Drives makeAiController against a fake host: it should deploy cohorts, then issue orders.
// Run: npx tsx scripts/test-ai-controller.ts
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickState } from '../src/battle/ai';
import type { Unit, GroupOrder, GroupId, UnitType } from '../src/battle/simulate';
import { HexUtils } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const ctrl = makeAiController('blue', 'balanced', 'hard');

const deployZone = new Set<string>();
for (let q = 0; q < 12; q++) deployZone.add(HexUtils.key({ q, r: 0 }));
let units: Unit[] = [];
let roster: Record<UnitType, number> = { infantry: 200, cavalry: 200, skirmisher: 200 };
const orders = new Map<string, GroupOrder>();
let cp = 200, placements = 0, ordersIssued = 0;

const runTick = (tick: number, enemyUnits: Unit[]) => {
  const state: AiTickState = {
    team: 'blue', tick, myUnits: units, enemyUnits,
    myOrders: [...orders.values()].filter(o => o.team === 'blue'),
    allOrders: orders, gridData: [], cp, roster, deployZone,
    issueOrder: (gid, change) => {
      const key = `blue:${gid}`;
      orders.set(key, { team: 'blue', groupId: gid, attackTarget: null, heading: 5, ...orders.get(key), ...change });
      ordersIssued++; cp -= 2; return true;
    },
    clearOrder: () => {},
    placeCohort: (gid, anchor, unitType) => {
      const k = HexUtils.key(anchor);
      if (!deployZone.has(k)) return false;
      const u: Unit = {
        id: `u${units.length}`, team: 'blue', unitType, tacticalHex: anchor, homeHex: anchor,
        groupId: gid, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1,
      };
      units = [...units, u]; roster = { ...roster, [unitType]: roster[unitType] - 1 };
      placements++; cp -= 2; return true;
    },
  };
  ctrl(state);
};

for (let t = 1; t <= 5; t++) runTick(t, []);
check('controller deployed cohorts', placements > 0, `placements=${placements}`);

cp = 200;
for (let t = 6; t <= 40; t++) runTick(t, [{
  id: 'e', team: 'red', unitType: 'infantry', tacticalHex: { q: 1, r: 1 }, homeHex: { q: 1, r: 1 },
  groupId: 1 as GroupId, hp: 50, state: 'idle', nextMoveTick: 0, visionRadius: 1,
}]);
check('controller issued orders after deploy', ordersIssued > 0, `orders=${ordersIssued}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
