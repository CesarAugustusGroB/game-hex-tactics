// Regression for two host-integration behaviours, driven through a faithful useBattleTick mock:
//  1. The AI bootstraps from an EMPTY field (the `units.length===0` guard must not block an AI
//     team's own deployment) and then advances.
//  2. The AI REINFORCES from its roster to replace casualties (not one-shot deploy).
// Run: npx tsx scripts/test-ai-reinforce.ts
import { simulateTick } from '../src/battle/simulate';
import type { Unit, GroupOrder, UnitType, Team, MapApi } from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';
import { makeAiController } from '../src/battle/ai/controller';
import { registerAiController, getAiController } from '../src/battle/ai';
import type { AiTickState } from '../src/battle/ai';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { MAX_HP_BY_TYPE } from '../src/data/units';
import { debit, type CommandPoints } from '../src/battle/command-points';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const cells: Hex[] = [];
for (let q = -10; q <= 10; q++) for (let r = -10; r <= 10; r++) if (Math.abs(q + r) <= 10) cells.push({ q, r });
const keyset = new Set(cells.map(HexUtils.key));
const gridData = cells.map(hex => ({ hex, type: 'GRASSLAND' }));
const ys = cells.map(h => HexUtils.hexToPixel(h).y);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const depth = (maxY - minY) * 0.2;
const deployZones: Record<Team, Set<string>> = { red: new Set(), blue: new Set() };
for (const h of cells) {
  const py = HexUtils.hexToPixel(h).y;
  if (py <= minY + depth) deployZones.blue.add(HexUtils.key(h));
  if (py >= maxY - depth) deployZones.red.add(HexUtils.key(h));
}
const mapApi: MapApi = {
  isInside: h => keyset.has(HexUtils.key(h)),
  isWalkable: () => true,
  getTerrainType: () => 'GRASSLAND',
  getTerrainMods: () => getTerrainMods('GRASSLAND'),
  getTerrainHeight: () => 10,
  isInDeployZone: (t, h) => deployZones[t].has(HexUtils.key(h)),
};

function run(redArmy: boolean): { firstPlaced: number; laterPlaced: number; startAvgR: number; endAvgR: number; finalBlue: number } {
  registerAiController('blue', makeAiController('blue', 'aggressive', 'hard'));
  let units: Unit[] = [];
  const orders = new Map<string, GroupOrder>();
  let rosters: Record<Team, Record<UnitType, number>> = {
    red: { infantry: 60, cavalry: 60, skirmisher: 60 },
    blue: { infantry: 60, cavalry: 60, skirmisher: 60 },
  };
  let cp: CommandPoints = { red: 200, blue: 200 };
  let tick = 300;
  if (redArmy) {
    let id = 0;
    for (const h of [...deployZones.red].slice(0, 16).map(k => HexUtils.fromKey(k))) {
      units.push({ id: `r${id++}`, team: 'red', unitType: 'infantry', tacticalHex: h, homeHex: h,
        groupId: 1, hp: MAX_HP_BY_TYPE.infantry, state: 'idle', nextMoveTick: 0, visionRadius: 1 });
    }
  }
  let firstPlaced = 0, laterPlaced = 0, startAvgR = 0;
  for (let i = 0; i < 40; i++) {
    tick++;
    cp = { red: Math.min(200, cp.red + 0.1), blue: Math.min(200, cp.blue + 0.1) };
    const hasAi = !!(getAiController('red') || getAiController('blue'));
    if (units.length === 0 && !hasAi) continue;
    const fn = getAiController('blue')!;
    const before = units.filter(u => u.team === 'blue').length;
    const state: AiTickState = {
      team: 'blue', tick,
      myUnits: units.filter(u => u.team === 'blue'),
      enemyUnits: units.filter(u => u.team !== 'blue'),
      myOrders: [...orders.values()].filter(o => o.team === 'blue'),
      allOrders: orders, gridData, cp: cp.blue, roster: rosters.blue, deployZone: deployZones.blue,
      placeCohort: (gid, anchor, unitType) => {
        if (rosters.blue[unitType] <= 0) return false;
        const occ = new Set(units.map(u => HexUtils.key(u.tacticalHex)));
        const spots = [anchor, ...HexUtils.getNeighbors(anchor)]
          .filter(h => deployZones.blue.has(HexUtils.key(h)) && !occ.has(HexUtils.key(h))).slice(0, 4);
        if (spots.length === 0) return false;
        const d = debit(cp, 'blue', 'placeCohort'); if (!d) return false; cp = d;
        for (const h of spots) {
          if (rosters.blue[unitType] <= 0) break;
          units.push({ id: `b${units.length}`, team: 'blue', unitType, tacticalHex: h, homeHex: h,
            groupId: gid, hp: MAX_HP_BY_TYPE[unitType], state: 'idle', nextMoveTick: 0, visionRadius: 1 });
          rosters = { ...rosters, blue: { ...rosters.blue, [unitType]: rosters.blue[unitType] - 1 } };
        }
        return true;
      },
      issueOrder: (gid, change, intent) => {
        const d = debit(cp, 'blue', intent); if (!d) return false; cp = d;
        const k = `blue:${gid}`;
        orders.set(k, { team: 'blue', groupId: gid, attackTarget: null, heading: 5, ...orders.get(k), ...change });
        return true;
      },
      clearOrder: gid => { orders.delete(`blue:${gid}`); },
    };
    fn(state);
    const placed = units.filter(u => u.team === 'blue').length - before;
    if (i === 0) {
      firstPlaced = placed;
      const blue = units.filter(u => u.team === 'blue');
      startAvgR = blue.reduce((s, u) => s + u.tacticalHex.r, 0) / blue.length;
    } else laterPlaced += placed;
    units = simulateTick(units, orders, { damagePerTick: 10, mapApi, currentTick: tick }).units.filter(u => u.hp > 0);
  }
  registerAiController('blue', null);
  const blue = units.filter(u => u.team === 'blue');
  const endAvgR = blue.length ? blue.reduce((s, u) => s + u.tacticalHex.r, 0) / blue.length : startAvgR;
  return { firstPlaced, laterPlaced, startAvgR, endAvgR, finalBlue: blue.length };
}

const empty = run(false);
check('AI bootstraps deployment on an empty field', empty.firstPlaced > 0, `placed t0=${empty.firstPlaced}`);
check('the deployed army advances (does not jam)', empty.endAvgR > empty.startAvgR + 3,
  `startAvgR=${empty.startAvgR.toFixed(1)} endAvgR=${empty.endAvgR.toFixed(1)}`);

const vsRed = run(true);
check('AI reinforces from roster after taking losses', vsRed.laterPlaced > 0, `reinforcements=${vsRed.laterPlaced}`);
check('AI keeps a standing force fielded', vsRed.finalBlue > 0, `finalBlue=${vsRed.finalBlue}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
