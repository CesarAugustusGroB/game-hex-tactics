// Unit test for the AI perception layer (Tier 0): raid detection against my deploy zone,
// centre control, and enemy main-body location. Pure — no sim, no host.
// Run: npx tsx scripts/test-ai-perception.ts
import { perceive } from '../src/battle/ai/perception';
import type { Unit, Team } from '../src/battle/simulate';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { CAPTURE_CENTER } from '../src/data/game';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const u = (id: string, team: Team, hex: Hex, hp = 100): Unit => ({
  id, team, unitType: 'infantry', tacticalHex: hex, homeHex: hex,
  groupId: 1, hp, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});
const zoneOf = (...hexes: Hex[]): Set<string> => new Set(hexes.map(HexUtils.key));

// My (blue) deploy zone: a small strip far from the centre so raid tests don't collide with it.
const zone = zoneOf({ q: -1, r: -9 }, { q: 0, r: -9 }, { q: 1, r: -9 });

// --- Raid detection ---
{
  const breacher = u('e1', 'red', { q: 0, r: -9 });        // sitting in my zone
  const raider = u('e2', 'red', { q: 0, r: -7 });          // distance 2 from a zone hex
  const distant = u('e3', 'red', { q: 5, r: 0 });          // far from zone, off-centre
  const t = perceive({ myUnits: [], enemyUnits: [breacher, raider, distant], deployZone: zone });

  check('breachers: enemy inside my zone is flagged', t.breachers.length === 1 && t.breachers[0].id === 'e1',
    `breachers=[${t.breachers.map(b => b.id)}]`);
  check('raiders: enemy within radius 2 of my zone is flagged', t.raiders.length === 1 && t.raiders[0].id === 'e2',
    `raiders=[${t.raiders.map(b => b.id)}]`);
  check('distant enemy is neither breacher nor raider',
    !t.breachers.some(b => b.id === 'e3') && !t.raiders.some(b => b.id === 'e3'));
  check('raidThreatHex is set when the line is threatened', t.raidThreatHex !== null);
  check('enemyCount counts all living enemies', t.enemyCount === 3, `count=${t.enemyCount}`);
  check('enemyCentroid is set when enemies exist', t.enemyCentroid !== null);
}

// --- raidWatchRadius respected ---
{
  const raider = u('e2', 'red', { q: 0, r: -7 });          // distance 2
  const tight = perceive({ myUnits: [], enemyUnits: [raider], deployZone: zone }, { raidWatchRadius: 1 });
  check('raidWatchRadius=1 excludes the distance-2 enemy', tight.raiders.length === 0,
    `raiders=[${tight.raiders.map(b => b.id)}]`);
}

// --- Clear line ---
{
  const farAway = u('e9', 'red', { q: 6, r: 0 });
  const t = perceive({ myUnits: [], enemyUnits: [farAway], deployZone: zone });
  check('clear line: no breachers/raiders, raidThreatHex null',
    t.breachers.length === 0 && t.raiders.length === 0 && t.raidThreatHex === null);
}

// --- Centre control ---
{
  const center = CAPTURE_CENTER;
  const neighbor = HexUtils.getNeighbors(center)[0];
  const mineIn = u('m1', 'blue', center);
  const enemyIn = u('x1', 'red', neighbor);

  const mine = perceive({ myUnits: [mineIn], enemyUnits: [], deployZone: zone });
  check("centre 'mine' when only my units hold it", mine.centerControl === 'mine' && mine.myInCenter === 1,
    `control=${mine.centerControl} my=${mine.myInCenter}`);

  const enemy = perceive({ myUnits: [], enemyUnits: [enemyIn], deployZone: zone });
  check("centre 'enemy' when only enemies hold it", enemy.centerControl === 'enemy' && enemy.enemyInCenter === 1,
    `control=${enemy.centerControl} enemy=${enemy.enemyInCenter}`);

  const both = perceive({ myUnits: [mineIn], enemyUnits: [enemyIn], deployZone: zone });
  check("centre 'contested' when both hold it", both.centerControl === 'contested',
    `control=${both.centerControl}`);

  const none = perceive({ myUnits: [], enemyUnits: [], deployZone: zone });
  check("centre 'empty' when nobody holds it", none.centerControl === 'empty', `control=${none.centerControl}`);
}

// --- Dead units ignored ---
{
  const dead = u('d1', 'red', { q: 0, r: -9 }, 0);
  const t = perceive({ myUnits: [], enemyUnits: [dead], deployZone: zone });
  check('dead enemies are ignored', t.breachers.length === 0 && t.enemyCount === 0);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
