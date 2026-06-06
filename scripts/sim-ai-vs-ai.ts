/**
 * Head-to-head AI harness: two registered controllers fight on the same map until one
 * reaches the VP target (or the tick cap). Unlike test-ai-battle.ts (blue vs. an inert
 * red army), BOTH teams deploy, command, and score — so this measures the AI against a
 * real opponent and lets us compare doctrines/difficulties quantitatively.
 *
 * Faithful to the live loop in useBattleTick.ts: real CP economy (regen + per-intent
 * debit + centre-hold bonus), real scoring (raid the enemy line + uncontested centre
 * hold), reached units return to roster.
 *
 * Run a single match:   npx tsx scripts/sim-ai-vs-ai.ts
 * Run the round-robin:  npx tsx scripts/sim-ai-vs-ai.ts --grid
 */
import { simulateTick } from '../src/battle/simulate';
import type { Unit, GroupOrder, Team, UnitType, MapApi } from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';
import { scoreTick, type Score } from '../src/battle/scoring';
import { makeAiController } from '../src/battle/ai/controller';
import type { AiTickFn, AiTickState } from '../src/battle/ai';
import {
  CP_CAP, CP_INITIAL, CP_REGEN_PER_TICK_STEP, CP_COSTS, type CommandPoints,
} from '../src/battle/command-points';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { MAX_HP_BY_TYPE } from '../src/data/units';
import { POINTS_TO_WIN, POINTS_PER_UNIT_REACHED, CENTER_HOLD_POINTS_PER_TICK, CENTER_HOLD_REGEN_BONUS } from '../src/data/scoring';
import { CAPTURE_CENTER, INITIAL_ROSTER, COHORT_SIZE } from '../src/data/game';
import { deployZoneFor } from '../src/canvas/constants';
import type { Doctrine, Difficulty, AiCapability } from '../src/data/ai';
import { DIFFICULTIES, AI } from '../src/data/ai';

const RADIUS = 12;
const MAX_TICKS = 2000;
const REVERSE_TICK_ORDER = process.argv.includes('--rev');

// Radius-RADIUS all-GRASSLAND axial disk (the open battlefield), mirroring world-gen's disk shape.
const grid: { hex: Hex; type: string }[] = [];
for (let q = -RADIUS; q <= RADIUS; q++) {
  for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r++) {
    grid.push({ hex: { q, r }, type: 'GRASSLAND' });
  }
}
const keyset = new Set(grid.map(d => HexUtils.key(d.hex)));
const redZone = deployZoneFor('red', grid);
const blueZone = deployZoneFor('blue', grid);
const centerHexes = [CAPTURE_CENTER, ...HexUtils.getNeighbors(CAPTURE_CENTER)];
const centerKeys = new Set(centerHexes.map(HexUtils.key));

const mapApi: MapApi = {
  isInside: (h) => keyset.has(HexUtils.key(h)),
  isWalkable: (h) => keyset.has(HexUtils.key(h)),
  getTerrainType: () => 'GRASSLAND',
  getTerrainMods: () => getTerrainMods('GRASSLAND'),
  getTerrainHeight: () => 10,
  isInDeployZone: (t, h) => (t === 'red' ? redZone : blueZone).has(HexUtils.key(h)),
};

interface Side { doctrine: Doctrine; difficulty: Difficulty; capabilities?: AiCapability[]; reactionTicks?: number; }
interface Result {
  winner: Team | null; score: Score; ticks: number; peak: Record<Team, number>;
  /** Mean standing force over the match (sum of live units each tick / ticks). */
  avgForce: Record<Team, number>;
  /** Mean units sitting in own half (behind the centre line) — the stall proxy. */
  avgStalled: Record<Team, number>;
}

function runMatch(red: Side, blue: Side): Result {
  const ctrl: Record<Team, AiTickFn> = {
    red: makeAiController('red', red.doctrine, red.difficulty, red.capabilities, red.reactionTicks),
    blue: makeAiController('blue', blue.doctrine, blue.difficulty, blue.capabilities, blue.reactionTicks),
  };
  const zone: Record<Team, ReadonlySet<string>> = { red: redZone, blue: blueZone };
  let units: Unit[] = [];
  let cp: CommandPoints = { red: CP_INITIAL, blue: CP_INITIAL };
  const roster: Record<Team, Record<UnitType, number>> = {
    red: { ...INITIAL_ROSTER }, blue: { ...INITIAL_ROSTER },
  };
  const orders = new Map<string, GroupOrder>();
  let score: Score = { red: 0, blue: 0 };
  const peak: Record<Team, number> = { red: 0, blue: 0 };
  const forceSum: Record<Team, number> = { red: 0, blue: 0 };
  const stalledSum: Record<Team, number> = { red: 0, blue: 0 };
  // firstMarch surcharge: a group's first march this battle costs CP_COSTS.firstMarch, not march.
  const marched = new Set<string>();
  const centreY = HexUtils.hexToPixel(CAPTURE_CENTER).y;

  let tick = 0, winner: Team | null = null;
  for (let i = 0; i < MAX_TICKS; i++) {
    tick++;
    // CP regen with the centre-hold bonus (the team uncontestedly on the flag regens faster).
    const onFlag = (t: Team) => units.some(u => u.team === t && u.hp > 0 && centerKeys.has(HexUtils.key(u.tacticalHex)));
    const redFlag = onFlag('red'), blueFlag = onFlag('blue');
    const bonusTeam: Team | null = redFlag && !blueFlag ? 'red' : blueFlag && !redFlag ? 'blue' : null;
    cp = applyRegenLocal(cp, CP_REGEN_PER_TICK_STEP, bonusTeam);

    const tickOrder: Team[] = REVERSE_TICK_ORDER ? ['blue', 'red'] : ['red', 'blue'];
    for (const team of tickOrder) {
      const state: AiTickState = {
        team, tick,
        myUnits: units.filter(u => u.team === team),
        enemyUnits: units.filter(u => u.team !== team),
        myOrders: [...orders.values()].filter(o => o.team === team),
        allOrders: orders,
        gridData: grid,
        cp: cp[team],
        myScore: score[team], enemyScore: score[team === 'red' ? 'blue' : 'red'],
        roster: roster[team], deployZone: zone[team],
        placeCohort: (gid, anchor, unitType) => {
          if (roster[team][unitType] <= 0 || cp[team] < CP_COSTS.placeCohort) return false;
          const occupied = new Set(units.map(u => HexUtils.key(u.tacticalHex)));
          const spots = [anchor, ...HexUtils.getNeighbors(anchor)]
            .filter(h => zone[team].has(HexUtils.key(h)) && !occupied.has(HexUtils.key(h)))
            .slice(0, COHORT_SIZE);
          if (spots.length === 0) return false;
          cp[team] -= CP_COSTS.placeCohort;
          for (const h of spots) {
            if (roster[team][unitType] <= 0) break;
            units.push({ id: `${team[0]}${units.length}`, team, unitType, tacticalHex: h, homeHex: h,
              groupId: gid, hp: MAX_HP_BY_TYPE[unitType], state: 'idle', nextMoveTick: 0, visionRadius: 4 });
            roster[team][unitType]--;
          }
          return true;
        },
        issueOrder: (gid, change, intent) => {
          const k = `${team}:${gid}`;
          // First march of a group pays the firstMarch surcharge instead of march.
          let cost = CP_COSTS[intent];
          if (intent === 'march') { if (!marched.has(k)) cost = CP_COSTS.firstMarch; }
          if (cp[team] < cost) return false;
          cp[team] -= cost;
          if (intent === 'march') marched.add(k);
          orders.set(k, { team, groupId: gid, attackTarget: null, heading: 5, ...orders.get(k), ...change });
          return true;
        },
        clearOrder: (gid) => { orders.delete(`${team}:${gid}`); },
      };
      ctrl[team](state);
    }

    const res = simulateTick(units, orders, { damagePerTick: 10, mapApi, currentTick: tick, captureZone: centerHexes });
    units = res.units;
    for (const team of ['red', 'blue'] as const) {
      const live = units.filter(u => u.team === team && u.hp > 0);
      peak[team] = Math.max(peak[team], live.length);
      forceSum[team] += live.length;
      // "Stalled" = sitting in own half (hasn't advanced past the centre line toward the enemy).
      const sign = team === 'red' ? -1 : 1;
      stalledSum[team] += live.filter(u => sign * (HexUtils.hexToPixel(u.tacticalHex).y - centreY) < 0).length;
    }

    const sc = scoreTick({ units, score, centerKeys,
      scoringZone: { red: blueZone, blue: redZone },   // each team scores by reaching the enemy line
      config: { pointsToWin: POINTS_TO_WIN, pointsPerUnitReached: POINTS_PER_UNIT_REACHED, centerHoldPointsPerTick: CENTER_HOLD_POINTS_PER_TICK } });
    score = sc.score;
    if (sc.reachedUnitIds.size > 0) {
      for (const team of ['red', 'blue'] as const)
        for (const ut of ['infantry', 'cavalry', 'skirmisher'] as const) roster[team][ut] += sc.rosterDelta[team][ut];
    }
    units = units.filter(u => !sc.reachedUnitIds.has(u.id) && u.hp > 0);
    // Prune emptied groups so a recycled slot re-pays firstMarch.
    for (const k of [...marched]) {
      const [t, g] = k.split(':');
      if (!units.some(u => u.team === t && u.groupId === Number(g))) { marched.delete(k); orders.delete(k); }
    }
    if (sc.winner) { winner = sc.winner; break; }
  }
  const avg = (s: Record<Team, number>): Record<Team, number> => ({ red: s.red / tick, blue: s.blue / tick });
  return { winner, score, ticks: tick, peak, avgForce: avg(forceSum), avgStalled: avg(stalledSum) };
}

// Local regen mirroring command-points.applyRegen (importing the real one would pull CP_CAP defaults; we
// keep the centre-hold bonus explicit here so the harness matches useBattleTick's wiring).
function applyRegenLocal(cp: CommandPoints, perTick: number, bonusTeam: Team | null): CommandPoints {
  const grow = (v: number, t: Team) =>
    Math.min(CP_CAP, Math.round((v + perTick * (t === bonusTeam ? 1 + CENTER_HOLD_REGEN_BONUS : 1)) * 100) / 100);
  return { red: grow(cp.red, 'red'), blue: grow(cp.blue, 'blue') };
}

const fmt = (r: Result) =>
  `${r.winner ?? 'DRAW'} wins  red ${r.score.red.toFixed(0)} : ${r.score.blue.toFixed(0)} blue  ` +
  `(${r.ticks} ticks, peak red=${r.peak.red} blue=${r.peak.blue})`;

function bisect(reps: number) {
  // Inject flag-variant difficulties (base = hard: rt10, raid+defend, which is 50/50) and measure
  // PURE SIDE BIAS for each, to isolate which test flag flips red→0%.
  const base = AI.difficulties.hard;
  const variants: Record<string, object> = {
    '+serial':    { serialWaves: true },
    '+fast':      { fastDeploy: true },
    '+horiz':     { horizontalFront: true },
    '+frontlines': { frontLines: true },
    '+ser+horiz': { serialWaves: true, horizontalFront: true },
  };
  for (const [name, flags] of Object.entries(variants)) {
    (AI.difficulties as Record<string, object>)[name] = { ...base, capabilities: [...base.capabilities], ...flags };
  }
  console.log(`\n=== Flag bisection: pure side bias (${reps} reps), base=hard (50/50) ===`);
  for (const name of ['hard', ...Object.keys(variants), 'test']) {
    let red = 0, blue = 0;
    for (let i = 0; i < reps; i++) {
      const w = runMatch({ doctrine: 'balanced', difficulty: name as Difficulty }, { doctrine: 'balanced', difficulty: name as Difficulty }).winner;
      if (w === 'red') red++; else if (w === 'blue') blue++;
    }
    console.log(`  ${name.padEnd(12)}: red ${(100 * red / reps).toFixed(0).padStart(3)}%  blue ${(100 * blue / reps).toFixed(0).padStart(3)}%`);
  }
}

function trace() {
  // One test-vs-test match, instrumented. Replicates runMatch's loop but dumps periodic state so we
  // can see WHY red (0%) and blue (100%) diverge: deployment composition/position, launch timing,
  // who crosses the centre, scores.
  const red: Side = { doctrine: 'balanced', difficulty: 'test' };
  const blue: Side = { doctrine: 'balanced', difficulty: 'test' };
  const ctrl: Record<Team, AiTickFn> = {
    red: makeAiController('red', red.doctrine, red.difficulty),
    blue: makeAiController('blue', blue.doctrine, blue.difficulty),
  };
  const zone: Record<Team, ReadonlySet<string>> = { red: redZone, blue: blueZone };
  let units: Unit[] = [];
  let cp: CommandPoints = { red: CP_INITIAL, blue: CP_INITIAL };
  const roster: Record<Team, Record<UnitType, number>> = { red: { ...INITIAL_ROSTER }, blue: { ...INITIAL_ROSTER } };
  const orders = new Map<string, GroupOrder>();
  let score: Score = { red: 0, blue: 0 };
  const marched = new Set<string>();
  const centreY = HexUtils.hexToPixel(CAPTURE_CENTER).y;
  const sideDepth = (t: Team, u: Unit) => (t === 'red' ? -1 : 1) * (HexUtils.hexToPixel(u.tacticalHex).y - centreY);
  console.log(`centreY=${centreY.toFixed(1)}  redZone=${redZone.size}  blueZone=${blueZone.size}`);

  for (let i = 0; i < MAX_TICKS; i++) {
    const tick = i + 1;
    const onFlag = (t: Team) => units.some(u => u.team === t && u.hp > 0 && centerKeys.has(HexUtils.key(u.tacticalHex)));
    const redFlag = onFlag('red'), blueFlag = onFlag('blue');
    const bonusTeam: Team | null = redFlag && !blueFlag ? 'red' : blueFlag && !redFlag ? 'blue' : null;
    cp = applyRegenLocal(cp, CP_REGEN_PER_TICK_STEP, bonusTeam);
    for (const team of (REVERSE_TICK_ORDER ? ['blue', 'red'] : ['red', 'blue']) as Team[]) {
      const state: AiTickState = {
        team, tick,
        myUnits: units.filter(u => u.team === team),
        enemyUnits: units.filter(u => u.team !== team),
        myOrders: [...orders.values()].filter(o => o.team === team),
        allOrders: orders, gridData: grid, cp: cp[team],
        myScore: score[team], enemyScore: score[team === 'red' ? 'blue' : 'red'],
        roster: roster[team], deployZone: zone[team],
        placeCohort: (gid, anchor, unitType) => {
          if (roster[team][unitType] <= 0 || cp[team] < CP_COSTS.placeCohort) return false;
          const occupied = new Set(units.map(u => HexUtils.key(u.tacticalHex)));
          const spots = [anchor, ...HexUtils.getNeighbors(anchor)]
            .filter(h => zone[team].has(HexUtils.key(h)) && !occupied.has(HexUtils.key(h))).slice(0, COHORT_SIZE);
          if (spots.length === 0) return false;
          cp[team] -= CP_COSTS.placeCohort;
          for (const h of spots) {
            if (roster[team][unitType] <= 0) break;
            units.push({ id: `${team[0]}${units.length}`, team, unitType, tacticalHex: h, homeHex: h,
              groupId: gid, hp: MAX_HP_BY_TYPE[unitType], state: 'idle', nextMoveTick: 0, visionRadius: 4 });
            roster[team][unitType]--;
          }
          return true;
        },
        issueOrder: (gid, change, intent) => {
          const k = `${team}:${gid}`;
          let cost = CP_COSTS[intent];
          if (intent === 'march' && !marched.has(k)) cost = CP_COSTS.firstMarch;
          if (cp[team] < cost) return false;
          cp[team] -= cost;
          if (intent === 'march') marched.add(k);
          orders.set(k, { team, groupId: gid, attackTarget: null, heading: 5, ...orders.get(k), ...change });
          return true;
        },
        clearOrder: (gid) => { orders.delete(`${team}:${gid}`); },
      };
      ctrl[team](state);
    }
    const res = simulateTick(units, orders, { damagePerTick: 10, mapApi, currentTick: tick, captureZone: centerHexes });
    units = res.units;
    const sc = scoreTick({ units, score, centerKeys,
      scoringZone: { red: blueZone, blue: redZone },
      config: { pointsToWin: POINTS_TO_WIN, pointsPerUnitReached: POINTS_PER_UNIT_REACHED, centerHoldPointsPerTick: CENTER_HOLD_POINTS_PER_TICK } });
    score = sc.score;
    if (sc.reachedUnitIds.size > 0)
      for (const team of ['red', 'blue'] as const)
        for (const ut of ['infantry', 'cavalry', 'skirmisher'] as const) roster[team][ut] += sc.rosterDelta[team][ut];
    units = units.filter(u => !sc.reachedUnitIds.has(u.id) && u.hp > 0);
    for (const k of [...marched]) {
      const [t, g] = k.split(':');
      if (!units.some(u => u.team === t && u.groupId === Number(g))) { marched.delete(k); orders.delete(k); }
    }

    if (tick <= 80 && tick % 8 === 0) {
      const line = (team: Team) => {
        const us = units.filter(u => u.team === team && u.hp > 0);
        const d = us.map(u => sideDepth(team, u));
        const ord = [1, 2, 3, 4].map(g => orders.get(`${team}:${g}`)?.mode?.[0] ?? '·').join('');
        const maxFwd = d.length ? Math.max(...d).toFixed(0) : '—';
        return `n=${us.length.toString().padStart(3)} frontDepth=${maxFwd.padStart(5)} ord=${ord}`;
      };
      console.log(`t${tick.toString().padStart(3)}: red[${line('red')}] blue[${line('blue')}]`);
    }
    if (tick === 25 || tick === 60) {
      console.log(`\n--- tick ${tick}: deployment snapshot ---`);
      for (const team of ['red', 'blue'] as const) {
        const us = units.filter(u => u.team === team && u.hp > 0);
        const byType = (t: UnitType) => us.filter(u => u.unitType === t).length;
        const byGroup = [1, 2, 3, 4].map(g => us.filter(u => u.groupId === g).length);
        const depths = us.map(u => sideDepth(team, u));
        const lats = us.map(u => HexUtils.hexToPixel(u.tacticalHex).x);
        const avg = (a: number[]) => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(0) : '—';
        const ord = [1, 2, 3, 4].map(g => orders.get(`${team}:${g}`)?.mode?.[0] ?? '·').join('');
        console.log(`  ${team}: n=${us.length} inf=${byType('infantry')} cav=${byType('cavalry')} skr=${byType('skirmisher')}  groups=[${byGroup}]  avgDepth=${avg(depths)} latSpread=${lats.length ? (Math.max(...lats) - Math.min(...lats)).toFixed(0) : '—'}  orders=${ord} cp=${cp[team].toFixed(0)}`);
      }
    }
    if (tick % 200 === 0 || sc.winner) {
      const stat = (team: Team) => {
        const us = units.filter(u => u.team === team && u.hp > 0);
        const past = us.filter(u => sideDepth(team, u) > 0).length;
        return `n=${us.length} pastCentre=${past}`;
      };
      console.log(`t${tick}: score ${score.red.toFixed(0)}:${score.blue.toFixed(0)}  red[${stat('red')}] blue[${stat('blue')}]  cp ${cp.red.toFixed(0)}:${cp.blue.toFixed(0)}`);
    }
    if (sc.winner) { console.log(`\nWINNER: ${sc.winner} at tick ${tick}`); break; }
  }
}

function study(reps: number) {
  const diffs: Difficulty[] = DIFFICULTIES;
  const win = (rd: Difficulty, bd: Difficulty) => {
    let red = 0, blue = 0, draw = 0;
    for (let i = 0; i < reps; i++) {
      const w = runMatch({ doctrine: 'balanced', difficulty: rd }, { doctrine: 'balanced', difficulty: bd }).winner;
      if (w === 'red') red++; else if (w === 'blue') blue++; else draw++;
    }
    return { red, blue, draw };
  };

  console.log(`\n=== Pure side bias (same difficulty both sides, ${reps} reps each) ===`);
  console.log('red win-rate should be ~50% if neither side is favoured:');
  for (const d of diffs) {
    const w = win(d, d);
    console.log(`  ${d.padEnd(6)}: red ${(100 * w.red / reps).toFixed(0)}%  blue ${(100 * w.blue / reps).toFixed(0)}%  draw ${(100 * w.draw / reps).toFixed(0)}%`);
  }

  console.log(`\n=== Win-rate matrix, side-bias-cancelled (each pair run BOTH ways, ${reps} reps each side) ===`);
  console.log('cell = ROW difficulty\'s win% vs COLUMN difficulty:');
  console.log('         ' + diffs.map(d => d.padStart(7)).join(''));
  for (const a of diffs) {
    const cells = diffs.map(b => {
      if (a === b) return '   —   ';
      const ra = win(a, b);   // a as red
      const rb = win(b, a);   // a as blue
      return `${(100 * (ra.red + rb.blue) / (2 * reps)).toFixed(0)}%`.padStart(7);
    });
    console.log(`  ${a.padEnd(7)}` + cells.join(''));
  }
}

function mechanism(reps: number) {
  // For each difficulty D (vs a fixed `normal` opponent, run BOTH sides so side bias cancels):
  // what does D field, how much of it stalls in its own half, and how fast does it score?
  const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
  const opp: Side = { doctrine: 'balanced', difficulty: 'normal' };
  console.log(`\n=== Stall mechanism: difficulty D vs fixed normal opponent (${reps} reps/side) ===`);
  console.log('If "bigger blob stalls" holds: hard fields the MOST units, stalls the MOST, scores SLOWEST, wins LEAST.\n');
  console.log('  D        avgForce  stalled%   VP/1000t   winrate');
  for (const d of diffs) {
    const me: Side = { doctrine: 'balanced', difficulty: d };
    let force = 0, stalled = 0, vpRate = 0, wins = 0, n = 0;
    const tally = (r: Result, side: Team) => {
      force += r.avgForce[side];
      stalled += r.avgStalled[side];
      vpRate += r.score[side] / r.ticks * 1000;
      if (r.winner === side) wins++;
      n++;
    };
    for (let i = 0; i < reps; i++) { tally(runMatch(me, opp), 'red'); tally(runMatch(opp, me), 'blue'); }
    const stallPct = 100 * stalled / force;
    console.log(`  ${d.padEnd(8)} ${(force / n).toFixed(1).padStart(7)}   ${stallPct.toFixed(0).padStart(6)}%   ${(vpRate / n).toFixed(1).padStart(7)}   ${(100 * wins / n).toFixed(0).padStart(5)}%`);
  }
}

function ablate(reps: number) {
  // Isolate each capability's MARGINAL effect. Both sides held at difficulty `normal` (same force /
  // reaction / spend) so only the capability set differs. baseline = [] (pure centre-rush + hold).
  // For each capability C: baseline vs baseline+[C], run BOTH sides, report C's win-rate.
  //   > 50% → C helps;  < 50% → C is anti-skill;  ~50% → neutral.
  const caps: AiCapability[] = ['focusFire', 'charge', 'unleash', 'raid', 'defend', 'repel', 'earlyLaunch'];
  const base: Side = { doctrine: 'balanced', difficulty: 'normal', capabilities: [] };
  const winrate = (test: Side) => {
    let wins = 0, draws = 0, n = 0;
    for (let i = 0; i < reps; i++) {
      const a = runMatch({ ...test }, base).winner;          // test as red
      if (a === 'red') wins++; else if (a == null) draws++; n++;
      const b = runMatch(base, { ...test }).winner;          // test as blue
      if (b === 'blue') wins++; else if (b == null) draws++; n++;
    }
    return { pct: 100 * wins / n, draws: 100 * draws / n };
  };
  console.log(`\n=== Capability ablation vs centre-rush baseline (difficulty=normal, ${reps} reps/side) ===`);
  console.log('win% > 50 ⇒ the capability HELPS; < 50 ⇒ it HURTS the simple rush:\n');
  console.log('  capability    win%   draw%');
  for (const c of caps) {
    const w = winrate({ doctrine: 'balanced', difficulty: 'normal', capabilities: [c] });
    console.log(`  ${c.padEnd(12)} ${w.pct.toFixed(0).padStart(4)}%  ${w.draws.toFixed(0).padStart(4)}%`);
  }
  const full = winrate({ doctrine: 'balanced', difficulty: 'normal', capabilities: caps });
  console.log(`  ${'ALL'.padEnd(12)} ${full.pct.toFixed(0).padStart(4)}%  ${full.draws.toFixed(0).padStart(4)}%   (full repertoire)`);
}

function tune(reps: number) {
  // Tune the `test` personality: pit candidate (base difficulty for react/CP + capability set)
  // configs against the camp-bot `hard` ([], react 2). Win% > 50 ⇒ beats the camper.
  const opp: Side = { doctrine: 'balanced', difficulty: 'hard' };   // pure centre-camp
  const candidates: { label: string; side: Side }[] = [
    { label: 'hard mirror []',        side: { doctrine: 'balanced', difficulty: 'hard', capabilities: [] } },
    { label: 'defend',                side: { doctrine: 'balanced', difficulty: 'hard', capabilities: ['defend'] } },
    { label: 'raid',                  side: { doctrine: 'balanced', difficulty: 'hard', capabilities: ['raid'] } },
    { label: 'raid+defend (test)',    side: { doctrine: 'balanced', difficulty: 'hard', capabilities: ['raid', 'defend'] } },
    { label: 'defend+earlyLaunch',    side: { doctrine: 'balanced', difficulty: 'hard', capabilities: ['defend', 'earlyLaunch'] } },
    { label: 'raid+defend @react6',   side: { doctrine: 'balanced', difficulty: 'normal', capabilities: ['raid', 'defend'] } },
    { label: 'defend @react6',        side: { doctrine: 'balanced', difficulty: 'normal', capabilities: ['defend'] } },
  ];
  const winrate = (side: Side) => {
    let wins = 0, draws = 0, n = 0;
    for (let i = 0; i < reps; i++) {
      const a = runMatch({ ...side }, opp).winner; if (a === 'red') wins++; else if (a == null) draws++; n++;
      const b = runMatch(opp, { ...side }).winner; if (b === 'blue') wins++; else if (b == null) draws++; n++;
    }
    return { pct: 100 * wins / n, draws: 100 * draws / n };
  };
  console.log(`\n=== Tune 'test' vs camp-bot hard ([], react 2) — ${reps} reps/side ===`);
  console.log('win% > 50 ⇒ the candidate beats the pure centre-camper:\n');
  console.log('  candidate                win%   draw%');
  for (const c of candidates) {
    const w = winrate(c.side);
    console.log(`  ${c.label.padEnd(22)} ${w.pct.toFixed(0).padStart(4)}%  ${w.draws.toFixed(0).padStart(4)}%`);
  }
}

function sweep(reps: number) {
  // Sweep reactionTicks for the centre-fight + flank capability combos, vs camp-bot hard.
  const opp: Side = { doctrine: 'balanced', difficulty: 'hard' };
  const combos: { label: string; caps: AiCapability[] }[] = [
    { label: 'defend', caps: ['defend'] },
    { label: 'raid', caps: ['raid'] },
    { label: 'raid+defend', caps: ['raid', 'defend'] },
  ];
  const reactions = [2, 4, 6, 8, 10, 14];
  const winrate = (caps: AiCapability[], rt: number) => {
    let wins = 0, n = 0;
    const side: Side = { doctrine: 'balanced', difficulty: 'hard', capabilities: caps, reactionTicks: rt };
    for (let i = 0; i < reps; i++) {
      if (runMatch({ ...side }, opp).winner === 'red') wins++; n++;
      if (runMatch(opp, { ...side }).winner === 'blue') wins++; n++;
    }
    return 100 * wins / n;
  };
  console.log(`\n=== reactionTicks sweep vs camp-bot hard — ${reps} reps/side (win% > 50 beats the camper) ===`);
  console.log('  combo          ' + reactions.map(r => `rt${r}`.padStart(6)).join(''));
  for (const c of combos) {
    const cells = reactions.map(rt => `${winrate(c.caps, rt).toFixed(0)}%`.padStart(6));
    console.log(`  ${c.label.padEnd(14)}` + cells.join(''));
  }
}

if (process.argv.includes('--bisect')) {
  const repArg = process.argv.find(a => /^\d+$/.test(a));
  bisect(repArg ? Number(repArg) : 20);
} else if (process.argv.includes('--trace')) {
  trace();
} else if (process.argv.includes('--sweep')) {
  const repArg = process.argv.find(a => /^\d+$/.test(a));
  sweep(repArg ? Number(repArg) : 24);
} else if (process.argv.includes('--tune')) {
  const repArg = process.argv.find(a => /^\d+$/.test(a));
  tune(repArg ? Number(repArg) : 24);
} else if (process.argv.includes('--ablate')) {
  const repArg = process.argv.find(a => /^\d+$/.test(a));
  ablate(repArg ? Number(repArg) : 20);
} else if (process.argv.includes('--mech')) {
  const repArg = process.argv.find(a => /^\d+$/.test(a));
  mechanism(repArg ? Number(repArg) : 16);
} else if (process.argv.includes('--study')) {
  const repArg = process.argv.find(a => /^\d+$/.test(a));
  study(repArg ? Number(repArg) : 20);
} else if (process.argv.includes('--grid')) {
  // Round-robin over difficulties (balanced doctrine both sides), single samples (noisy).
  const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
  console.log('Difficulty round-robin (balanced doctrine, red vs blue) — SINGLE samples, RNG-noisy:');
  for (const rd of diffs) for (const bd of diffs) {
    const r = runMatch({ doctrine: 'balanced', difficulty: rd }, { doctrine: 'balanced', difficulty: bd });
    console.log(`  red:${rd.padEnd(6)} vs blue:${bd.padEnd(6)} → ${fmt(r)}`);
  }
} else {
  console.log('Single match — red:aggressive/hard vs blue:balanced/hard');
  console.log('  ' + fmt(runMatch({ doctrine: 'aggressive', difficulty: 'hard' }, { doctrine: 'balanced', difficulty: 'hard' })));
}
