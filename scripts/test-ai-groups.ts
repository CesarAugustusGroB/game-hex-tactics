// The AI must obey the player's group rules: fill ONE active group at a time, mass it before
// launching, never deposit units into a sealed (launched) group. Run: npx tsx scripts/test-ai-groups.ts
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickState } from '../src/battle/ai';
import type { Unit, GroupOrder, GroupId, UnitType, Team } from '../src/battle/simulate';
import { HexUtils } from '../src/hex-engine/HexUtils';
import { isGroupSealed } from '../src/canvas/constants';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const GROUP_IDS: GroupId[] = [1, 2, 3, 4];
const COHORT = 4;

// Big deploy zone so targetUnits isn't clamped tiny (perGroupTarget can be reached, multiple
// groups can form sequentially).
const makeZone = (): Set<string> => {
  const z = new Set<string>();
  for (let q = 0; q < 20; q++) for (let r = 0; r < 10; r++) z.add(HexUtils.key({ q, r }));
  return z;
};

interface Harness {
  units: Unit[];
  orders: Map<string, GroupOrder>;
  placedGids: GroupId[];
  advancedGids: GroupId[];
  runTick: (tick: number, enemies: Unit[]) => void;
}

const makeHarness = (seedUnits: Unit[], roster: Record<UnitType, number>, cp = 999): Harness => {
  const deployZone = makeZone();
  const h: Harness = {
    units: [...seedUnits], orders: new Map(), placedGids: [], advancedGids: [], runTick: () => {},
  };
  const ctrl = makeAiController('blue', 'balanced', 'hard');
  h.runTick = (tick, enemies) => {
    const state: AiTickState = {
      team: 'blue', tick, myUnits: h.units, enemyUnits: enemies,
      myOrders: [...h.orders.values()].filter(o => o.team === 'blue'),
      allOrders: h.orders, gridData: [], cp, roster, deployZone,
      issueOrder: (gid, change) => {
        const key = `blue:${gid}`;
        const next: GroupOrder = { team: 'blue', groupId: gid, attackTarget: null, heading: 5, ...h.orders.get(key), ...change };
        h.orders.set(key, next);
        if (next.attackTarget != null && next.mode !== 'idle' && next.mode !== 'hold') h.advancedGids.push(gid);
        return true;
      },
      clearOrder: () => {},
      placeCohort: (gid, anchor, unitType) => {
        h.placedGids.push(gid);
        // Mirror the host: place a full cohort at the anchor + free neighbours in the zone.
        const cells = [anchor, ...HexUtils.getNeighbors(anchor)];
        const occupied = new Set(h.units.map(u => HexUtils.key(u.tacticalHex)));
        let added = 0;
        for (const c of cells) {
          if (added >= COHORT) break;
          const k = HexUtils.key(c);
          if (!deployZone.has(k) || occupied.has(k)) continue;
          occupied.add(k);
          h.units = [...h.units, {
            id: `u${h.units.length}`, team: 'blue', unitType, tacticalHex: c, homeHex: c,
            groupId: gid, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1,
          }];
          added++;
        }
        roster = { ...roster, [unitType]: roster[unitType] - added };
        return added > 0;
      },
    };
    ctrl(state);
  };
  return h;
};

const aliveOf = (units: Unit[]) => units.filter(u => u.hp > 0);
const unsealedNonEmpty = (h: Harness, zone: Set<string>): number =>
  GROUP_IDS.filter(g => {
    const gu = aliveOf(h.units).filter(u => u.groupId === g);
    return gu.length > 0 && !isGroupSealed(aliveOf(h.units), h.orders, zone, 'blue', g);
  }).length;

// 1. At no tick are there two unsealed non-empty groups at once (fill one group at a time).
{
  const h = makeHarness([], { infantry: 200, cavalry: 200, skirmisher: 200 });
  const zone = makeZone();
  const farEnemy: Unit = { id: 'e', team: 'red', unitType: 'infantry', tacticalHex: { q: 5, r: 40 }, homeHex: { q: 5, r: 40 }, groupId: 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1 };
  let maxConcurrent = 0;
  for (let t = 1; t <= 60; t++) { h.runTick(t, [farEnemy]); maxConcurrent = Math.max(maxConcurrent, unsealedNonEmpty(h, zone)); }
  check('never fills 2+ groups at once (one active group)', maxConcurrent <= 1, `maxConcurrentUnsealed=${maxConcurrent}`);
  check('still deploys (sanity)', h.units.length > 0, `units=${h.units.length}`);
}

// 2. Never deposits units into a sealed (already-launched) group.
{
  // Seed group 1 as sealed: units in zone + an active advance order.
  const seed: Unit[] = [0, 1, 2, 3].map(i => ({
    id: `s${i}`, team: 'blue' as Team, unitType: 'infantry' as UnitType, tacticalHex: { q: i, r: 0 }, homeHex: { q: i, r: 0 },
    groupId: 1 as GroupId, hp: 100, state: 'idle' as const, nextMoveTick: 0, visionRadius: 1,
  }));
  const h = makeHarness(seed, { infantry: 200, cavalry: 200, skirmisher: 200 });
  h.orders.set('blue:1', { team: 'blue', groupId: 1, attackTarget: { q: 5, r: 5 }, heading: 5, mode: 'march' });
  for (let t = 1; t <= 5; t++) h.runTick(t, []);
  check('never places into the sealed group 1', !h.placedGids.includes(1), `placedGids=[${h.placedGids.join(',')}]`);
}

// 3. Amass-then-launch is gated by CP SPENT, not unit count: a group keeps amassing while it
//    can spend more of its amass budget, marches once the budget is spent (or it can't amass).
{
  const mkGroup = (n: number): Unit[] => Array.from({ length: n }, (_, i) => ({
    id: `g${i}`, team: 'blue' as Team, unitType: 'infantry' as UnitType, tacticalHex: { q: i, r: 0 }, homeHex: { q: i, r: 0 },
    groupId: 1 as GroupId, hp: 100, state: 'idle' as const, nextMoveTick: 0, visionRadius: 1,
  }));
  const enemy: Unit = { id: 'e', team: 'red', unitType: 'infantry', tacticalHex: { q: 5, r: 30 }, homeHex: { q: 5, r: 30 }, groupId: 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1 };

  // (a) Under budget with roster + room → keeps amassing, does not launch.
  const amassing = makeHarness(mkGroup(8), { infantry: 200, cavalry: 200, skirmisher: 200 });
  amassing.runTick(1, [enemy]);
  check('under CP budget → amasses, does NOT launch', !amassing.advancedGids.includes(1), `advanced=[${amassing.advancedGids.join(',')}]`);

  // (b) Can't amass (roster empty) → falls through to march (anti-deadlock).
  const stuck = makeHarness(mkGroup(8), { infantry: 0, cavalry: 0, skirmisher: 0 });
  stuck.runTick(1, [enemy]);
  check('cannot amass (no roster) → marches', stuck.advancedGids.includes(1), `advanced=[${stuck.advancedGids.join(',')}]`);

  // (c) From empty, given enough ticks the active group spends its amass budget and then marches.
  const grown = makeHarness([], { infantry: 200, cavalry: 200, skirmisher: 200 });
  for (let t = 1; t <= 60; t++) grown.runTick(t, [enemy]);
  check('spends the amass budget then launches', grown.advancedGids.length > 0, `advanced=[${grown.advancedGids.join(',')}]`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
