// TeamAiProfile resolution: a profile merges its overrides over the ai.json difficulty defaults.
// Run: npx tsx scripts/test-ai-profile.ts
import { resolveProfile, profileFromDifficulty, DEFAULT_LINE_TYPES } from '../src/data/ai-profile';
import { AI } from '../src/data/ai';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const test = resolveProfile(profileFromDifficulty('test'));
check('test resolves frontLines=true', test.frontLines === true);
// Assert against the source rather than a hardcoded value — this verifies resolveProfile surfaces
// the difficulty's capabilities, without breaking every time the authored difficulty list is retuned.
check('test capabilities resolve through from ai.json',
  test.capabilities.join(',') === AI.difficulties.test.capabilities.join(','));
check('test reactionTicks = 10', test.reactionTicks === 10);
check('default lineTypes is inf,skir,cav', test.lineTypes.join(',') === DEFAULT_LINE_TYPES.join(','));

// 'easy' is the difficulty that sets no deploy flags → resolveProfile must default them all to false.
// (This used to be 'normal', which has since gained frontLines:true.)
const flagless = resolveProfile(profileFromDifficulty('easy'));
check('a flag-less difficulty resolves all deploy flags false',
  !flagless.frontLines && !flagless.serialWaves && !flagless.horizontalFront && !flagless.fastDeploy);

const over = resolveProfile({ doctrine: 'balanced', difficulty: 'test', reactionTicks: 3, forceScale: 1.1 });
check('reactionTicks override wins', over.reactionTicks === 3);
check('forceScale override wins', over.forceScale === 1.1);

const cm = resolveProfile({ doctrine: 'balanced', difficulty: 'normal', combat: { chargeReach: 9 } });
check('combat override applies', cm.combat.chargeReach === 9);
check('combat override keeps other defaults', cm.combat.engageRange === AI.combat.engageRange);

const lt = resolveProfile({ doctrine: 'balanced', difficulty: 'test', lineTypes: ['cavalry', 'infantry'] });
check('lineTypes override wins', lt.lineTypes.join(',') === 'cavalry,infantry');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
