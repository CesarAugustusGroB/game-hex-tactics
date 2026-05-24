import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import type { Unit, UnitType, Team, GroupId, GroupOrder, FormationType } from '../battle/simulate';
import {
  HEADING_ARROWS,
  INITIAL_ROSTER,
  COHORT_SIZE,
  RETREAT_REFUND_FRAC,
  CAPTURE_TICKS_TO_WIN,
  CAPTURE_CENTER,
  FORMATION_CYCLE,
  FORMATION_LABELS,
  TEAM_TINTS,
  TICK_MS,
  LOD_THRESHOLD,
  DRAG_THRESHOLD_PX,
  DEPLOY_ZONE_FRAC,
} from '../data/game';

// Re-export under their legacy paths so existing consumers (HUD, render, input handlers,
// GameCanvas composition root) don't need to migrate import paths. Values live in
// src/data/game.json; this file owns only the canvas-side derived helpers (factories,
// deploy-zone computation, key formatters).
export {
  HEADING_ARROWS,
  INITIAL_ROSTER,
  COHORT_SIZE,
  // RETREAT: pressing retreat on a disengaged group vanishes them from the field and
  // refunds this fraction of each unit type back to the team's roster. Engaged groups
  // (any unit with an enemy in an adjacent hex) get a no-op — they have to fight.
  RETREAT_REFUND_FRAC,
  // Capture-the-flag win condition. A team holds the central 7-hex flower (centre + 6
  // neighbours) UNCONTESTED to gain a tick of progress; contested or enemy-held ticks
  // decay -1 per tick; empty zone leaves both counters alone. Hits CAPTURE_TICKS_TO_WIN
  // → that team wins. Annihilation still applies as a fallback.
  CAPTURE_TICKS_TO_WIN,
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
};

export { STRATEGIC_RESOLUTION, DIVE_ZOOM } from '../data/world-gen';

export type InputMode = 'place' | 'assign' | 'order';

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
