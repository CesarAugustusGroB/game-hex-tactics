// runSeries aggregates N matches into win counts that sum to N. Run: npx tsx scripts/test-sim-series.ts
import { runSeries } from '../src/sim/runMatch';
import { profileFromDifficulty } from '../src/data/ai-profile';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const res = runSeries(profileFromDifficulty('test'), profileFromDifficulty('normal'), 6);
check('reps recorded', res.reps === 6);
check('wins+draws sum to reps', res.redWins + res.blueWins + res.draws === 6, `${res.redWins}/${res.blueWins}/${res.draws}`);
check('avg ticks positive', res.avgTicks > 0, `${res.avgTicks.toFixed(0)}`);
check('test (frontLines) beats normal as red majority', res.redWins >= res.blueWins, `red ${res.redWins} blue ${res.blueWins}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
