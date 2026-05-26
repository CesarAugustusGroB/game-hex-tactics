import assert from 'node:assert/strict';
import { mulberry32 } from '../src/utils/rng';
import { MAP_TYPES, MAP_TYPE_IDS, DEFAULT_MAP_TYPE } from '../src/data/world-gen';
import { shapeMult, type ShapeCtx } from '../src/canvas/world-gen';
import { generateWorldData, resolveMapType } from '../src/canvas/world-gen';
import { GRID_RADIUS, STRATEGIC_RESOLUTION } from '../src/data/world-gen';

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

// map-types registry
{
  const SHAPES = new Set(['radial', 'linear', 'flat', 'invertedRadial']);
  assert.equal(MAP_TYPE_IDS.length, 5, '5 archetypes');
  assert.deepEqual(
    [...MAP_TYPE_IDS].sort(),
    ['archipelago', 'coastline', 'inlandSea', 'island', 'plains'],
    'expected archetype ids',
  );
  for (const id of MAP_TYPE_IDS) {
    const cfg = MAP_TYPES[id];
    assert.ok(SHAPES.has(cfg.shape), `${id} has a valid shape`);
    assert.ok(cfg.waterLevel > 0 && cfg.waterLevel < 1, `${id} waterLevel in (0,1)`);
    assert.ok(cfg.mountainLevel > cfg.waterLevel, `${id} mountain > water`);
  }
  assert.ok(MAP_TYPE_IDS.includes(DEFAULT_MAP_TYPE), 'default is a known type');
}

// shaping primitives
{
  const ctx: ShapeCtx = { gridRadius: 35, intercept: 1.1, exponent: 2.5, coastAngle: 0 };

  // flat: identity multiplier
  assert.equal(shapeMult('flat', 0, 0, ctx), 1);
  assert.equal(shapeMult('flat', 20, -10, ctx), 1);

  // radial: high at center, ~0 far out (island)
  assert.ok(Math.abs(shapeMult('radial', 0, 0, ctx) - 1.1) < 1e-9, 'radial center = intercept');
  assert.equal(shapeMult('radial', 60, 0, ctx), 0, 'radial far = 0');

  // invertedRadial: low at center, high at edge (inland sea)
  assert.ok(shapeMult('invertedRadial', 0, 0, ctx) < shapeMult('invertedRadial', 35, 0, ctx),
    'inverted center < edge');

  // linear (angle 0 -> along q): land side > sea side
  assert.ok(shapeMult('linear', 35, 0, ctx) > shapeMult('linear', -35, 0, ctx),
    'linear gradient across the coast axis');

  const ctx90: ShapeCtx = { ...ctx, coastAngle: Math.PI / 2 };
  // angle 90° -> gradient runs along r instead of q
  assert.ok(shapeMult('linear', 0, 35, ctx90) > shapeMult('linear', 0, -35, ctx90),
    'linear gradient rotates with coastAngle');
}

// generateWorldData: deterministic from seed, island preserves sea edges
{
  const base = { mapType: 'island' as const, seed: 12345, noiseOffset: { q: 0, r: 0 }, resolution: STRATEGIC_RESOLUTION };
  const mk = (settings: typeof base) =>
    generateWorldData({ settings, gridRadius: GRID_RADIUS, viewMode: 'STRATEGIC' as const }).gridData;

  assert.deepEqual(mk(base), mk(base), 'same seed -> identical map');
  assert.notDeepEqual(mk(base), mk({ ...base, seed: 999 }), 'different seed -> different map');

  const edge = mk(base).find(d => d.hex.q === GRID_RADIUS && d.hex.r === 0);
  assert.ok(edge && ['SEA', 'DEEP_SEA'].includes(edge.type), 'island outer ring is sea');

  // resolveMapType: explicit passthrough, random is deterministic per seed
  assert.equal(resolveMapType('coastline', 1), 'coastline');
  assert.equal(resolveMapType('random', 555), resolveMapType('random', 555), 'random stable per seed');
}

console.log('all worldgen tests passed');
