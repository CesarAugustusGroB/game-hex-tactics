// Tier 1 — reserve raid defence. The reserve band (group 4) must, when an enemy threatens our own
// deploy zone: MARCH back toward the breach, then HOLD once in contact; and revert to the centre
// push when the line is clear. Drives makeAiController directly with crafted AiTickState snapshots.
// Run: npx tsx scripts/test-ai-defense.ts
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickState } from '../src/battle/ai';
import { perceive } from '../src/battle/ai/perception';
import type { Unit, GroupOrder, Team, GroupId, UnitType } from '../src/battle/simulate';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { CAPTURE_CENTER } from '../src/data/game';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const u = (id: string, team: Team, hex: Hex, gid: GroupId): Unit => ({
  id, team, unitType: 'infantry', tacticalHex: hex, homeHex: hex,
  groupId: gid, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});

// Blue deploy zone: top strip, q∈[-3,3], r∈{-9,-8}. Far from the centre (0,0).
const zone = new Set<string>();
for (let q = -3; q <= 3; q++) for (const r of [-9, -8]) zone.add(HexUtils.key({ q, r }));
const emptyRoster: Record<UnitType, number> = { infantry: 0, cavalry: 0, skirmisher: 0 };

// Run one controller tick over a crafted snapshot; return the order issued for group `gid`
// (default the reserve, group 4).
function tick(blue: Unit[], red: Unit[], gid: GroupId = 4): GroupOrder | undefined {
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

// --- Hold: reserve already in contact with a breacher ---
{
  const reserve = [u('b1', 'blue', { q: 0, r: -8 }, 4)];
  const raider = [u('r1', 'red', { q: 0, r: -9 }, 1)];   // adjacent to b1, inside my zone
  const o = tick(reserve, raider);
  check('reserve HOLDS when in contact with the raid', o?.mode === 'hold', `mode=${o?.mode}`);
}

// --- Defend: reserve far from a breach marches back toward it ---
{
  const reserve = [u('b1', 'blue', { q: -3, r: -8 }, 4), u('b2', 'blue', { q: -2, r: -8 }, 4)];
  const raider = [u('r1', 'red', { q: 3, r: -9 }, 1)];   // in my zone, far from the reserve
  const o = tick(reserve, raider);
  const threat = perceive({ myUnits: reserve, enemyUnits: raider, deployZone: zone });
  const from = { q: -2, r: -8 };                          // reserve centroid (rounded)
  const here = HexUtils.distance(from, threat.raidThreatHex!);
  const stepped = o ? HexUtils.distance(
    { q: from.q + HexUtils.directions[o.heading].q, r: from.r + HexUtils.directions[o.heading].r },
    threat.raidThreatHex!) : here;

  check('reserve issues a MARCH when threatened but not yet in contact', o?.mode === 'march', `mode=${o?.mode}`);
  check('defend march targets the raid, not the centre',
    !!o?.attackTarget && HexUtils.distance(o.attackTarget, threat.raidThreatHex!) <= 1
    && !(o.attackTarget.q === CAPTURE_CENTER.q && o.attackTarget.r === CAPTURE_CENTER.r),
    `target=${JSON.stringify(o?.attackTarget)} threat=${JSON.stringify(threat.raidThreatHex)}`);
  check('defend heading points the reserve toward the breach (closes distance)', stepped < here,
    `here=${here} stepped=${stepped} heading=${o?.heading}`);
}

// --- Release: no threat → reserve reverts to the centre push ---
{
  const reserve = [u('b1', 'blue', { q: 0, r: -8 }, 4)];
  const o = tick(reserve, []);
  check('reserve marches to the CENTRE when the line is clear',
    o?.mode === 'march' && o.attackTarget?.q === CAPTURE_CENTER.q && o.attackTarget?.r === CAPTURE_CENTER.r,
    `mode=${o?.mode} target=${JSON.stringify(o?.attackTarget)}`);
}

// --- Only the reserve defends: a threatened FRONT group pushes the centre, not the breach ---
{
  const front = [u('b1', 'blue', { q: 0, r: -8 }, 1)];   // group 1 = front band, not the reserve
  const raider = [u('r1', 'red', { q: 0, r: -9 }, 1)];   // breaching our zone, adjacent to b1
  const o = tick(front, raider, 1);
  check('a threatened NON-reserve group pushes the centre, not the breach',
    o?.mode === 'march' && o.attackTarget?.q === CAPTURE_CENTER.q && o.attackTarget?.r === CAPTURE_CENTER.r,
    `mode=${o?.mode} target=${JSON.stringify(o?.attackTarget)}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
