import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import type { Unit, UnitType, Team, GroupId, GroupOrder, FormationType } from '../battle/simulate';

export const DRAG_THRESHOLD_PX = 24;

// Flat-top axial→visual mapping:
//   dir 0 (1, 0) = SE, dir 1 (1,-1) = NE, dir 2 (0,-1) = N,
//   dir 3 (-1, 0) = NW, dir 4 (-1, 1) = SW, dir 5 (0, 1) = S.
export const HEADING_ARROWS: Record<number, string> = {
  0: '↘', 1: '↗', 2: '↑', 3: '↖', 4: '↙', 5: '↓',
};

export const STRATEGIC_RESOLUTION = 40;
export const DIVE_ZOOM = 4.5;

export type InputMode = 'place' | 'assign' | 'order';

export type Armies = Map<string, Unit[]>;
export type GroupOrders = Map<string, GroupOrder>;
export type GroupFormations = Map<string, FormationType>;
export type GroupDepths = Map<string, number>;

// Per-team pool of unspent units, decremented by `deployCohort`. Reset on regenerate
// and return-to-strategic.
export type Roster = Record<UnitType, number>;
export type Rosters = Map<Team, Roster>;
export const INITIAL_ROSTER: Roster = { infantry: 50, cavalry: 50, skirmisher: 50 };
export const COHORT_SIZE = 4;

// RETREAT: pressing retreat on a disengaged group vanishes them from the field and
// refunds this fraction of each unit type back to the team's roster. Engaged groups
// (any unit with an enemy in an adjacent hex) get a no-op — they have to fight.
export const RETREAT_REFUND_FRAC = 0.80;

// Capture-the-flag win condition. A team holds the central 7-hex flower (centre + 6
// neighbours) UNCONTESTED to gain a tick of progress; contested or enemy-held ticks
// decay -1 per tick; empty zone leaves both counters alone. Hits `CAPTURE_TICKS_TO_WIN`
// → that team wins. Annihilation still applies as a fallback.
export const CAPTURE_TICKS_TO_WIN = 20;
export const CAPTURE_CENTER: Hex = { q: 0, r: 0 };
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

export const FORMATION_CYCLE: FormationType[] = ['line', 'wedge', 'column', 'hex'];
export const FORMATION_LABELS: Record<FormationType, string> = {
  hex: '⬢ HEX',
  line: '─ LINE',
  wedge: '△ WDGE',
  column: '│ COL',
};

export const TEAM_TINTS: Record<Team, number> = {
  red: 0xef4444,
  blue: 0x3b82f6,
};

export const DAMAGE_PER_TICK = 10;
export const TICK_MS = 500;

// Below this world.scale, swap each unit's soldier sprite for a stylized strategic
// marker (filled team-tinted hex top). At far zoom individual soldier features are
// unreadable anyway, and a clean colored token reads like an army-position marker
// instead of a smear of tiny pixelated sprites. The ticker watches world.scale
// directly and toggles visibility when the threshold is crossed.
export const LOD_THRESHOLD = 0.25;

export const groupOrderKey = (team: Team, groupId: GroupId): string => `${team}:${groupId}`;

// Fraction of the tactical map's screen-y span that each side's deployment zone occupies,
// measured from its edge inward. 0.22 ≈ "bottom 22% of the visible map is red's zone, top
// 22% is blue's." Computed in pixel-y (not axial-r) so the strips read as HORIZONTAL — in
// flat-top hexes the axial-r rows are slanted diagonally and look wrong as a zone marker.
const DEPLOY_ZONE_FRAC = 0.28;

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
