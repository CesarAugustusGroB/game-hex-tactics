import raw from './command-points.json';

export interface CommandPointsConfig {
  cap: number;
  initial: number;
  // Regen knob: each tick a team gains CP_REGEN_PER_TICK_STEP * regenN CP.
  regenN: number;
}

export const COMMAND_POINTS: CommandPointsConfig = raw as CommandPointsConfig;

export const CP_CAP = COMMAND_POINTS.cap;
export const CP_INITIAL = COMMAND_POINTS.initial;
export const CP_REGEN_N = COMMAND_POINTS.regenN;
// Per-tick CP gain = CP_REGEN_PER_TICK_STEP * regenN (so the regen field is a direct
// multiplier: higher = faster). CP accrues fractionally between whole points.
export const CP_REGEN_PER_TICK_STEP = 0.1;
