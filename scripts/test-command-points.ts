/**
 * Headless harness for the pure Command Points module. Verifies cost table, debit
 * (success + broke + immutability), the fractional regen model (accrual + cap clamp +
 * no-op guards), and initial state.
 *
 * Mirrors the pattern of scripts/sim-formations.ts. Run with: npm run test:cp
 */
import {
  CP_CAP, CP_INITIAL, CP_COSTS, CP_REGEN_N, CP_REGEN_PER_TICK_STEP,
  makeInitialCommandPoints, canAfford, debit, applyRegen,
} from '../src/battle/command-points';

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function check(name: string, cond: boolean, detail?: string) {
  results.push({ name, pass: cond, detail });
}

// makeInitialCommandPoints
{
  const cp = makeInitialCommandPoints();
  check('initial defaults both teams to CP_INITIAL', cp.red === CP_INITIAL && cp.blue === CP_INITIAL,
    `red=${cp.red} blue=${cp.blue}`);
  const cp7 = makeInitialCommandPoints(7);
  check('initial honors explicit pool arg', cp7.red === 7 && cp7.blue === 7);
}

// canAfford
{
  const cp = { red: 6, blue: 0 };
  check('canAfford true when exactly enough', canAfford(cp, 'red', 'charge'));
  check('canAfford false when broke', !canAfford(cp, 'blue', 'march'));
  check('canAfford true for 0-cost actions even at 0', canAfford(cp, 'blue', 'idle'));
}

// debit — happy path
{
  const cp = { red: 10, blue: 5 };
  const after = debit(cp, 'red', 'charge');
  check('debit returns new object on success', after !== null && after !== cp);
  check('debit does not mutate input', cp.red === 10);
  check('debit deducts cost from team', after !== null && after.red === 4);
  check('debit leaves other team alone', after !== null && after.blue === 5);
}

// debit — broke
{
  const cp = { red: 3, blue: 20 };
  const after = debit(cp, 'red', 'charge'); // costs 6
  check('debit returns null when broke', after === null);
}

// debit — 0-cost
{
  const cp = { red: 0, blue: 20 };
  const after = debit(cp, 'red', 'idle');
  check('debit with 0-cost at 0 CP still succeeds', after !== null && after.red === 0);
}

// applyRegen — non-positive amount is a no-op (same ref)
{
  const cp = { red: 5, blue: 5 };
  check('regen no-op when amount is 0', applyRegen(cp, 0) === cp);
  check('regen no-op when amount is negative', applyRegen(cp, -1) === cp);
}

// applyRegen — fractional accrual on both teams, rounded to 0.01 (no float drift)
{
  const t = applyRegen({ red: 5, blue: 5 }, 0.3);
  check('regen adds amount to both teams', t.red === 5.3 && t.blue === 5.3,
    `red=${t.red} blue=${t.blue}`);
  const f = applyRegen({ red: 0, blue: 0 }, 0.1);
  check('regen rounds to 0.01 (0 + 0.1 = 0.1, no drift)', f.red === 0.1 && f.blue === 0.1,
    `red=${f.red}`);
}

// applyRegen — clamp at cap (both already at cap → same ref)
{
  const cp = { red: CP_CAP, blue: CP_CAP };
  check('regen clamped at cap (no-op same ref)', applyRegen(cp, 1) === cp);
}

// applyRegen — one capped, one not
{
  const t = applyRegen({ red: CP_CAP, blue: CP_CAP - 1 }, 1, CP_CAP);
  check('regen caps the high team, ticks up the other', t.red === CP_CAP && t.blue === CP_CAP);
}

// regen knob sanity
{
  check('CP_REGEN_PER_TICK_STEP is 0.1', CP_REGEN_PER_TICK_STEP === 0.1);
  check('CP_REGEN_N is a positive multiplier', CP_REGEN_N > 0);
}

// CP_COSTS table consistency
{
  const expected = { assign: 0, idle: 0, meta: 0, debug: 0,
    cycleHeading: 1, cycleFormation: 1, march: 2, placeCohort: 2, orderDrag: 3,
    hold: 4, retreat: 4, charge: 6, unleash: 6 } as const;
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(CP_COSTS);
  const sameSize = expectedKeys.length === actualKeys.length;
  const valuesMatch = (expectedKeys as (keyof typeof expected)[])
    .every(k => CP_COSTS[k] === expected[k]);
  check('CP_COSTS matches spec table (same size + values)', sameSize && valuesMatch,
    `expected ${expectedKeys.length} keys, got ${actualKeys.length}`);
}

// Report
for (const r of results) {
  console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
