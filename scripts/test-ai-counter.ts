// Counterattack: the launch bar scales with danger of defeat. A half-built front band HOLDS in the
// deploy zone when safe, but LAUNCHES early (with fewer amassed units) when losing on VP or under
// raid pressure. Drives makeAiController directly with crafted snapshots.
// Run: npx tsx scripts/test-ai-counter.ts
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickState } from '../src/battle/ai';
import type { Unit, GroupOrder, Team, GroupId, UnitType } from '../src/battle/simulate';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const u = (id: string, team: Team, hex: Hex, gid: GroupId): Unit => ({
  id, team, unitType: 'infantry', tacticalHex: hex, homeHex: hex,
  groupId: gid, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});

// Zone of 42 hexes → bandShare = 5 (so a band of 4 is below the full bar but at the danger-lowered
// bar of 4). Front group 1 (balanced doctrine → infantry) is pre-placed with one cohort (4) inside.
const zone = new Set<string>();
const zoneHexes: Hex[] = [];
for (let q = -3; q <= 3; q++) for (let r = -9; r <= -4; r++) { zone.add(HexUtils.key({ q, r })); zoneHexes.push({ q, r }); }
const fullRoster: Record<UnitType, number> = { infantry: 100, cavalry: 0, skirmisher: 0 };

function launchOrder(opts: { red?: Unit[]; myScore?: number; enemyScore?: number }): GroupOrder | undefined {
  const fn = makeAiController('blue', 'balanced', 'hard');
  const orders = new Map<string, GroupOrder>();
  // One cohort (4 infantry) for group 1, on the first 4 zone hexes.
  const blue = zoneHexes.slice(0, 4).map((h, i) => u(`b${i}`, 'blue', h, 1));
  const state: AiTickState = {
    team: 'blue', tick: 300,
    myUnits: blue, enemyUnits: opts.red ?? [], myOrders: [], allOrders: orders,
    gridData: [], cp: 200, myScore: opts.myScore ?? 0, enemyScore: opts.enemyScore ?? 0,
    roster: { ...fullRoster }, deployZone: zone,
    placeCohort: () => false,            // free space + roster exist (so the band still "could grow")
    issueOrder: (gid, change) => {
      const k = `blue:${gid}`;
      orders.set(k, { team: 'blue', groupId: gid, attackTarget: null, heading: 5, ...orders.get(k), ...change });
      return true;
    },
    clearOrder: gid => { orders.delete(`blue:${gid}`); },
  };
  fn(state);
  return orders.get('blue:1');
}


// --- Safe: full bar (bandShare 5) not reached → the partial band holds in the zone ---
{
  const o = launchOrder({ myScore: 0, enemyScore: 0 });
  check('safe: partial front band HOLDS (no launch)', o === undefined, `order=${JSON.stringify(o)}`);
}

// --- Losing on VP → the partial band LAUNCHES rather than holding in the zone. (When this far
// behind it raids FORWARD past the centre — Tier 5 — which is still a launch; the centre-bound
// launchShare path is covered by the pressure cases below, which carry no VP deficit.) ---
{
  const o = launchOrder({ myScore: 0, enemyScore: 180 });   // enemy near 200 → losing → raid
  check('VP danger: partial band LAUNCHES (does not hold in the zone)', o?.mode === 'march',
    `order=${JSON.stringify(o)}`);
}

// --- Under raid pressure (no VP gap): breachers in our zone also lower the bar ---
{
  const breachers = [
    u('e1', 'red', { q: 3, r: -9 }, 1), u('e2', 'red', { q: 3, r: -8 }, 1), u('e3', 'red', { q: 3, r: -7 }, 1),
  ];
  const o = launchOrder({ red: breachers, myScore: 0, enemyScore: 0 });
  check('breacher pressure: partial band LAUNCHES (does not hold in the zone)', o?.mode === 'march', `order=${JSON.stringify(o)}`);
}

// --- Raiders APPROACHING the zone (outside it, no breachers) also raise danger ---
{
  // r = -3 is one hex below the zone's r = -4 edge → within raidWatchRadius (2), not inside the zone.
  const raiders = [0, 1, 2, 3].map(i => u(`e${i}`, 'red', { q: i, r: -3 }, 1));
  const o = launchOrder({ red: raiders, myScore: 0, enemyScore: 0 });
  check('raider pressure: partial band LAUNCHES (does not hold in the zone)', o?.mode === 'march', `order=${JSON.stringify(o)}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
