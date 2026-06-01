// Every band must actually ADVANCE — not just receive a march order. Regression for the bug where
// the wide-front bands packed tightly enough to touch at their lateral boundaries, and the rigid
// block (all-or-nothing) froze every band whose few boundary units had a neighbour band's unit one
// hex ahead. Only the first band ever moved; the right flank (and cavalry/skirmisher) sat in the
// zone forever despite holding a march order. The AI now marches LOOSE so each band flows forward.
// Drives the REAL controller + simulateTick over the real deploy zone. Run: npx tsx scripts/test-ai-advance.ts
import { simulateTick, MAX_HP_BY_TYPE } from '../src/battle/simulate';
import { makeAiController } from '../src/battle/ai/controller';
import type { Unit, GroupOrder, SimulationConfig, MapApi, UnitType } from '../src/battle/simulate';
import type { AiTickState } from '../src/battle/ai';
import { getTerrainMods } from '../src/battle/terrain';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { deployZoneFor } from '../src/canvas/constants';
import { CP_REGEN_PER_TICK_STEP, CP_REGEN_N, CP_CAP, CP_INITIAL } from '../src/battle/command-points';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const REGEN = CP_REGEN_PER_TICK_STEP * CP_REGEN_N;
const R = 35;
const grid: { hex: Hex; type: string }[] = [];
for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) grid.push({ hex: { q, r }, type: 'GRASSLAND' });
const gridSet = new Set(grid.map(d => HexUtils.key(d.hex)));
const blueZone = deployZoneFor('blue', grid);
const mapApi: MapApi = {
  isInside: (h) => gridSet.has(HexUtils.key(h)), isWalkable: (h) => gridSet.has(HexUtils.key(h)),
  getTerrainType: () => 'GRASSLAND', getTerrainMods: () => getTerrainMods('GRASSLAND'),
  getTerrainHeight: () => 12, isInDeployZone: (_t, h) => blueZone.has(HexUtils.key(h)),
};

const ctrl = makeAiController('blue', 'balanced', 'normal');
let units: Unit[] = [];
let roster: Record<UnitType, number> = { infantry: 200, cavalry: 200, skirmisher: 200 };
let orders = new Map<string, GroupOrder>();
let cp = CP_INITIAL;

const placeCohort = (gid: number, anchor: Hex, t: UnitType): boolean => {
  if (roster[t] <= 0 || cp < 2) return false;
  const occ = new Set(units.map(u => HexUtils.key(u.tacticalHex)));
  const spots = [anchor, ...HexUtils.getNeighbors(anchor)].filter(h => blueZone.has(HexUtils.key(h)) && !occ.has(HexUtils.key(h))).slice(0, 4);
  if (!spots.length) return false; cp -= 2;
  for (const h of spots) {
    if (roster[t] <= 0) break;
    units.push({ id: `u${units.length}`, team: 'blue', unitType: t, tacticalHex: h, homeHex: h, groupId: gid as 1, hp: MAX_HP_BY_TYPE[t], state: 'idle', nextMoveTick: 0, visionRadius: 4 });
    roster = { ...roster, [t]: roster[t] - 1 };
  }
  return true;
};

for (let t = 1; t <= 120; t++) {
  cp = Math.min(CP_CAP, cp + REGEN);
  const state: AiTickState = {
    team: 'blue', tick: t, myUnits: units, enemyUnits: [], myOrders: [...orders.values()].filter(o => o.team === 'blue'),
    allOrders: orders, gridData: [], cp, roster, deployZone: blueZone,
    issueOrder: (gid, change) => { if (cp < 2) return false; const k = `blue:${gid}`; orders.set(k, { team: 'blue', groupId: gid, attackTarget: null, heading: 5, ...orders.get(k), ...change }); cp -= 2; return true; },
    clearOrder: () => {}, placeCohort,
  };
  ctrl(state);
  const res = simulateTick(units, orders, { damagePerTick: 26, mapApi, currentTick: t } as SimulationConfig);
  units = res.units; orders = res.orders as Map<string, GroupOrder>;
}

// Every non-empty band must have advanced units OUT of the deploy zone — proof it actually moved.
for (const g of [1, 2, 3, 4]) {
  const gu = units.filter(u => u.groupId === g && u.hp > 0);
  const out = gu.filter(u => !blueZone.has(HexUtils.key(u.tacticalHex))).length;
  check(`band G${g} advanced out of the deploy zone`, gu.length > 0 && out > 0, `n=${gu.length} outOfZone=${out}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
