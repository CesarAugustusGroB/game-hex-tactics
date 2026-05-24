/**
 * Headless harness for the pure Command Points module. Verifies cost table, debit
 * (success + broke + immutability), regen cadence and cap clamping, initial state.
 *
 * Mirrors the pattern of scripts/sim-formations.ts. Run with: npm run test:cp
 */
import {
  CP_CAP, CP_COSTS, CP_REGEN_PER_N_TICKS, makeInitialCommandPoints,
  canAfford, debit, applyRegen,
} from '../src/battle/command-points';

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function check(name: string, cond: boolean, detail?: string) {
  results.push({ name, pass: cond, detail });
}

// makeInitialCommandPoints
{
  const cp = makeInitialCommandPoints();
  check('initial both teams at cap', cp.red === CP_CAP && cp.blue === CP_CAP,
    `red=${cp.red} blue=${cp.blue}`);
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

// applyRegen — off-cadence
{
  const cp = { red: 5, blue: 5 };
  const t = applyRegen(cp, 1);
  check('regen no-op on off-cadence tick', t === cp);
}

// applyRegen — tick 0 never regens (avoid free first-tick bonus)
{
  const cp = { red: 5, blue: 5 };
  const t = applyRegen(cp, 0);
  check('regen no-op at tick 0 even on partial CP', t === cp);
}

// applyRegen — on-cadence
{
  const cp = { red: 5, blue: 5 };
  const t = applyRegen(cp, CP_REGEN_PER_N_TICKS);
  check('regen +1 both teams on cadence tick', t.red === 6 && t.blue === 6);
}

// applyRegen — clamp at cap
{
  const cp = { red: CP_CAP, blue: CP_CAP };
  const t = applyRegen(cp, CP_REGEN_PER_N_TICKS);
  check('regen clamped at cap (no-op same ref)', t === cp);
}

// applyRegen — one capped, one not
{
  const cp = { red: CP_CAP - 1, blue: CP_CAP };
  const t = applyRegen(cp, CP_REGEN_PER_N_TICKS);
  check('regen one team capped, other ticks up', t.red === CP_CAP && t.blue === CP_CAP);
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
