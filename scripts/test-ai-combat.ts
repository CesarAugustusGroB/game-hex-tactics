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

// --- Homeland repel: a mass past the centre in our half makes EVERY group march to intercept,
// overriding per-type combat (cavalry repels instead of charging). ---
{
  // 6 reds at r=-1 (py<0 → blue's half), q far from 0 so they're not raiders (3 hexes from the
  // r=-4 zone edge) and don't sit on the centre flower. centroid ≈ (-2,-1).
  const mass = [-5, -4, -3, -2, -1, 1].map(q => u(`r${q}`, 'red', { q, r: -1 }, 1));
  const cav = [u('b1', 'blue', { q: 0, r: 3 }, 2, 'cavalry')];   // group 2 = cavalry; a foe is in charge range
  const o = tick(cav, mass, 2);
  const expected = { q: -2, r: -1 };
  const from = { q: 0, r: 3 };
  const here = HexUtils.distance(from, expected);
  const stepped = o ? HexUtils.distance(
    { q: from.q + HexUtils.directions[o.heading].q, r: from.r + HexUtils.directions[o.heading].r }, expected) : here;
  check('homeland repel: cavalry MARCHES to the mass (does not charge)', o?.mode === 'march',
    `mode=${o?.mode}`);
  check('repel targets the mass in our half, not the centre',
    !!o?.attackTarget && HexUtils.distance(o.attackTarget, expected) <= 1
    && !(o.attackTarget.q === CAPTURE_CENTER.q && o.attackTarget.r === CAPTURE_CENTER.r),
    `target=${JSON.stringify(o?.attackTarget)} expected≈${JSON.stringify(expected)}`);
  check('repel heading points back at the mass (closes distance)', stepped < here,
    `here=${here} stepped=${stepped}`);
}

// --- Tactical repel: a moderate mass (→ 1 group needed) diverts only the NEAREST group; a far
// group keeps its objective (a screen stays on the centre). ---
{
  const mass = [-5, -4, -3, -2, -1, 1].map(q => u(`r${q}`, 'red', { q, r: -1 }, 1)); // 6 → need = 1
  const near = u('b1', 'blue', { q: -2, r: 1 }, 1, 'infantry');                       // 2 hexes from the mass
  const far = u('b2', 'blue', { q: 5, r: 6 }, 3, 'skirmisher');                       // far from mass & foes
  const expected = { q: -2, r: -1 };

  const oNear = tick([near, far], mass, 1);
  check('tactical repel: the NEAREST group marches to the mass',
    oNear?.mode === 'march' && !!oNear.attackTarget && HexUtils.distance(oNear.attackTarget, expected) <= 1,
    `target=${JSON.stringify(oNear?.attackTarget)}`);

  const oFar = tick([near, far], mass, 3);
  // With focus fire (Tier 4) the far group no longer idles on the centre — it converges on the
  // enemy too; only the NEAREST group got the immediate 'repel' (bypassing the launch gate).
  check('tactical repel + focus: the FAR group also engages the enemy (marches, not centre)',
    oFar?.mode === 'march' && !isCentreMarch(oFar), `mode=${oFar?.mode} target=${JSON.stringify(oFar?.attackTarget)}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
