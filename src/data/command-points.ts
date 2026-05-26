import raw from './command-points.json';

export interface CommandPointsConfig {
  cap: number;
  initial: number;
  // One CP is regained every this many ticks (the gain rate).
  regenPerNTicks: number;
}

export const COMMAND_POINTS: CommandPointsConfig = raw as CommandPointsConfig;

export const CP_CAP = COMMAND_POINTS.cap;
export const CP_INITIAL = COMMAND_POINTS.initial;
export const CP_REGEN_PER_N_TICKS = COMMAND_POINTS.regenPerNTicks;
