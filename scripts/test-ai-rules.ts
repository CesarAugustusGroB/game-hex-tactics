// Pure rule evaluator: first matching rule wins (AND of present condition keys); a rule with
// no `when` is the default. Run: npx tsx scripts/test-ai-rules.ts
import { evaluateRules, type AiRule, type RuleCtx } from '../src/battle/ai/rules';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const rules: AiRule[] = [
  { when: { canAmass: true, cpSpentAmassingLt: 100 }, do: 'amass' },
  { do: 'march' },
];

const ctx = (o: Partial<RuleCtx>): RuleCtx => ({
  size: 4, massed: false, inZone: true, cpSpentAmassing: 0, canAmass: true, ...o,
});

check('amass while under budget and can amass', evaluateRules(rules, ctx({})) === 'amass');
check('march once budget spent', evaluateRules(rules, ctx({ cpSpentAmassing: 100 })) === 'march');
check('march when cannot amass (AND fails)', evaluateRules(rules, ctx({ canAmass: false })) === 'march');
check('default rule (no when) always matches', evaluateRules([{ do: 'march' }], ctx({})) === 'march');
check('no matching rule → null', evaluateRules([{ when: { massed: true }, do: 'march' }], ctx({ massed: false })) === null);

// AND composition: both keys must hold for the first rule.
check('AND: both keys hold', evaluateRules(rules, ctx({ canAmass: true, cpSpentAmassing: 99 })) === 'amass');
check('AND: one key fails → next rule', evaluateRules(rules, ctx({ canAmass: true, cpSpentAmassing: 100 })) === 'march');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
