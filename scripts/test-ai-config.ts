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
  check(`${f} forceScale in (0,1]`, c.forceScale > 0 && c.forceScale <= 1);
}
// Reaction speed is NO LONGER monotone with difficulty: the harness (sim-ai-vs-ai.ts --sweep)
// showed fast reaction makes a tactical AI thrash, so the strongest tier reacts SLOWLY. We only
// assert reaction is a sane positive everywhere (covered in the loop above) — not that hard is fastest.
check('hard spends more CP than easy', AI.difficulties.hard.cpBudgetFrac > AI.difficulties.easy.cpBudgetFrac);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
