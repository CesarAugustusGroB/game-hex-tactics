import type { GroupId, UnitType } from '../simulate';
import { COHORT_SIZE } from '../../data/game';
import { HexUtils } from '../../hex-engine/HexUtils';

export interface Placement {
  groupId: GroupId;
  anchorHex: { q: number; r: number };
  unitType: UnitType;
}

const GROUP_IDS: GroupId[] = [1, 2, 3, 4];

export interface DeployInput {
  /** Unit type per lateral FRONT band, left→right. Front group i ← frontTypes[i]. */
  frontTypes: UnitType[];
  /** Unit type of the RESERVE group, held behind the front line. */
  reserveType: UnitType;
  forceScale: number;
  /** Free deploy-zone hexes (any order — placement is geometry-driven, not order-driven). */
  freeHexes: { q: number; r: number; key: string }[];
  /** Undeployed roster by type. */
  roster: Readonly<Record<UnitType, number>>;
  /** Orientation of "forward": +1 if the front edge (facing the enemy) is the larger-py side
   *  of the zone (blue, top strip marching down), -1 if the smaller-py side (red, bottom strip). */
  frontSign: number;
  /** Randomness for reserve placement. Defaults to Math.random; inject a seeded RNG to make
   *  reserve positioning deterministic (a later pass will replace random-back with a chosen spot). */
  rng?: () => number;
  /** Centre-first layout: group 1 takes the CENTRE lateral slice and the rest fan outward to the
   *  flanks (centre → left → right). Default false → bands fill left→right by group order. */
  centreFirst?: boolean;
  /** Override the per-band cohort-anchor count (default `round(forceScale*2)`). Used by fastDeploy
   *  to emit a whole band of anchors at once so the caller can brush it down in a single tick. */
  wavesOverride?: number;
  /** Each band fills a WIDE line across the full map width (front row first), not a lateral column.
   *  Supersedes `centreFirst`. */
  horizontalFront?: boolean;
}

/** Back fraction of the zone (by forward-depth) the reserve deploys into. */
const RESERVE_BACK_FRAC = 0.3;

/**
 * Lay the army out: the NON-RESERVE groups form a wide FRONT line, one per lateral band along the
 * front edge; the RESERVE group is held BACK at a random spot away from the enemy (deterministic
 * placement will come later). Rationale for the bands:
 * - `waves` cohorts per group (scaled by forceScale) → difficulty controls total force.
 * - Each front group owns a disjoint lateral (px) slice, so they deploy in separate columns; the
 *   reserve sits in the back rows so it doesn't clog the front's forward cells. Pure (modulo the
 *   injected `rng`); the caller applies each placement via state.placeCohort.
 */
export function planDeployment(input: DeployInput): Placement[] {
  const { frontTypes, reserveType, forceScale, freeHexes, roster, frontSign, rng = Math.random, centreFirst = false, wavesOverride, horizontalFront = false } = input;
  if (freeHexes.length === 0) return [];

  const waves = wavesOverride ?? Math.max(1, Math.round(forceScale * 2));

  // Annotate with pixel position: lat = x (across the front), fwd = frontSign*y (higher = the
  // front edge facing the enemy).
  const pts = freeHexes.map(h => {
    const p = HexUtils.hexToPixel(h);
    return { q: h.q, r: h.r, lat: p.x, fwd: frontSign * p.y };
  });
  const xs = pts.map(p => p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const span = (maxX - minX) || 1;
  const nFront = Math.max(1, frontTypes.length);

  const placements: Placement[] = [];
  const remaining: Record<UnitType, number> = { ...roster };

  // Take up to `waves` cohort anchors from a candidate list, stepping `step` apart.
  const placeFrom = (cands: { q: number; r: number }[], groupId: GroupId, unitType: UnitType, step: number) => {
    let idx = 0;
    for (let w = 0; w < waves; w++) {
      if (remaining[unitType] <= 0 || idx >= cands.length) break;
      const a = cands[idx];
      idx += step;
      placements.push({ groupId, anchorHex: { q: a.q, r: a.r }, unitType });
      remaining[unitType] -= Math.min(COHORT_SIZE, remaining[unitType]);
    }
  };

  // Physical lat-slice index a band occupies. Default: band b → slice b (left→right). Centre-first:
  // band 0 → middle slice, then alternate outward (centre → left → right) so group 1 holds the centre.
  const sliceOf = (b: number): number => {
    if (!centreFirst) return b;
    const mid = Math.floor((nFront - 1) / 2);
    const order: number[] = [mid];
    for (let d = 1; d < nFront; d++) { if (mid - d >= 0) order.push(mid - d); if (mid + d < nFront) order.push(mid + d); }
    return order[b];
  };

  // FRONT: groups 1..nFront, one lateral band each. Melee bands fill front-most rows first;
  // skirmishers are SUPPORT — they fill the BACK rows of their band (lower fwd) so they sit behind
  // the line and harass with missiles instead of dying in the front rank.
  frontTypes.forEach((unitType, bandPos) => {
    let band: typeof pts;
    if (horizontalFront) {
      // Full-width battle line: fill the frontmost row right across the map (skirmishers to the
      // back rows), so each wave is a wide horizontal front rather than a narrow column.
      band = [...pts].sort((a, b) =>
        (unitType === 'skirmisher' ? a.fwd - b.fwd : b.fwd - a.fwd) || a.lat - b.lat);
    } else {
      const slice = sliceOf(bandPos);
      const lo = minX + (slice / nFront) * span;
      const hi = minX + ((slice + 1) / nFront) * span;
      band = pts
        .filter(p => p.lat >= lo && (slice === nFront - 1 ? p.lat <= hi : p.lat < hi))
        .sort((a, b) => unitType === 'skirmisher' ? a.fwd - b.fwd : b.fwd - a.fwd);
    }
    placeFrom(band, GROUP_IDS[bandPos], unitType, COHORT_SIZE);
  });

  // RESERVE: the group right after the front bands, at random anchors from the back rows
  // (lowest fwd = farthest from the enemy).
  const reserveGroupId = GROUP_IDS[nFront] ?? GROUP_IDS[GROUP_IDS.length - 1];
  const backCount = Math.max(1, Math.floor(pts.length * RESERVE_BACK_FRAC));
  const back = [...pts].sort((a, b) => a.fwd - b.fwd).slice(0, backCount);
  const shuffled = back.map(p => ({ p, k: rng() })).sort((a, b) => a.k - b.k).map(x => x.p);
  placeFrom(shuffled, reserveGroupId, reserveType, 1);

  return placements;
}

export interface FrontLinesInput {
  /** The single attack group this rolling front is built into. */
  groupId: GroupId;
  /** Free deploy-zone hexes (unoccupied), any order. */
  freeHexes: { q: number; r: number; key: string }[];
  /** Undeployed roster by type. */
  roster: Readonly<Record<UnitType, number>>;
  /** +1 if the enemy is on the larger-py side (blue), -1 otherwise (red). */
  frontSign: number;
  /** Max cohorts to place this plan. */
  waveCohorts: number;
  /** Unit type cycle, one type per successive line. Default [infantry, skirmisher, cavalry]. */
  lineTypes?: UnitType[];
}

const DEFAULT_LINE_TYPES: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];

/**
 * Build ONE group as a symmetric rolling front of horizontal lines:
 * - Cells are bucketed into rows by forward-depth (cells sharing a pixel-y are one line) and filled
 *   front (highest fwd) → back.
 * - Each row is filled CENTRE-OUT (closest to the lateral midpoint first), claiming each cohort's
 *   footprint so lines stay spaced and never overlap.
 * - One unit type per line, cycling `lineTypes` (line 1 infantry = front wall, line 2 skirmishers,
 *   line 3 cavalry, line 4 infantry…). If a line's type is out of stock, fall back to any remaining
 *   type so the build never stalls. Pure.
 */
export function planFrontLines(input: FrontLinesInput): Placement[] {
  const { groupId, freeHexes, roster, frontSign, waveCohorts, lineTypes = DEFAULT_LINE_TYPES } = input;
  if (freeHexes.length === 0 || waveCohorts <= 0) return [];

  const pts = freeHexes.map(h => {
    const p = HexUtils.hexToPixel(h);
    return { q: h.q, r: h.r, lat: p.x, fwd: frontSign * p.y };
  });
  const xs = pts.map(p => p.lat);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;

  // Bucket cells into rows by forward-depth (rounded — distinct rows are ~35px apart, never collide),
  // ordered front → back.
  const rows = new Map<number, typeof pts>();
  for (const p of pts) {
    const k = Math.round(p.fwd);
    const arr = rows.get(k);
    if (arr) arr.push(p); else rows.set(k, [p]);
  }
  const rowKeys = [...rows.keys()].sort((a, b) => b - a);

  const remaining: Record<UnitType, number> = { ...roster };
  const used = new Set<string>();
  const placements: Placement[] = [];
  const claim = (q: number, r: number) => {
    used.add(HexUtils.key({ q, r }));
    for (const n of HexUtils.getNeighbors({ q, r })) used.add(HexUtils.key(n));
  };
  const pickType = (lineIdx: number): UnitType | null => {
    const want = lineTypes[lineIdx % lineTypes.length];
    if (remaining[want] > 0) return want;
    return lineTypes.find(t => remaining[t] > 0)
      ?? (['infantry', 'cavalry', 'skirmisher'] as UnitType[]).find(t => remaining[t] > 0) ?? null;
  };

  let lineIdx = 0;
  for (const rk of rowKeys) {
    if (placements.length >= waveCohorts) break;
    const type = pickType(lineIdx);
    if (type == null) break;                       // roster fully exhausted
    const row = rows.get(rk)!.slice().sort((a, b) => Math.abs(a.lat - midX) - Math.abs(b.lat - midX));
    let placedThisRow = 0;
    for (const c of row) {
      if (placements.length >= waveCohorts || remaining[type] <= 0) break;
      if (used.has(HexUtils.key({ q: c.q, r: c.r }))) continue;
      placements.push({ groupId, anchorHex: { q: c.q, r: c.r }, unitType: type });
      claim(c.q, c.r);
      remaining[type] -= Math.min(COHORT_SIZE, remaining[type]);
      placedThisRow++;
    }
    if (placedThisRow > 0) lineIdx++;              // a line was laid → next line cycles type
  }
  return placements;
}
