import type { Team } from './simulate';
import { CP_CAP, CP_INITIAL, CP_REGEN_N, CP_REGEN_PER_TICK_STEP } from '../data/command-points';

// Economy (cap / initial / regen) is tunable via src/data/command-points.json.
// Re-exported so existing consumers keep importing it from '../battle/command-points'.
export { CP_CAP, CP_INITIAL, CP_REGEN_N, CP_REGEN_PER_TICK_STEP };

export const CP_COSTS = {
  idle: 0,
  meta: 0,
  debug: 0,
  cycleHeading: 1,
  cycleFormation: 1,
  march: 2,
  // First march of a group this battle costs double — discourages splitting the army
  // into many small groups to drip-feed units to the enemy line for points.
  firstMarch: 4,
  placeCohort: 2,
  orderDrag: 3,
  hold: 4,
  // Orderly pull-back of a disengaged group (sim 'retreat' mode walks it home). Cheap so
  // disengaging is preferable to feeding units into the line.
  retreat: 2,
  // Abandon a melee-locked group off the field for a partial roster refund — the only exit
  // for an engaged (incl. unleashed/committed) group. Costs more than an orderly retreat.
  banish: 4,
  charge: 6,
  unleash: 6,
} as const;

export type CpIntent = keyof typeof CP_COSTS;

export type CommandPoints = Record<Team, number>;

export function makeInitialCommandPoints(initial: number = CP_INITIAL): CommandPoints {
  return { red: initial, blue: initial };
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

/** Returns new CommandPoints with both teams gaining `amountPerTick` CP, clamped to `cap`.
 *  Called every tick; CP accrues fractionally (rounded to 0.01 to avoid float drift).
 *  Returns the input unchanged when nothing moves. */
export function applyRegen(cp: CommandPoints, amountPerTick: number, cap: number = CP_CAP): CommandPoints {
  if (amountPerTick <= 0) return cp;
  const grow = (v: number) => Math.min(cap, Math.round((v + amountPerTick) * 100) / 100);
  const r = grow(cp.red);
  const b = grow(cp.blue);
  if (r === cp.red && b === cp.blue) return cp;
  return { red: r, blue: b };
}
