import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import type { Unit, UnitType, Team, GroupId, GroupOrder, FormationType } from '../battle/simulate';
import {
  HEADING_ARROWS,
  INITIAL_ROSTER,
  COHORT_SIZE,
  RETREAT_REFUND_FRAC,
  CAPTURE_CENTER,
  FORMATION_CYCLE,
  FORMATION_LABELS,
  TEAM_TINTS,
  TICK_MS,
  LOD_THRESHOLD,
  DRAG_THRESHOLD_PX,
  DEPLOY_ZONE_FRAC,
} from '../data/game';
import {
  POINTS_TO_WIN,
  POINTS_PER_UNIT_REACHED,
  CENTER_HOLD_POINTS_PER_TICK,
} from '../data/scoring';

// Re-export under their legacy paths so existing consumers (HUD, render, input handlers,
// GameCanvas composition root) don't need to migrate import paths. Values live in
// src/data/game.json; this file owns only the canvas-side derived helpers (factories,
// deploy-zone computation, key formatters).
export {
  HEADING_ARROWS,
  INITIAL_ROSTER,
  COHORT_SIZE,
  // RETREAT refund fraction: the banish path (engaged retreat) vanishes the group from the
  // field and refunds this fraction of each unit type to the team's roster. A disengaged
  // retreat instead pulls the group back to the deploy zone via the sim (no refund).
  RETREAT_REFUND_FRAC,
  CAPTURE_CENTER,
  FORMATION_CYCLE,
  FORMATION_LABELS,
  TEAM_TINTS,
  TICK_MS,
  // Below this world.scale, swap each unit's soldier sprite for a stylized strategic
  // marker (filled team-tinted hex top). At far zoom individual soldier features are
  // unreadable anyway, and a clean colored token reads like an army-position marker
  // instead of a smear of tiny pixelated sprites.
  LOD_THRESHOLD,
  DRAG_THRESHOLD_PX,
  POINTS_TO_WIN,
  POINTS_PER_UNIT_REACHED,
  CENTER_HOLD_POINTS_PER_TICK,
};

export { STRATEGIC_RESOLUTION, DIVE_ZOOM } from '../data/world-gen';

export type InputMode = 'place' | 'order';

export const GROUP_IDS: readonly GroupId[] = [1, 2, 3, 4];

export type Armies = Map<string, Unit[]>;
export type GroupOrders = Map<string, GroupOrder>;
export type GroupFormations = Map<string, FormationType>;
export type GroupDepths = Map<string, number>;

// Per-team pool of unspent units, decremented by `deployCohort`. Reset on regenerate
// and return-to-strategic.
export type Roster = Record<UnitType, number>;
export type Rosters = Map<Team, Roster>;

export const captureZoneKeys = (): Set<string> => {
  const z = new Set<string>([HexUtils.key(CAPTURE_CENTER)]);
  for (const n of HexUtils.getNeighbors(CAPTURE_CENTER)) z.add(HexUtils.key(n));
  return z;
};
export const CAPTURE_ZONE_HEXES: ReadonlyArray<Hex> = [CAPTURE_CENTER, ...HexUtils.getNeighbors(CAPTURE_CENTER)];

export const makeInitialRosters = (): Rosters =>
  new Map<Team, Roster>([
    ['red', { ...INITIAL_ROSTER }],
    ['blue', { ...INITIAL_ROSTER }],
  ]);

export { DAMAGE_PER_TICK } from '../data/combat';

export const groupOrderKey = (team: Team, groupId: GroupId): string => `${team}:${groupId}`;

// 0.28 ≈ bottom 28% strip of the visible map. Computed in pixel-y (not axial-r) so
// the strips read as HORIZONTAL — flat-top axial-r rows are slanted diagonally.
/** Hex keys belonging to a team's deployment zone, derived from the screen-y extent of
 *  `gridData`. Red gets the bottom strip, blue the top. */
export const deployZoneFor = (team: Team, gridData: { hex: Hex; type: string }[]): Set<string> => {
  const zone = new Set<string>();
  if (gridData.length === 0) return zone;
  let minY = Infinity, maxY = -Infinity;
  for (const d of gridData) {
    const py = HexUtils.hexToPixel(d.hex).y;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const depthPx = (maxY - minY) * DEPLOY_ZONE_FRAC;
  const threshold = team === 'red' ? maxY - depthPx : minY + depthPx;
  for (const d of gridData) {
    const py = HexUtils.hexToPixel(d.hex).y;
    if (team === 'red' ? py >= threshold : py <= threshold) zone.add(HexUtils.key(d.hex));
  }
  return zone;
};

/** A group is "sealed" (locked from receiving new units) while it's committed on the
 *  field: it has living units AND either an active advance order (attackTarget set, not
 *  idle/hold) or at least one unit standing outside its deploy zone. Empty groups, and
 *  groups fully back inside their deploy zone (the sim blanks the order on redeploy), are
 *  unsealed — free to fill again. `aliveTeamUnits` must already be filtered to one team's
 *  living units. */
export const isGroupSealed = (
  aliveTeamUnits: Unit[], orders: GroupOrders, deployZone: Set<string>, team: Team, gid: GroupId,
): boolean => {
  const gu = aliveTeamUnits.filter(u => u.groupId === gid);
  if (gu.length === 0) return false;
  const o = orders.get(groupOrderKey(team, gid));
  if (o && o.attackTarget != null && o.mode !== 'idle' && o.mode !== 'hold') return true;
  return gu.some(u => !deployZone.has(HexUtils.key(u.tacticalHex)));
};

/** The group that newly-placed cohorts fill: the unsealed group that already holds units
 *  (the one being filled), else the lowest-numbered unsealed group. Null when all four are
 *  sealed — deployment is maxed out until a group empties or redeploys. */
export const activeFillGroup = (
  aliveTeamUnits: Unit[], orders: GroupOrders, deployZone: Set<string>, team: Team,
): GroupId | null => {
  const unsealed = GROUP_IDS.filter(g => !isGroupSealed(aliveTeamUnits, orders, deployZone, team, g));
  return unsealed.find(g => aliveTeamUnits.some(u => u.groupId === g)) ?? unsealed[0] ?? null;
};
