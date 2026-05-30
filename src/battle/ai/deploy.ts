import type { GroupId, UnitType } from '../simulate';
import type { AiRole, DoctrineConfig } from '../../data/ai';
import { COHORT_SIZE } from '../../data/game';

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
  /** Hex keys still free inside the deploy zone, in a stable order. */
  freeHexes: { q: number; r: number; key: string }[];
  /** Undeployed roster by type. */
  roster: Readonly<Record<UnitType, number>>;
}

/**
 * Expand the doctrine's role mix into an ordered group list (capped at 4 groups), then emit
 * one cohort placement per group, scaled by forceScale. Anchors are spaced COHORT_SIZE apart
 * along the free deploy-zone hexes so cohorts don't overlap. Pure; the caller applies each
 * placement through state.placeCohort (which enforces CP and re-checks occupancy).
 */
export function planDeployment(input: DeployInput): Placement[] {
  const { roleMix, forceScale, freeHexes, roster } = input;

  const roles: AiRole[] = [];
  (['centerHold', 'defendLine', 'raid', 'reserve'] as AiRole[]).forEach(role => {
    for (let i = 0; i < roleMix[role]; i++) roles.push(role);
  });
  const groupRoles = roles.slice(0, GROUP_IDS.length);

  const waves = Math.max(1, Math.round(forceScale * 2));

  const placements: Placement[] = [];
  const remaining: Record<UnitType, number> = { ...roster };
  let anchorIdx = 0;

  for (let w = 0; w < waves; w++) {
    for (let g = 0; g < groupRoles.length; g++) {
      const role = groupRoles[g];
      const unitType = ROLE_UNIT[role];
      if (remaining[unitType] <= 0) continue;
      if (anchorIdx >= freeHexes.length) return placements;
      const anchor = freeHexes[anchorIdx];
      anchorIdx += COHORT_SIZE;
      placements.push({ groupId: GROUP_IDS[g], anchorHex: { q: anchor.q, r: anchor.r }, unitType });
      remaining[unitType] -= Math.min(COHORT_SIZE, remaining[unitType]);
    }
  }
  return placements;
}
