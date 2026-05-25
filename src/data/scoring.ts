import raw from './scoring.json';
import { TICK_MS } from './game';

export interface ScoringConfig {
  pointsToWin: number;
  pointsPerUnitReached: number;
  centerHoldPointsPerSecond: number;
}

export const SCORING: ScoringConfig = raw as ScoringConfig;

export const POINTS_TO_WIN = SCORING.pointsToWin;
export const POINTS_PER_UNIT_REACHED = SCORING.pointsPerUnitReached;
// design value is per-second; convert to per-tick
export const CENTER_HOLD_POINTS_PER_TICK = (SCORING.centerHoldPointsPerSecond * TICK_MS) / 1000;
