import assert from 'node:assert/strict';
import { mulberry32 } from '../src/utils/rng';

// mulberry32: deterministic per seed, divergent across seeds
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.equal(a(), b(), 'same seed -> same first value');
  assert.equal(a(), b(), 'same seed -> same second value');

  const seq = (s: number, n: number) => {
    const r = mulberry32(s);
    return Array.from({ length: n }, () => r());
  };
  assert.deepEqual(seq(7, 5), seq(7, 5), 'reproducible sequence');
  assert.notDeepEqual(seq(7, 5), seq(8, 5), 'different seed -> different sequence');
  for (const v of seq(123, 100)) assert.ok(v >= 0 && v < 1, 'values in [0,1)');
}

console.log('all worldgen tests passed');
