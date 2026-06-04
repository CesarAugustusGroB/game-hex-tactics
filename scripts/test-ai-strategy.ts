// Tier 5 + seize-the-centre. Until myScore reaches centerFocusVpFrac of the win target (0.3·200 =
// 60), the centre is THE priority: the army marches to the flag and raids are suppressed. Past 60,
// the centre matters less → focus fire (Tier 4) and, when behind, raids (Tier 5) take over.
// Run: npx tsx scripts/test-ai-strategy.ts
import { makeAiController } from '../src/battle/ai/controller';
import { ALL_CAPABILITIES } from '../src/data/ai';
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

const zone = new Set<string>();
for (let q = -3; q <= 3; q++) for (let r = -9; r <= -4; r++) zone.add(HexUtils.key({ q, r }));
const emptyRoster: Record<UnitType, number> = { infantry: 0, cavalry: 0, skirmisher: 0 };

function tick(blue: Unit[], red: Unit[], myScore: number, enemyScore: number, gid: GroupId = 1): GroupOrder | undefined {
  const fn = makeAiController('blue', 'balanced', 'hard', ALL_CAPABILITIES);
  const orders = new Map<string, GroupOrder>();
  const state: AiTickState = {
    team: 'blue', tick: 300,
    myUnits: blue, enemyUnits: red, myOrders: [], allOrders: orders,
    gridData: [], cp: 200, myScore, enemyScore, roster: emptyRoster, deployZone: zone,
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

const farEnemy = [u('e1', 'red', { q: 8, r: 8 }, 1)];   // a lone weak cluster off on a flank

// --- Seize phase (myScore < 60): march to the CENTRE, ignoring the flank focus ---
{
  const g = [u('b1', 'blue', { q: 0, r: 3 }, 1, 'infantry')];   // off the flag
  const o = tick(g, farEnemy, 0, 0);
  check('seize phase: group marches to the CENTRE (not the flank focus)', isCentreMarch(o),
    `target=${JSON.stringify(o?.attackTarget)}`);
}

// --- Seize phase: a group ON the flag HOLDS it ---
{
  const g = [u('b1', 'blue', { ...CAPTURE_CENTER }, 1, 'infantry')];
  check('seize phase: group on the flag HOLDS it', tick(g, [], 0, 0)?.mode === 'hold');
}

// --- Past 60 VP: centre de-prioritised → focus fire the weakest cluster (not the centre) ---
{
  const g = [u('b1', 'blue', { q: 0, r: 3 }, 1, 'infantry')];
  const o = tick(g, farEnemy, 60, 0);
  check('past 60 VP: group focus-fires the weakest cluster (not the centre)',
    o?.mode === 'march' && !isCentreMarch(o) && (o.attackTarget?.q ?? 0) > 3,
    `target=${JSON.stringify(o?.attackTarget)}`);
}

// --- Past 60 VP and behind → raid forward past the centre ---
{
  const g = [u('b1', 'blue', { q: 0, r: 3 }, 1, 'infantry')];
  const o = tick(g, [], 60, 120);   // myScore 60 (past seize), 60 behind → raid
  check('past 60 VP + losing: group RAIDS forward (past the centre)',
    o?.mode === 'march' && !isCentreMarch(o) && (o.attackTarget?.r ?? 0) > 10,
    `target=${JSON.stringify(o?.attackTarget)}`);
}

// --- Below 60 and behind → STILL fights for the centre, no premature raids ---
{
  const g = [u('b1', 'blue', { q: 0, r: 3 }, 1, 'infantry')];
  const o = tick(g, [], 0, 120);   // way behind but myScore < 60 → centre first
  check('below 60 + losing: still marches to the CENTRE (raids suppressed)', isCentreMarch(o),
    `target=${JSON.stringify(o?.attackTarget)}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
