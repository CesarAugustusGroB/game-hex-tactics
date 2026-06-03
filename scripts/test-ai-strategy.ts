// Tier 5 — score-aware posture. When BEHIND on VP, the front bands turn into raiders that push
// through the centre to the enemy line (instead of holding the flag); when level/ahead they keep
// the default hold-the-centre posture. Drives makeAiController directly.
// Run: npx tsx scripts/test-ai-strategy.ts
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

const zone = new Set<string>();
for (let q = -3; q <= 3; q++) for (let r = -9; r <= -4; r++) zone.add(HexUtils.key({ q, r }));
const emptyRoster: Record<UnitType, number> = { infantry: 0, cavalry: 0, skirmisher: 0 };

function order(opts: { myScore: number; enemyScore: number }): GroupOrder | undefined {
  const fn = makeAiController('blue', 'balanced', 'hard');
  const orders = new Map<string, GroupOrder>();
  // Group 1 infantry sitting ON the centre flower — would HOLD under Tier 2 if not raiding.
  const blue = [u('b1', 'blue', { ...CAPTURE_CENTER }, 1, 'infantry')];
  const state: AiTickState = {
    team: 'blue', tick: 300,
    myUnits: blue, enemyUnits: [], myOrders: [], allOrders: orders,
    gridData: [], cp: 200, myScore: opts.myScore, enemyScore: opts.enemyScore,
    roster: emptyRoster, deployZone: zone,
    placeCohort: () => false,
    issueOrder: (g, change) => {
      const k = `blue:${g}`;
      orders.set(k, { team: 'blue', groupId: g, attackTarget: null, heading: 5, ...orders.get(k), ...change });
      return true;
    },
    clearOrder: g => { orders.delete(`blue:${g}`); },
  };
  fn(state);
  return orders.get('blue:1');
}

// --- Behind on VP (deficit ≥ 10% of 200 = 20) → raid forward past the centre ---
{
  const o = order({ myScore: 0, enemyScore: 50 });
  const onCentre = o?.attackTarget?.q === CAPTURE_CENTER.q && o.attackTarget?.r === CAPTURE_CENTER.r;
  check('losing: front band RAIDS (marches forward past the centre, does not hold)',
    o?.mode === 'march' && !onCentre && (o.attackTarget?.r ?? 0) > 10,
    `mode=${o?.mode} target=${JSON.stringify(o?.attackTarget)}`);
}

// --- Level on VP → keep the default posture: hold the centre flower ---
{
  const o = order({ myScore: 0, enemyScore: 0 });
  check('level: front band HOLDS the centre (no raid)', o?.mode === 'hold', `mode=${o?.mode}`);
}

// --- Small deficit (below threshold) → still holds, no premature raiding ---
{
  const o = order({ myScore: 0, enemyScore: 10 });   // 10 < 20 threshold
  check('small deficit: still holds the centre (no premature raid)', o?.mode === 'hold', `mode=${o?.mode}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
