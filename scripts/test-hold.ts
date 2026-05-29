// Verifies hold's defensive reduction applies on the FIRST tick the group is on hold
// (holdTicks === 0 at that point — the motion phase increments it afterward). Mirrors the
// MapApi/Unit scaffolding of scripts/sim-formations.ts. Run: npx tsx scripts/test-hold.ts
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
