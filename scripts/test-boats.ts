// Boats on water: a unit on SEA/DEEP_SEA uses the uniform boat profile — HP clamps to the
// boat max, no missiles, no charge impact — and reverts on land. Run: npx tsx scripts/test-boats.ts
import { simulateTick } from '../src/battle/simulate';
import type { Unit, GroupOrder, SimulationConfig, MapApi } from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';
import { HexUtils } from '../src/hex-engine/HexUtils';
import { BOAT_STATS } from '../src/data/units';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// mapApi where the hexes in `water` are SEA; everything else GRASSLAND.
const makeMap = (water: Set<string>): MapApi => ({
  isInside: () => true,
  isWalkable: () => true,
  getTerrainType: (h) => (water.has(HexUtils.key(h)) ? 'SEA' : 'GRASSLAND'),
  getTerrainMods: (h) => getTerrainMods(water.has(HexUtils.key(h)) ? 'SEA' : 'GRASSLAND'),
  getTerrainHeight: (h) => (water.has(HexUtils.key(h)) ? 5 : 12),
  isInDeployZone: () => false,
});

const unit = (extra: Partial<Unit> & Pick<Unit, 'id' | 'team' | 'tacticalHex'>): Unit => ({
  unitType: 'infantry', homeHex: extra.tacticalHex, groupId: 1, hp: 100,
  state: 'idle', nextMoveTick: 0, visionRadius: 1, ...extra,
});

// 1. Afloat infantry (100 hp) with no combat clamps to the boat max.
{
  const sea = new Set([HexUtils.key({ q: 0, r: 0 })]);
  const cfg: SimulationConfig = { damagePerTick: 20, mapApi: makeMap(sea), currentTick: 1 };
  const res = simulateTick([unit({ id: 'a', team: 'red', tacticalHex: { q: 0, r: 0 } })], new Map(), cfg);
  const a = res.units.find(u => u.id === 'a');
  check('afloat infantry HP clamps to boat max', !!a && a.hp === BOAT_STATS.maxHp, `hp=${a?.hp} max=${BOAT_STATS.maxHp}`);
}

// 2. Infantry on land is unchanged (control).
{
  const cfg: SimulationConfig = { damagePerTick: 20, mapApi: makeMap(new Set()), currentTick: 1 };
  const res = simulateTick([unit({ id: 'a', team: 'red', tacticalHex: { q: 0, r: 0 } })], new Map(), cfg);
  const a = res.units.find(u => u.id === 'a');
  check('land infantry HP unchanged', !!a && a.hp === 100, `hp=${a?.hp}`);
}

// 3. Afloat skirmisher throws no missiles; 4. land skirmisher does (control).
const skirmisherScene = (afloat: boolean) => {
  const skHex = { q: 0, r: 0 };
  const water = afloat ? new Set([HexUtils.key(skHex)]) : new Set<string>();
  const cfg: SimulationConfig = { damagePerTick: 20, mapApi: makeMap(water), currentTick: 1 };
  const sk = unit({ id: 'sk', team: 'red', tacticalHex: skHex, unitType: 'skirmisher', hp: 40 });
  const foe = unit({ id: 'f', team: 'blue', tacticalHex: { q: 2, r: 0 }, hp: 100 }); // dist 2, in range, not adjacent
  return simulateTick([sk, foe], new Map(), cfg);
};
check('afloat skirmisher emits NO projectile', skirmisherScene(true).projectiles.length === 0,
  `n=${skirmisherScene(true).projectiles.length}`);
check('land skirmisher emits a projectile (control)', skirmisherScene(false).projectiles.length === 1,
  `n=${skirmisherScene(false).projectiles.length}`);

// 5. Afloat charger deals no impact; 6. land charger lances (control).
const chargeScene = (afloat: boolean) => {
  const chHex = { q: 0, r: 0 };
  const delta = HexUtils.directions[0];
  const foeHex = { q: delta.q * 2, r: delta.r * 2 }; // within CHARGE_IMPACT_RANGE (2), not adjacent
  const water = afloat ? new Set([HexUtils.key(chHex)]) : new Set<string>();
  const cfg: SimulationConfig = { damagePerTick: 20, mapApi: makeMap(water), currentTick: 1 };
  // Cooldown-blocked so it stays put and only the impact lance can touch the foe.
  const ch = unit({ id: 'c', team: 'red', tacticalHex: chHex, unitType: 'cavalry', hp: 60, nextMoveTick: 999 });
  const foe = unit({ id: 'f', team: 'blue', tacticalHex: foeHex, hp: 100 });
  const orders = new Map<string, GroupOrder>([
    ['red:1', { team: 'red', groupId: 1, attackTarget: foeHex, heading: 0, mode: 'charge', chargeTicksRemaining: 3 }],
  ]);
  const res = simulateTick([ch, foe], orders, cfg);
  return res.units.find(u => u.id === 'f')!.hp;
};
check('afloat charger applies NO impact damage', chargeScene(true) === 100, `foeHp=${chargeScene(true)}`);
check('land charger lances the foe (control)', chargeScene(false) < 100, `foeHp=${chargeScene(false)}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
