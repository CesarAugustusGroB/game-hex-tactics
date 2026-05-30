import type { GroupId, Unit } from '../simulate';
import type { AiRole, DoctrineConfig } from '../../data/ai';

const GROUP_IDS: GroupId[] = [1, 2, 3, 4];

/** Fitness of a unit type for a role — used to match the doctrine's role slots to the groups
 *  whose composition suits them best. */
const FITNESS: Record<AiRole, Record<string, number>> = {
  centerHold: { infantry: 3, skirmisher: 1, cavalry: 1 },
  defendLine: { infantry: 2, skirmisher: 3, cavalry: 1 },
  raid:       { infantry: 1, skirmisher: 2, cavalry: 3 },
  reserve:    { infantry: 1, skirmisher: 2, cavalry: 1 },
};

/** Dominant unit type of a group (mode of its living members), or null if empty. */
function dominantType(units: Unit[]): string | null {
  const counts: Record<string, number> = {};
  for (const u of units) counts[u.unitType ?? 'infantry'] = (counts[u.unitType ?? 'infantry'] ?? 0) + 1;
  let best: string | null = null, bestN = 0;
  for (const [t, n] of Object.entries(counts)) if (n > bestN) { best = t; bestN = n; }
  return best;
}

/**
 * Assign a role to each non-empty group of `team`, honouring the doctrine's role-mix slots.
 * Greedy by fitness: build the slot list from the mix, then for each slot pick the unclaimed
 * group whose dominant type fits best. Empty groups get no role. Pure.
 */
export function assignRoles(myUnits: Unit[], roleMix: DoctrineConfig['roleMix']): Map<GroupId, AiRole> {
  const groupsByType = new Map<GroupId, string | null>();
  for (const g of GROUP_IDS) {
    const gu = myUnits.filter(u => u.groupId === g && u.hp > 0);
    if (gu.length > 0) groupsByType.set(g, dominantType(gu));
  }

  const slots: AiRole[] = [];
  (['centerHold', 'defendLine', 'raid', 'reserve'] as AiRole[]).forEach(role => {
    for (let i = 0; i < roleMix[role]; i++) slots.push(role);
  });

  const assignment = new Map<GroupId, AiRole>();
  const claimed = new Set<GroupId>();
  for (const role of slots) {
    let bestGroup: GroupId | null = null, bestScore = -1;
    for (const [g, type] of groupsByType) {
      if (claimed.has(g)) continue;
      const score = type ? (FITNESS[role][type] ?? 0) : 0;
      if (score > bestScore) { bestScore = score; bestGroup = g; }
    }
    if (bestGroup === null) break;
    assignment.set(bestGroup, role);
    claimed.add(bestGroup);
  }
  for (const g of groupsByType.keys()) if (!assignment.has(g)) assignment.set(g, 'reserve');
  return assignment;
}
