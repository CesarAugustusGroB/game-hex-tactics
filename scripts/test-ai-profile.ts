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
check('test capabilities = [defend]', test.capabilities.length === 1 && test.capabilities[0] === 'defend');
check('test reactionTicks = 10', test.reactionTicks === 10);
check('default lineTypes is inf,skir,cav', test.lineTypes.join(',') === DEFAULT_LINE_TYPES.join(','));

const normal = resolveProfile(profileFromDifficulty('normal'));
check('normal has no deploy flags', !normal.frontLines && !normal.serialWaves && !normal.horizontalFront && !normal.fastDeploy);

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
