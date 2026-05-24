import type { Team } from './simulate';

export const CP_CAP = 20;
export const CP_REGEN_PER_N_TICKS = 4;
export const CP_INITIAL = CP_CAP;

export const CP_COSTS = {
  assign: 0,
  idle: 0,
  meta: 0,
  debug: 0,
  cycleHeading: 1,
  cycleFormation: 1,
  march: 2,
  placeCohort: 2,
  orderDrag: 3,
  hold: 4,
  retreat: 4,
  charge: 6,
  unleash: 6,
} as const;

export type CpIntent = keyof typeof CP_COSTS;

export type CommandPoints = Record<Team, number>;

export function makeInitialCommandPoints(): CommandPoints {
  return { red: CP_INITIAL, blue: CP_INITIAL };
}

export function canAfford(cp: CommandPoints, team: Team, intent: CpIntent): boolean {
  return cp[team] >= CP_COSTS[intent];
}

/** Returns a new CommandPoints with `team` debited by `CP_COSTS[intent]`, or null
 *  if the team can't afford it. Never mutates the input. */
export function debit(cp: CommandPoints, team: Team, intent: CpIntent): CommandPoints | null {
  const cost = CP_COSTS[intent];
  if (cp[team] < cost) return null;
  return { ...cp, [team]: cp[team] - cost };
}

/** Returns new CommandPoints with both teams incremented by 1 (clamped to CP_CAP)
 *  if `tick % CP_REGEN_PER_N_TICKS === 0`. Otherwise returns the input unchanged. */
export function applyRegen(cp: CommandPoints, tick: number): CommandPoints {
  if (tick % CP_REGEN_PER_N_TICKS !== 0) return cp;
  const r = Math.min(CP_CAP, cp.red + 1);
  const b = Math.min(CP_CAP, cp.blue + 1);
  if (r === cp.red && b === cp.blue) return cp;
  return { red: r, blue: b };
}
