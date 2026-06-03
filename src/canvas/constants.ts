import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import type { Unit, UnitType, Team, GroupOrder, FormationType, OrderMode } from '../battle/simulate';
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

// Group seal/fill rules + GROUP_IDS/groupOrderKey live in the pure battle layer (so the AI and
// sim share them); re-exported here so canvas-side consumers keep their import paths.
export { GROUP_IDS, groupOrderKey, isGroupSealed, isGroupEngaged, activeFillGroup } from '../battle/groups';

type GridData = { hex: Hex; type: string }[];

// 0.28 ≈ bottom 28% strip of the visible map. Computed in pixel-y (not axial-r) so
// the strips read as HORIZONTAL — flat-top axial-r rows are slanted diagonally.
const computeDeployZone = (team: Team, gridData: GridData): Set<string> => {
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

// Per-gridData derived lookups behind a 1-entry identity cache. gridData is a stable array
// reference until world regen, so the per-tick (battle tick, unit render) and per-frame
// (order drag) consumers share one build instead of each recomputing O(n) maps/sets every
// time. Returned collections are read-only by all callers — never mutate them.
let cacheGrid: GridData | null = null;
let cacheTerrainAt = new Map<string, string>();
let cacheGridSet = new Set<string>();
let cacheDeployZones: Record<Team, Set<string>> = { red: new Set(), blue: new Set() };
const ensureGridCache = (gridData: GridData): void => {
  if (cacheGrid === gridData) return;
  cacheGrid = gridData;
  cacheTerrainAt = new Map(gridData.map(d => [HexUtils.key(d.hex), d.type]));
  cacheGridSet = new Set(gridData.map(d => HexUtils.key(d.hex)));
  cacheDeployZones = { red: computeDeployZone('red', gridData), blue: computeDeployZone('blue', gridData) };
};

/** hex key → terrain type for every hex. Cached per gridData identity. */
export const terrainMapFor = (gridData: GridData): Map<string, string> => {
  ensureGridCache(gridData);
  return cacheTerrainAt;
};
/** Set of all in-bounds hex keys. Cached per gridData identity. */
export const gridKeySetFor = (gridData: GridData): Set<string> => {
  ensureGridCache(gridData);
  return cacheGridSet;
};
/** Hex keys belonging to a team's deployment zone, derived from the screen-y extent of
 *  `gridData`. Red gets the bottom strip, blue the top. Cached per gridData identity. */
export const deployZoneFor = (team: Team, gridData: GridData): Set<string> => {
  ensureGridCache(gridData);
  return cacheDeployZones[team];
};

// Shared order→glyph/color mapping — single source of truth for the HUD accordion
// (src/canvas/HUD.tsx) and the on-canvas group glyph (src/canvas/render/drawUnits.ts).
// Glyphs are monochrome single letters on purpose: PIXI .tint colors a white letter
// reliably but muddies multicolor emoji. `label` carries the full word for the HUD.
export interface OrderBadge {
  glyph: string;
  label: string;
  colorHex: string; // for CSS (HUD)
  colorInt: number; // for PIXI .tint
}

export const ORDER_BADGE: Record<OrderMode | 'none', OrderBadge> = {
  hold:    { glyph: 'H', label: 'HOLD',    colorHex: '#f59e0b', colorInt: 0xf59e0b },
  march:   { glyph: 'M', label: 'MARCH',   colorHex: '#10b981', colorInt: 0x10b981 },
  charge:  { glyph: 'C', label: 'CHARGE',  colorHex: '#dc2626', colorInt: 0xdc2626 },
  unleash: { glyph: 'U', label: 'UNLEASH', colorHex: '#a855f7', colorInt: 0xa855f7 },
  retreat: { glyph: 'R', label: 'RETREAT', colorHex: '#3b82f6', colorInt: 0x3b82f6 },
  idle:    { glyph: 'I', label: 'IDLE',    colorHex: '#64748b', colorInt: 0x64748b },
  none:    { glyph: '·', label: '—', colorHex: '#64748b', colorInt: 0x64748b },
};

// No order entry => 'none' (freshly deployed). Order entry without an explicit mode =>
// 'march' (the sim's movement default).
export const badgeForOrder = (order?: { mode?: OrderMode } | null): OrderBadge =>
  order ? ORDER_BADGE[order.mode ?? 'march'] : ORDER_BADGE.none;
