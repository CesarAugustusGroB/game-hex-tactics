// Catalog-driven numeric field access on a TeamAiProfile. Run: npx tsx scripts/test-ai-profile-fields.ts
import { PROFILE_NUM_FIELDS, effectiveNum, setNum } from '../src/ai-lab/profileFields';
import { profileFromDifficulty } from '../src/data/ai-profile';
import { AI } from '../src/data/ai';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const p = profileFromDifficulty('test');
check('catalog covers core + combat + counter + strategy (18 fields)', PROFILE_NUM_FIELDS.length === 18, `${PROFILE_NUM_FIELDS.length}`);
check('effective top-level reactionTicks = 10 (test default)', effectiveNum(p, 'reactionTicks') === 10);
check('effective nested combat.chargeReach = ai.json default', effectiveNum(p, 'combat.chargeReach') === AI.combat.chargeReach);

const p2 = setNum(p, 'reactionTicks', 4);
check('setNum top-level override applies', p2.reactionTicks === 4 && effectiveNum(p2, 'reactionTicks') === 4);

const p3 = setNum(p, 'combat.chargeReach', 9);
check('setNum nested override applies', effectiveNum(p3, 'combat.chargeReach') === 9);
check('setNum nested keeps sibling defaults', effectiveNum(p3, 'combat.engageRange') === AI.combat.engageRange);

check('setNum is immutable (original untouched)', p.reactionTicks === undefined && p.combat === undefined);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
