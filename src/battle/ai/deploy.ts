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
  const { frontTypes, reserveType, forceScale, freeHexes, roster, frontSign, rng = Math.random } = input;
  if (freeHexes.length === 0) return [];

  const waves = Math.max(1, Math.round(forceScale * 2));

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

  // FRONT: groups 1..nFront, one lateral band each, front-most rows first.
  frontTypes.forEach((unitType, bandPos) => {
    const lo = minX + (bandPos / nFront) * span;
    const hi = minX + ((bandPos + 1) / nFront) * span;
    const band = pts
      .filter(p => p.lat >= lo && (bandPos === nFront - 1 ? p.lat <= hi : p.lat < hi))
      .sort((a, b) => b.fwd - a.fwd);
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
