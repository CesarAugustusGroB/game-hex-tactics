import raw from './game.json';
import type { Team, UnitType, FormationType } from '../battle/simulate';
import type { Hex } from '../hex-engine/HexUtils';

const hexStr = (c: string): number => parseInt(c.slice(1), 16);

export interface GameConfig {
  tickMs: number;
  lodThreshold: number;
  dragThresholdPx: number;
  deployZoneFrac: number;
  retreatRefundFrac: number;
  initialRoster: Record<UnitType, number>;
  cohortSize: number;
  capture: { center: Hex };
  teams: Record<Team, { tint: string }>;
  formations: { cycle: FormationType[]; labels: Record<FormationType, string> };
  headingArrows: Record<string, string>;
}

export const GAME: GameConfig = raw as GameConfig;

// Legacy-shape exports
export const TICK_MS              = GAME.tickMs;
export const LOD_THRESHOLD        = GAME.lodThreshold;
export const DRAG_THRESHOLD_PX    = GAME.dragThresholdPx;
export const DEPLOY_ZONE_FRAC     = GAME.deployZoneFrac;
export const RETREAT_REFUND_FRAC  = GAME.retreatRefundFrac;
export const INITIAL_ROSTER       = GAME.initialRoster;
export const COHORT_SIZE          = GAME.cohortSize;
export const CAPTURE_CENTER       = GAME.capture.center;
export const FORMATION_CYCLE      = GAME.formations.cycle;
export const FORMATION_LABELS     = GAME.formations.labels;

export const TEAM_TINTS: Record<Team, number> = Object.fromEntries(
  Object.entries(GAME.teams).map(([team, v]) => [team, hexStr(v.tint)]),
) as Record<Team, number>;

// Re-key the heading arrows from string-keyed (JSON) to number-keyed (consumer-facing).
export const HEADING_ARROWS: Record<number, string> = Object.fromEntries(
  Object.entries(GAME.headingArrows).map(([k, v]) => [Number(k), v]),
);
