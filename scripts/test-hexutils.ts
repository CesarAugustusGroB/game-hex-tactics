import assert from 'node:assert/strict';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';

// hexLine: endpoints exact, length == distance+1, consecutive adjacency, no duplicates
{
  const pairs: [Hex, Hex][] = [
    [{ q: 0, r: 0 }, { q: 3, r: 0 }],
    [{ q: 0, r: 0 }, { q: 0, r: 3 }],
    [{ q: 0, r: 0 }, { q: 3, r: -3 }],
    [{ q: 0, r: 0 }, { q: -2, r: 5 }],
    [{ q: 1, r: 1 }, { q: 4, r: -2 }],
    [{ q: -3, r: 2 }, { q: 5, r: -1 }],
    [{ q: 0, r: 0 }, { q: 6, r: -3 }],
    [{ q: 2, r: -4 }, { q: -3, r: 6 }],
  ];
  for (const [a, b] of pairs) {
    const line = HexUtils.hexLine(a, b);
    const d = HexUtils.distance(a, b);
    const tag = `${a.q},${a.r}->${b.q},${b.r}`;
    assert.equal(line.length, d + 1, `length == distance+1 (${tag})`);
    assert.deepEqual(line[0], a, `starts at a (${tag})`);
    assert.deepEqual(line[line.length - 1], b, `ends at b (${tag})`);
    const seen = new Set<string>();
    for (let i = 0; i < line.length; i++) {
      const key = HexUtils.key(line[i]);
      assert.ok(!seen.has(key), `no duplicate hex (${tag})`);
      seen.add(key);
      if (i > 0) assert.equal(HexUtils.distance(line[i - 1], line[i]), 1, `consecutive adjacency (${tag})`);
    }
  }
}

// direction symmetry: line(a,b) reversed equals line(b,a)
{
  const cases: [Hex, Hex][] = [
    [{ q: 0, r: 0 }, { q: 4, r: -2 }],
    [{ q: -2, r: 3 }, { q: 5, r: -4 }],
    [{ q: 1, r: 1 }, { q: -3, r: 4 }],
  ];
  for (const [a, b] of cases) {
    const fwd = HexUtils.hexLine(a, b).map(HexUtils.key);
    const rev = HexUtils.hexLine(b, a).map(HexUtils.key).reverse();
    assert.deepEqual(fwd, rev, `hexLine direction-symmetric (${a.q},${a.r}<->${b.q},${b.r})`);
  }
}

console.log('all hexutils tests passed');
