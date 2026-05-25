import type { Unit, Team, UnitType } from './simulate';
import { HexUtils } from '../hex-engine/HexUtils';

export type Score = Record<Team, number>;
export type RosterDelta = Record<Team, Record<UnitType, number>>;

export interface ScoreConfig {
  pointsToWin: number;
  pointsPerUnitReached: number;
  centerHoldPointsPerTick: number;
}

export interface ScoreTickInput {
  /** Units after simulateTick (may include hp <= 0 corpses). */
  units: Unit[];
  /** Current victory-point totals. */
  score: Score;
  /** Hex keys of the central flower (centre + 6 neighbours). */
  centerKeys: Set<string>;
  /** For each team, the hex keys that team scores by entering (the ENEMY back line). */
  scoringZone: Record<Team, Set<string>>;
  config: ScoreConfig;
}

export interface ScoreTickResult {
  /** New score totals (never below the input — points only accumulate). */
  score: Score;
  /** Per-team, per-type roster refund for units that reached the enemy line. */
  rosterDelta: RosterDelta;
  /** Ids of units that reached the enemy line and must leave the field. */
  reachedUnitIds: Set<string>;
  /** Team that hit `pointsToWin` this tick, or null. */
  winner: Team | null;
  /** True if either team's score changed. */
  changed: boolean;
}

const TEAMS: readonly Team[] = ['red', 'blue'];

/**
 * One tick of victory-point scoring. Pure: no React/PIXI/I/O.
 *  - Territory reach: a living unit standing in its `scoringZone` (the enemy deploy zone)
 *    scores `pointsPerUnitReached`, refunds 1 of its type to its roster, and is marked for
 *    removal from the field (raid & return).
 *  - Centre hold: uncontested living presence in `centerKeys` accrues `centerHoldPointsPerTick`.
 *    Contested or empty centre scores nobody. Points never decay.
 */
export function scoreTick(input: ScoreTickInput): ScoreTickResult {
  const { units, score, centerKeys, scoringZone, config } = input;
  const next: Score = { red: score.red, blue: score.blue };
  const rosterDelta: RosterDelta = {
    red:  { infantry: 0, cavalry: 0, skirmisher: 0 },
    blue: { infantry: 0, cavalry: 0, skirmisher: 0 },
  };
  const reachedUnitIds = new Set<string>();

  // Territory reach.
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (!scoringZone[u.team].has(HexUtils.key(u.tacticalHex))) continue;
    reachedUnitIds.add(u.id);
    next[u.team] += config.pointsPerUnitReached;
    rosterDelta[u.team][u.unitType ?? 'infantry'] += 1;
  }

  // Centre hold. A unit reaching the enemy line can't also sit in the centre, so the two
  // passes don't double-count.
  let redCenter = 0, blueCenter = 0;
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (!centerKeys.has(HexUtils.key(u.tacticalHex))) continue;
    if (u.team === 'red') redCenter++; else blueCenter++;
  }
  if (redCenter > 0 && blueCenter === 0) next.red += config.centerHoldPointsPerTick;
  else if (blueCenter > 0 && redCenter === 0) next.blue += config.centerHoldPointsPerTick;

  let winner: Team | null = null;
  for (const t of TEAMS) {
    if (next[t] >= config.pointsToWin) { winner = t; break; }
  }

  const changed = next.red !== score.red || next.blue !== score.blue;
  return { score: next, rosterDelta, reachedUnitIds, winner, changed };
}
