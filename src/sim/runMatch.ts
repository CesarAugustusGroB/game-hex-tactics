import { simulateTick } from '../battle/simulate';
import type { Unit, GroupOrder, Team, UnitType, MapApi } from '../battle/simulate';
import { getTerrainMods } from '../battle/terrain';
import { scoreTick, type Score } from '../battle/scoring';
import { makeAiControllerProfile } from '../battle/ai/controller';
import type { AiTickFn, AiTickState } from '../battle/ai';
import { CP_CAP, CP_INITIAL, CP_REGEN_PER_TICK_STEP, CP_COSTS, type CommandPoints } from '../battle/command-points';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { MAX_HP_BY_TYPE } from '../data/units';
import { POINTS_TO_WIN, POINTS_PER_UNIT_REACHED, CENTER_HOLD_POINTS_PER_TICK, CENTER_HOLD_REGEN_BONUS } from '../data/scoring';
import { CAPTURE_CENTER, INITIAL_ROSTER, COHORT_SIZE } from '../data/game';
import { deployZoneFor } from '../canvas/constants';
import type { TeamAiProfile } from '../data/ai-profile';

const RADIUS = 12;
export const MAX_TICKS = 2000;

// Radius-12 all-GRASSLAND axial disk (the open battlefield), mirroring world-gen's disk shape.
export const grid: { hex: Hex; type: string }[] = [];
for (let q = -RADIUS; q <= RADIUS; q++) {
  for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r++) {
    grid.push({ hex: { q, r }, type: 'GRASSLAND' });
  }
}
export const keyset = new Set(grid.map(d => HexUtils.key(d.hex)));
export const redZone = deployZoneFor('red', grid);
export const blueZone = deployZoneFor('blue', grid);
export const centerHexes = [CAPTURE_CENTER, ...HexUtils.getNeighbors(CAPTURE_CENTER)];
export const centerKeys = new Set(centerHexes.map(HexUtils.key));

export const mapApi: MapApi = {
  isInside: (h) => keyset.has(HexUtils.key(h)),
  isWalkable: (h) => keyset.has(HexUtils.key(h)),
  getTerrainType: () => 'GRASSLAND',
  getTerrainMods: () => getTerrainMods('GRASSLAND'),
  getTerrainHeight: () => 10,
  isInDeployZone: (t, h) => (t === 'red' ? redZone : blueZone).has(HexUtils.key(h)),
};

export interface Result {
  winner: Team | null; score: Score; ticks: number; peak: Record<Team, number>;
  /** Mean standing force over the match (sum of live units each tick / ticks). */
  avgForce: Record<Team, number>;
  /** Mean units sitting in own half (behind the centre line) — the stall proxy. */
  avgStalled: Record<Team, number>;
}

export function runMatch(red: TeamAiProfile, blue: TeamAiProfile, opts: { reverse?: boolean } = {}): Result {
  const ctrl: Record<Team, AiTickFn> = {
    red: makeAiControllerProfile('red', red),
    blue: makeAiControllerProfile('blue', blue),
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

    const tickOrder: Team[] = opts.reverse ? ['blue', 'red'] : ['red', 'blue'];
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
export function applyRegenLocal(cp: CommandPoints, perTick: number, bonusTeam: Team | null): CommandPoints {
  const grow = (v: number, t: Team) =>
    Math.min(CP_CAP, Math.round((v + perTick * (t === bonusTeam ? 1 + CENTER_HOLD_REGEN_BONUS : 1)) * 100) / 100);
  return { red: grow(cp.red, 'red'), blue: grow(cp.blue, 'blue') };
}

export interface SimResult {
  reps: number;
  redWins: number; blueWins: number; draws: number;
  avgScoreRed: number; avgScoreBlue: number; avgTicks: number;
}

/** Run `reps` matches of red vs blue and aggregate win counts + average score/length. */
export function runSeries(red: TeamAiProfile, blue: TeamAiProfile, reps: number, opts: { reverse?: boolean } = {}): SimResult {
  let redWins = 0, blueWins = 0, draws = 0, sr = 0, sb = 0, st = 0;
  for (let i = 0; i < reps; i++) {
    const r = runMatch(red, blue, opts);
    if (r.winner === 'red') redWins++; else if (r.winner === 'blue') blueWins++; else draws++;
    sr += r.score.red; sb += r.score.blue; st += r.ticks;
  }
  const n = Math.max(1, reps);
  return { reps, redWins, blueWins, draws, avgScoreRed: sr / n, avgScoreBlue: sb / n, avgTicks: st / n };
}
