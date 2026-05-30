// Verifies assignRoles matches groups to doctrine role slots by unit fitness.
// Run: npx tsx scripts/test-ai-commander.ts
import { assignRoles } from '../src/battle/ai/commander';
import { AI } from '../src/data/ai';
import type { Unit, GroupId, UnitType } from '../src/battle/simulate';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const mk = (groupId: GroupId, unitType: UnitType): Unit => ({
  id: `${groupId}-${unitType}-${Math.floor(Math.abs(Math.sin(groupId * 7 + unitType.length)) * 1e6)}`,
  team: 'blue', unitType, tacticalHex: { q: 0, r: 0 }, homeHex: { q: 0, r: 0 },
  groupId, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});

const units: Unit[] = [mk(1, 'cavalry'), mk(2, 'infantry'), mk(3, 'skirmisher')];
const roles = assignRoles(units, AI.doctrines.balanced.roleMix);

check('every non-empty group gets a role', roles.size === 3, `size=${roles.size}`);
check('cavalry group takes raid', roles.get(1) === 'raid', `g1=${roles.get(1)}`);
check('infantry group takes centerHold or defendLine',
  roles.get(2) === 'centerHold' || roles.get(2) === 'defendLine', `g2=${roles.get(2)}`);
check('empty group 4 unassigned', !roles.has(4));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
