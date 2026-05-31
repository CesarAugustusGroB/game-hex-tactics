// Regression: two co-located units must BOTH be visible to an adjacent enemy's combat
// target search. The combat occupancy map was last-write-wins (Map<key,Unit>), so a hex
// holding two units only exposed the last-inserted one — the other was untargetable.
// Run: npx tsx scripts/test-occupancy.ts
import { simulateTick } from '../src/battle/simulate';
import type { Unit, GroupOrder, SimulationConfig, MapApi } from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';

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

// A (low hp) and B (high hp) are co-located at (0,0); B is inserted LAST so a
// last-write-wins map would expose only B. Enemy E is adjacent at (1,0) and idle.
// Correct combat picks the lowest-hp adjacent enemy → E must damage A, not B.
const a: Unit = {
  id: 'a', team: 'red', unitType: 'infantry', tacticalHex: { q: 0, r: 0 }, homeHex: { q: 0, r: 0 },
  groupId: 1, hp: 30, state: 'idle', nextMoveTick: 0, visionRadius: 1,
};
const b: Unit = {
  id: 'b', team: 'red', unitType: 'infantry', tacticalHex: { q: 0, r: 0 }, homeHex: { q: 0, r: 0 },
  groupId: 1, hp: 300, state: 'idle', nextMoveTick: 0, visionRadius: 1,
};
const e: Unit = {
  id: 'e', team: 'blue', unitType: 'infantry', tacticalHex: { q: 1, r: 0 }, homeHex: { q: 1, r: 0 },
  groupId: 1, hp: 9999, state: 'idle', nextMoveTick: 0, visionRadius: 1,
};

const orders = new Map<string, GroupOrder>();
const res = simulateTick([a, b, e], orders, config);
const ra = res.units.find(u => u.id === 'a');
const rb = res.units.find(u => u.id === 'b');

check('low-hp co-located unit A is targeted (visible to enemy)', !!ra && ra.hp < 30,
  `a.hp=${ra?.hp}`);
check('high-hp co-located unit B is NOT the chosen target', !!rb && rb.hp === 300,
  `b.hp=${rb?.hp}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
