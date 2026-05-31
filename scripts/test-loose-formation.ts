// Verifies the keep/loose formation toggle on march. KEEP (default / looseFormation falsy):
// rigid block — group advances at the slowest unit's pace and freezes entirely if any unit
// is blocked. LOOSE (looseFormation: true): each unit advances at its own speed and its own
// possibility — faster units pull ahead, a blocked unit doesn't freeze the rest.
// Run: npx tsx scripts/test-loose-formation.ts
import { simulateTick } from '../src/battle/simulate';
import type { Unit, GroupOrder, SimulationConfig, MapApi } from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const flatMap: MapApi = {
  isInside: () => true,
  isWalkable: () => true,
  getTerrainType: () => 'GRASSLAND',
  getTerrainMods: () => getTerrainMods('GRASSLAND'),
  getTerrainHeight: () => 12,
  isInDeployZone: () => false,
};
// Same as flat, but the hex (1,0) is an impassable wall.
const wallMap: MapApi = { ...flatMap, isWalkable: (h) => !(h.q === 1 && h.r === 0) };

const unit = (id: string, type: Unit['unitType'], q: number, r: number): Unit => ({
  id, team: 'red', unitType: type, tacticalHex: { q, r }, homeHex: { q, r },
  groupId: 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});

// Drive `ticks` ticks of a single red group marching east (heading 0 = +q) toward a far target.
const run = (units: Unit[], loose: boolean, ticks: number, mapApi: MapApi): Unit[] => {
  const order: GroupOrder = {
    team: 'red', groupId: 1, attackTarget: { q: 50, r: 0 }, heading: 0,
    mode: 'march', looseFormation: loose,
  };
  const orders = new Map<string, GroupOrder>([['red:1', order]]);
  let cur = units;
  for (let t = 1; t <= ticks; t++) {
    cur = simulateTick(cur, orders, { damagePerTick: 20, mapApi, currentTick: t } as SimulationConfig).units;
  }
  return cur;
};
const qOf = (us: Unit[], id: string) => us.find(u => u.id === id)!.tacticalHex.q;

// 1. Speed divergence: infantry (1.5) + cavalry (2) in parallel rows marching east.
const mixed = () => [unit('inf', 'infantry', 0, 0), unit('cav', 'cavalry', 0, 1)];

const keep = run(mixed(), false, 4, flatMap);
check('KEEP: cavalry stays aligned with infantry (slowest pace)',
  qOf(keep, 'cav') === qOf(keep, 'inf'), `cav=${qOf(keep, 'cav')} inf=${qOf(keep, 'inf')}`);

const loose = run(mixed(), true, 4, flatMap);
check('LOOSE: cavalry pulls ahead of infantry (own speed)',
  qOf(loose, 'cav') > qOf(loose, 'inf'), `cav=${qOf(loose, 'cav')} inf=${qOf(loose, 'inf')}`);

// 2. A blocked unit must not freeze the rest. Infantry's path runs into a wall at (1,0);
//    cavalry's row (r=1) is clear.
const keepW = run(mixed(), false, 4, wallMap);
check('KEEP: a blocked unit freezes the whole block',
  qOf(keepW, 'inf') === 0 && qOf(keepW, 'cav') === 0,
  `inf=${qOf(keepW, 'inf')} cav=${qOf(keepW, 'cav')}`);

const looseW = run(mixed(), true, 4, wallMap);
check('LOOSE: blocked infantry stays, cavalry advances anyway',
  qOf(looseW, 'inf') === 0 && qOf(looseW, 'cav') > 0,
  `inf=${qOf(looseW, 'inf')} cav=${qOf(looseW, 'cav')}`);

// 3. Default (no looseFormation field) == KEEP (rigid). Regression guard.
const defOrder: GroupOrder = { team: 'red', groupId: 1, attackTarget: { q: 50, r: 0 }, heading: 0, mode: 'march' };
const defUnits = (() => {
  let cur: Unit[] = mixed();
  const orders = new Map<string, GroupOrder>([['red:1', defOrder]]);
  for (let t = 1; t <= 4; t++) cur = simulateTick(cur, orders, { damagePerTick: 20, mapApi: flatMap, currentTick: t } as SimulationConfig).units;
  return cur;
})();
check('default (no flag) marches rigidly like KEEP',
  qOf(defUnits, 'cav') === qOf(keep, 'cav') && qOf(defUnits, 'inf') === qOf(keep, 'inf'),
  `cav=${qOf(defUnits, 'cav')} inf=${qOf(defUnits, 'inf')}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
