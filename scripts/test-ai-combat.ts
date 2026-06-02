// Tier 2 — per-type combat modes. With the balanced doctrine (front = infantry, cavalry,
// skirmisher → groups 1,2,3): a cavalry group CHARGES a nearby enemy (heading aimed at it), a
// skirmisher group UNLEASHES when an enemy is in play, an infantry group HOLDS the centre flower,
// and any group with no enemy / not on the flower falls back to the centre march.
// Run: npx tsx scripts/test-ai-combat.ts
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickState } from '../src/battle/ai';
import type { Unit, GroupOrder, Team, GroupId, UnitType } from '../src/battle/simulate';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { CAPTURE_CENTER } from '../src/data/game';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const u = (id: string, team: Team, hex: Hex, gid: GroupId, unitType: UnitType = 'infantry'): Unit => ({
  id, team, unitType, tacticalHex: hex, homeHex: hex,
  groupId: gid, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});

// Deploy zone is the top strip (r ∈ [-9,-4]); the combat groups sit out on the field (r ≈ 0), away
// from both the zone and the centre, so nothing triggers reserve defence.
const zone = new Set<string>();
for (let q = -3; q <= 3; q++) for (let r = -9; r <= -4; r++) zone.add(HexUtils.key({ q, r }));
const emptyRoster: Record<UnitType, number> = { infantry: 0, cavalry: 0, skirmisher: 0 };

function tick(blue: Unit[], red: Unit[], gid: GroupId): GroupOrder | undefined {
  const fn = makeAiController('blue', 'balanced', 'hard');
  const orders = new Map<string, GroupOrder>();
  const state: AiTickState = {
    team: 'blue', tick: 300,
    myUnits: blue, enemyUnits: red, myOrders: [], allOrders: orders,
    gridData: [], cp: 200, roster: emptyRoster, deployZone: zone,
    placeCohort: () => false,
    issueOrder: (g, change) => {
      const k = `blue:${g}`;
      orders.set(k, { team: 'blue', groupId: g, attackTarget: null, heading: 5, ...orders.get(k), ...change });
      return true;
    },
    clearOrder: g => { orders.delete(`blue:${g}`); },
  };
  fn(state);
  return orders.get(`blue:${gid}`);
}

const isCentreMarch = (o?: GroupOrder) =>
  o?.mode === 'march' && o.attackTarget?.q === CAPTURE_CENTER.q && o.attackTarget?.r === CAPTURE_CENTER.r;

// --- Cavalry (group 2) charges a nearby enemy, heading aimed at it ---
{
  const cav = [u('b1', 'blue', { q: -6, r: 0 }, 2, 'cavalry'), u('b2', 'blue', { q: -5, r: 0 }, 2, 'cavalry')];
  const enemy = [u('r1', 'red', { q: -3, r: 0 }, 1)];        // 2 hexes from the cavalry
  const o = tick(cav, enemy, 2);
  const from = { q: -5, r: 0 };                               // cavalry centroid (rounded)
  const here = HexUtils.distance(from, enemy[0].tacticalHex);
  const stepped = o ? HexUtils.distance(
    { q: from.q + HexUtils.directions[o.heading].q, r: from.r + HexUtils.directions[o.heading].r },
    enemy[0].tacticalHex) : here;
  check('cavalry CHARGES a nearby enemy', o?.mode === 'charge', `mode=${o?.mode}`);
  check('charge heading points at the enemy (closes distance)', o?.mode === 'charge' && stepped < here,
    `here=${here} stepped=${stepped} heading=${o?.heading}`);
}

// --- Skirmisher (group 3) unleashes when an enemy is in play ---
{
  const skirm = [u('b1', 'blue', { q: -6, r: 2 }, 3, 'skirmisher'), u('b2', 'blue', { q: -5, r: 2 }, 3, 'skirmisher')];
  const enemy = [u('r1', 'red', { q: -2, r: 2 }, 1)];        // 3 hexes away — within engageRange
  const o = tick(skirm, enemy, 3);
  check('skirmisher UNLEASHES on an enemy in play', o?.mode === 'unleash', `mode=${o?.mode}`);
}

// --- Infantry (group 1) holds the centre flower ---
{
  const inf = [u('b1', 'blue', { ...CAPTURE_CENTER }, 1, 'infantry')];
  const o = tick(inf, [], 1);
  check('infantry HOLDS the captured centre', o?.mode === 'hold', `mode=${o?.mode}`);
}

// --- Fallbacks: no enemy / not on the flower → push the centre ---
{
  const cavFar = [u('b1', 'blue', { q: -6, r: 0 }, 2, 'cavalry')];   // no enemies anywhere
  check('cavalry with no enemy marches to the centre', isCentreMarch(tick(cavFar, [], 2)));

  const infField = [u('b1', 'blue', { q: -6, r: 0 }, 1, 'infantry')]; // off the flower, no enemy
  check('infantry off the flower marches to the centre', isCentreMarch(tick(infField, [], 1)));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
