/**
 * AI controller registry. A controller is a function called once per tick (before the
 * sim runs) for each team that has one registered. It reads a team-scoped snapshot of
 * the battle and may issue/clear orders for groups on its own team.
 *
 * Lives outside the sim (`simulate.ts` stays pure) and outside `GameCanvas.tsx` (which
 * stays focused on render/input). The tick loop in `GameCanvas` polls `getAiController`
 * each tick; AI implementations call `registerAiController` to install themselves.
 *
 * `issueOrder` mutates the orders ref synchronously, so the very next `simulateTick`
 * call in the same loop iteration sees the AI's new orders — no one-tick delay.
 */

import type { Hex } from '../hex-engine/HexUtils';
import type { GroupOrder, Team, GroupId, Unit, UnitType } from './simulate';
import { type CpIntent } from './command-points';

/** What an AI may change on an existing order. Team/groupId identify the order and
 *  can't be re-targeted, so they're excluded. */
export type OrderChange = Omit<Partial<GroupOrder>, 'team' | 'groupId'>;

export interface AiTickState {
  team: Team;
  /** The tick number that's about to be simulated (post-increment). */
  tick: number;
  myUnits: Unit[];
  enemyUnits: Unit[];
  myOrders: GroupOrder[];
  /** Read-only view across both teams — useful for reasoning about enemy intent. */
  allOrders: ReadonlyMap<string, GroupOrder>;
  gridData: ReadonlyArray<{ hex: Hex; type: string }>;
  /** Snapshot of the team's CP at the start of the tick (read-only). */
  cp: number;
  /** Victory points, this team's and the enemy's, as of the previous tick (scoring runs after
   *  the AI phase). Optional: omitted by headless harnesses → treated as 0/0, i.e. no danger
   *  signal. Drives the counterattack threshold (more deficit → launch with fewer units). */
  myScore?: number;
  enemyScore?: number;
  /** Undeployed units left in this team's roster, by type. */
  roster: Readonly<Record<UnitType, number>>;
  /** Hex keys of this team's deploy zone (host-computed via deployZoneFor). */
  deployZone: ReadonlySet<string>;
  /** Paint a cohort: place up to COHORT_SIZE units from `anchorHex` + neighbours into the
   *  given group, debiting `placeCohort` CP and decrementing the roster. Returns true if at
   *  least one unit was placed. No-op (false) if the anchor's footprint is fully occupied,
   *  off-zone, roster-empty, or CP can't cover it. */
  placeCohort: (groupId: GroupId, anchorHex: Hex, unitType: UnitType) => boolean;
  /** Bound to this controller's team. Group must belong to the same team. Returns
   *  true if the order was issued, false if rejected for lack of CP. */
  issueOrder: (groupId: GroupId, change: OrderChange, intent: CpIntent) => boolean;
  clearOrder: (groupId: GroupId) => void;
}

export type AiTickFn = (state: AiTickState) => void;

const controllers: Partial<Record<Team, AiTickFn>> = {};

/** Install (or remove with `null`) an AI controller for a team. Idempotent. */
export function registerAiController(team: Team, fn: AiTickFn | null): void {
  if (fn) controllers[team] = fn;
  else delete controllers[team];
}

/** Internal — called by the tick loop. Returns the controller for a team if any. */
export function getAiController(team: Team): AiTickFn | undefined {
  return controllers[team];
}
