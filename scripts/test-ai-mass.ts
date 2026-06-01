// A band must AMASS to (near) its full bandShare before it launches — every wave, not just the
// first. Bug: frontBuilt = "nothing placed this tick" fired on CP-starved ticks, so later waves
// marched at ~50% of bandShare while the first (CP-rich) wave filled completely.
// Run: npx tsx scripts/test-ai-mass.ts
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickState } from '../src/battle/ai';
import type { Unit, GroupOrder, UnitType } from '../src/battle/simulate';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { COHORT_SIZE } from '../src/data/game';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const strip: Hex[] = [];
for (let q = -16; q <= 16; q++) for (let r = -3; r <= 0; r++) strip.push({ q, r });
const deployZone = new Set(strip.map(HexUtils.key));

// Mirror the controller's sizing to know the target bandShare.
const forceScale = 0.85; // normal
const targetUnits = Math.max(4 * COHORT_SIZE, Math.floor(deployZone.size * 0.5 * forceScale));
const bandShare = Math.max(COHORT_SIZE, Math.floor(targetUnits / 4));

const ctrl = makeAiController('blue', 'balanced', 'normal');
const units: Unit[] = [];
let roster: Record<UnitType, number> = { infantry: 500, cavalry: 500, skirmisher: 500 };
const orders = new Map<string, GroupOrder>();
let cp = 200;

const placeCohort = (gid: number, anchor: Hex, t: UnitType): boolean => {
  if (roster[t] <= 0 || cp < 2) return false;
  const occ = new Set(units.map(u => HexUtils.key(u.tacticalHex)));
  const spots = [anchor, ...HexUtils.getNeighbors(anchor)].filter(h => deployZone.has(HexUtils.key(h)) && !occ.has(HexUtils.key(h))).slice(0, 4);
  if (!spots.length) return false; cp -= 2;
  for (const h of spots) { if (roster[t] <= 0) break; units.push({ id: `u${units.length}`, team: 'blue', unitType: t, tacticalHex: h, homeHex: h, groupId: gid as 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1 }); roster = { ...roster, [t]: roster[t] - 1 }; }
  return true;
};

const enemy: Unit = { id: 'e', team: 'red', unitType: 'infantry', tacticalHex: { q: 0, r: 40 }, homeHex: { q: 0, r: 40 }, groupId: 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1 };
const launchFracs: { tick: number; gid: number; frac: number }[] = [];

for (let t = 1; t <= 500; t++) {
  cp = Math.min(200, cp + 1.0); // real regen ~1 CP/tick
  const state: AiTickState = {
    team: 'blue', tick: t, myUnits: units, enemyUnits: [enemy], myOrders: [...orders.values()].filter(o => o.team === 'blue'),
    allOrders: orders, gridData: [], cp, roster, deployZone,
    issueOrder: (gid, change) => {
      if (cp < 2) return false;
      if (change.mode === 'march') {
        const size = units.filter(u => u.groupId === gid).length;
        launchFracs.push({ tick: t, gid, frac: size / bandShare });
      }
      const k = `blue:${gid}`; orders.set(k, { team: 'blue', groupId: gid, attackTarget: null, heading: 5, ...orders.get(k), ...change }); cp -= 2; return true;
    },
    clearOrder: () => {}, placeCohort,
  };
  ctrl(state);
  // Wave departs: marched groups leave the zone → recycle so the AI must amass a fresh wave.
  for (let i = units.length - 1; i >= 0; i--) if (orders.get(`blue:${units[i].groupId}`)?.mode === 'march') units.splice(i, 1);
  for (const [k, o] of orders) if (o.mode === 'march') orders.delete(k);
}

console.log(`bandShare=${bandShare}, launches=${launchFracs.length}`);
const later = launchFracs.filter(l => l.tick > 60); // past the first CP-rich wave
const minFrac = later.length ? Math.min(...later.map(l => l.frac)) : 1;
console.log('later-wave launch fills:', later.slice(0, 12).map(l => l.frac.toFixed(2)).join(' '));
check('there are sustained later-wave launches', later.length >= 3, `n=${later.length}`);
check('every wave amasses to >=80% of bandShare before launching', minFrac >= 0.8, `minFrac=${minFrac.toFixed(2)}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
