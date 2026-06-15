// Validates the AI config wrapper parses and exposes every doctrine/difficulty.
// Run: npx tsx scripts/test-ai-config.ts
import { AI, DOCTRINES, DIFFICULTIES } from '../src/data/ai';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

check('3 doctrines', DOCTRINES.length === 3);
check('4 difficulties', DIFFICULTIES.length === 4);
check('amassCpBudget is a positive number', typeof AI.amassCpBudget === 'number' && AI.amassCpBudget > 0);
check('has an ordered ruleset with a default fallback', AI.rules.length >= 1 && AI.rules.some(r => r.when === undefined));
const UNIT_TYPES = ['infantry', 'cavalry', 'skirmisher'];
for (const d of DOCTRINES) {
  const c = AI.doctrines[d];
  check(`${d} has 3 front bands`, c.front.length === 3, `front=${c.front}`);
  check(`${d} front types are valid`, c.front.every(t => UNIT_TYPES.includes(t)));
  check(`${d} reserve type is valid`, UNIT_TYPES.includes(c.reserve), `reserve=${c.reserve}`);
}
for (const f of DIFFICULTIES) {
  const c = AI.difficulties[f];
  check(`${f} reactionTicks >= 1`, c.reactionTicks >= 1);
  // forceScale is a sane positive scale, NOT capped at 1: it's held flat across difficulties and
  // saturates ~1.2 (full roster deployed) — difficulty is expressed via capabilities, not force.
  check(`${f} forceScale is a sane positive scale`, c.forceScale > 0 && c.forceScale <= 2);
  check(`${f} cpBudgetFrac is a fraction in (0,1]`, c.cpBudgetFrac > 0 && c.cpBudgetFrac <= 1);
}
// Difficulty is a CAPABILITY ladder, not a force/CP/reaction dial: reaction is non-monotone (the
// strongest tier reacts SLOWLY — sim-ai-vs-ai.ts --sweep), forceScale is held flat, and cpBudgetFrac
// is flat too. So we don't assert hard > easy on any scalar knob; we assert the capability sets
// actually differ across tiers (where the difficulty really lives).
check('difficulty tiers differ by capabilities',
  new Set(DIFFICULTIES.map(f => [...AI.difficulties[f].capabilities].sort().join(','))).size > 1);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
