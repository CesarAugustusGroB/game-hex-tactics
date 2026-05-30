import type { GroupId, UnitType } from '../simulate';
import type { AiRole, DoctrineConfig } from '../../data/ai';
import { COHORT_SIZE } from '../../data/game';
import { HexUtils } from '../../hex-engine/HexUtils';

export interface Placement {
  groupId: GroupId;
  anchorHex: { q: number; r: number };
  unitType: UnitType;
}

const GROUP_IDS: GroupId[] = [1, 2, 3, 4];

/** Preferred unit type per role (cavalry raids, skirmishers screen, infantry holds). */
const ROLE_UNIT: Record<AiRole, UnitType> = {
  centerHold: 'infantry',
  defendLine: 'infantry',
  raid: 'cavalry',
  reserve: 'skirmisher',
};

export interface DeployInput {
  roleMix: DoctrineConfig['roleMix'];
  forceScale: number;
  /** Free deploy-zone hexes (any order — placement is geometry-driven, not order-driven). */
  freeHexes: { q: number; r: number; key: string }[];
  /** Undeployed roster by type. */
  roster: Readonly<Record<UnitType, number>>;
  /** Orientation of "forward": +1 if the front edge (facing the enemy) is the larger-py side
   *  of the zone (blue, top strip marching down), -1 if the smaller-py side (red, bottom strip). */
  frontSign: number;
}

/**
 * Lay the army out along the FRONT edge of the deploy zone, one group per lateral band:
 * - `waves` cohorts per group (scaled by forceScale) → difficulty controls total force.
 * - Each group owns a disjoint lateral (px) slice, so groups deploy in separate columns. The
 *   sim's rigid-block march steps a whole group together and fails if any forward cell is taken
 *   by another group — packing groups in one corner mutually interlocks them and nobody advances.
 *   Separate bands + front placement keep each group's forward cells clear and units close to
 *   the centre/enemy line. Pure; the caller applies each placement via state.placeCohort.
 */
export function planDeployment(input: DeployInput): Placement[] {
  const { roleMix, forceScale, freeHexes, roster, frontSign } = input;

  const roles: AiRole[] = [];
  (['centerHold', 'defendLine', 'raid', 'reserve'] as AiRole[]).forEach(role => {
    for (let i = 0; i < roleMix[role]; i++) roles.push(role);
  });
  const groupRoles = roles.slice(0, GROUP_IDS.length);
  if (groupRoles.length === 0 || freeHexes.length === 0) return [];

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
  const nGroups = groupRoles.length;

  const placements: Placement[] = [];
  const remaining: Record<UnitType, number> = { ...roster };

  for (let g = 0; g < nGroups; g++) {
    const role = groupRoles[g];
    const unitType = ROLE_UNIT[role];
    const lo = minX + (g / nGroups) * span;
    const hi = minX + ((g + 1) / nGroups) * span;
    // This group's lateral slice [lo, hi), front-most first. The last slice is inclusive so the
    // rightmost column isn't dropped by the half-open boundary.
    const band = pts
      .filter(p => p.lat >= lo && (g === nGroups - 1 ? p.lat <= hi : p.lat < hi))
      .sort((a, b) => b.fwd - a.fwd);
    let idx = 0;
    for (let w = 0; w < waves; w++) {
      if (remaining[unitType] <= 0) break;
      if (idx >= band.length) break;
      const anchor = band[idx];
      idx += COHORT_SIZE;
      placements.push({ groupId: GROUP_IDS[g], anchorHex: { q: anchor.q, r: anchor.r }, unitType });
      remaining[unitType] -= Math.min(COHORT_SIZE, remaining[unitType]);
    }
  }
  return placements;
}
