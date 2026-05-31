// Verifies the support bonus: each living adjacent ally reduces incoming damage by
// SUPPORT_REDUCTION_PER_ALLY, capped at SUPPORT_REDUCTION_CAP, applied multiplicatively in
// both melee and missile formulas. Mirrors the MapApi/Unit scaffolding of test-hold.ts.
// Run: npx tsx scripts/test-support.ts
import { simulateTick, supportReduction } from '../src/battle/simulate';
import { SUPPORT_REDUCTION_PER_ALLY, SUPPORT_REDUCTION_CAP } from '../src/data/combat';
import { SKIRMISHER_MISSILE_DAMAGE } from '../src/data/units';
import type { Unit, GroupOrder, SimulationConfig, MapApi } from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const DMG = 20;
const mapApi: MapApi = {
  isInside: () => true,
  isWalkable: () => true,
  getTerrainType: () => 'GRASSLAND',
  getTerrainMods: () => getTerrainMods('GRASSLAND'),
  getTerrainHeight: () => 12,
  isInDeployZone: () => false,
};
const config: SimulationConfig = { damagePerTick: DMG, mapApi, currentTick: 1 };
const defenseMult = getTerrainMods('GRASSLAND').defenseMult;
const meleeBase = DMG / defenseMult; // flat terrain → no height bonus, no hold
const missileBase = SKIRMISHER_MISSILE_DAMAGE / defenseMult;

const u = (id: string, team: 'red' | 'blue', type: Unit['unitType'], q: number, r: number, hp: number): Unit => ({
  id, team, unitType: type, tacticalHex: { q, r }, homeHex: { q, r },
  groupId: 1, hp, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});

const damageTaken = (units: Unit[], startHp: number): number => {
  const res = simulateTick(units, new Map<string, GroupOrder>(), config);
  return startHp - res.units.find(x => x.id === 'd')!.hp;
};

// --- pure helper ---
check('supportReduction(0) = 0', near(supportReduction(0), 0));
check('supportReduction(2) = 2 * per-ally', near(supportReduction(2), 2 * SUPPORT_REDUCTION_PER_ALLY));
check('supportReduction caps at SUPPORT_REDUCTION_CAP', near(supportReduction(6), SUPPORT_REDUCTION_CAP));

// Defender at (0,0); melee attacker E-adjacent at (1,0). Non-attacker neighbours of (0,0):
const allyHexes = [{ q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
const defender = () => u('d', 'red', 'infantry', 0, 0, 100);
const attacker = u('a', 'blue', 'infantry', 1, 0, 9999); // huge HP → always lowest-HP target is 'd'

// 1. isolated (only an enemy adjacent) → no support, full damage (proves enemies don't count).
check('isolated defender takes full melee damage',
  near(damageTaken([defender(), attacker], 100), meleeBase));

// 2. two adjacent allies → 10% reduction.
const twoAllies = allyHexes.slice(0, 2).map((h, i) => u(`p${i}`, 'red', 'infantry', h.q, h.r, 9999));
check('two allies reduce melee damage by 2 * per-ally',
  near(damageTaken([defender(), attacker, ...twoAllies], 100), meleeBase * (1 - 2 * SUPPORT_REDUCTION_PER_ALLY)));

// 3. five adjacent allies → reduction clamped to the cap.
const fiveAllies = allyHexes.map((h, i) => u(`p${i}`, 'red', 'infantry', h.q, h.r, 9999));
check('five allies clamp melee reduction to the cap',
  near(damageTaken([defender(), attacker, ...fiveAllies], 100), meleeBase * (1 - SUPPORT_REDUCTION_CAP)));

// 4. dead allies don't count. Place them on hexes NOT adjacent to the attacker so a hp=0 unit
//    can't steal the lowest-HP target slot from the defender.
const deadHexes = [{ q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }];
const deadAllies = deadHexes.map((h, i) => u(`p${i}`, 'red', 'infantry', h.q, h.r, 0));
check('dead allies grant no support',
  near(damageTaken([defender(), attacker, ...deadAllies], 100), meleeBase));

// 5. missile damage gets the same reduction. Skirmisher at distance 2 (ranged); allies on the
//    far side so the defender stays the closest target.
const skirm = u('a', 'blue', 'skirmisher', 2, 0, 9999);
const farAllies = [{ q: -1, r: 0 }, { q: -1, r: 1 }].map((h, i) => u(`p${i}`, 'red', 'infantry', h.q, h.r, 9999));
check('isolated defender takes full missile damage',
  near(damageTaken([defender(), skirm], 100), missileBase));
check('two allies reduce missile damage by 2 * per-ally',
  near(damageTaken([defender(), skirm, ...farAllies], 100), missileBase * (1 - 2 * SUPPORT_REDUCTION_PER_ALLY)));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
