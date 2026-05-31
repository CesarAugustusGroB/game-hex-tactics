/**
 * Group seal / fill rules — the discipline both the human player and the AI obey: fill ONE
 * active group at a time, and once it's committed (launched) it seals and the next group
 * becomes the fill target. Pure (no React/PIXI) so the sim, the AI, and the canvas all share
 * one source of truth. The canvas layer re-exports these from src/canvas/constants.ts.
 */
import { HexUtils } from '../hex-engine/HexUtils';
import type { Unit, Team, GroupId, GroupOrder } from './simulate';

export const GROUP_IDS: readonly GroupId[] = [1, 2, 3, 4];
export const groupOrderKey = (team: Team, gid: GroupId): string => `${team}:${gid}`;

type Orders = ReadonlyMap<string, GroupOrder>;

/** A group is "sealed" (locked from receiving new units) while it's committed on the field:
 *  it has living units AND either an active advance order (attackTarget set, not idle/hold) or
 *  at least one unit standing outside its deploy zone. Empty groups, and groups fully back
 *  inside their deploy zone, are unsealed — free to fill again. `aliveTeamUnits` must already
 *  be filtered to one team's living units. */
export const isGroupSealed = (
  aliveTeamUnits: Unit[], orders: Orders, deployZone: ReadonlySet<string>, team: Team, gid: GroupId,
): boolean => {
  const gu = aliveTeamUnits.filter(u => u.groupId === gid);
  if (gu.length === 0) return false;
  const o = orders.get(groupOrderKey(team, gid));
  if (o && o.attackTarget != null && o.mode !== 'idle' && o.mode !== 'hold') return true;
  return gu.some(u => !deployZone.has(HexUtils.key(u.tacticalHex)));
};

/** A group is "engaged" when any of its living units has an enemy in an adjacent hex. Drives
 *  the in-combat 2× cost for RETREAT / BANISH. `units` is the full unit list for the hex. */
export const isGroupEngaged = (units: Unit[], team: Team, gid: GroupId): boolean => {
  const enemyHexes = new Set(
    units.filter(u => u.team !== team && u.hp > 0).map(u => HexUtils.key(u.tacticalHex)),
  );
  return units.some(u => u.team === team && u.groupId === gid && u.hp > 0
    && HexUtils.getNeighbors(u.tacticalHex).some(n => enemyHexes.has(HexUtils.key(n))));
};

/** The group that newly-placed cohorts fill: the unsealed group that already holds units (the
 *  one being filled), else the lowest-numbered unsealed group. Null when all four are sealed —
 *  deployment is maxed out until a group empties or redeploys. */
export const activeFillGroup = (
  aliveTeamUnits: Unit[], orders: Orders, deployZone: ReadonlySet<string>, team: Team,
): GroupId | null => {
  const unsealed = GROUP_IDS.filter(g => !isGroupSealed(aliveTeamUnits, orders, deployZone, team, g));
  return unsealed.find(g => aliveTeamUnits.some(u => u.groupId === g)) ?? unsealed[0] ?? null;
};
