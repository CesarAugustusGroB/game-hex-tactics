// Validates the AI config wrapper parses and exposes every doctrine/difficulty.
// Run: npx tsx scripts/test-ai-config.ts
import { AI, DOCTRINES, DIFFICULTIES } from '../src/data/ai';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

check('3 doctrines', DOCTRINES.length === 3);
check('3 difficulties', DIFFICULTIES.length === 3);
for (const d of DOCTRINES) {
  const c = AI.doctrines[d];
  const mix = c.roleMix.centerHold + c.roleMix.defendLine + c.roleMix.raid + c.roleMix.reserve;
  check(`${d} role mix > 0`, mix > 0, `sum=${mix}`);
  check(`${d} has weights`, typeof c.weights.objective === 'number');
}
for (const f of DIFFICULTIES) {
  const c = AI.difficulties[f];
  check(`${f} reactionTicks >= 1`, c.reactionTicks >= 1);
  check(`${f} forceScale in (0,1]`, c.forceScale > 0 && c.forceScale <= 1);
}
check('hard reacts faster than easy', AI.difficulties.hard.reactionTicks < AI.difficulties.easy.reactionTicks);
check('hard spends more CP than easy', AI.difficulties.hard.cpBudgetFrac > AI.difficulties.easy.cpBudgetFrac);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
