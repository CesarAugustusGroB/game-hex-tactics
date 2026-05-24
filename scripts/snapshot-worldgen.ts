/**
 * Deterministic dump of `generateWorldData` output for regression-testing the
 * world-gen JSON extraction (Task 5). Uses a seeded mulberry32 RNG so simplex
 * noise produces identical output across runs. Outputs JSON-Lines on stdout;
 * compare runs with `diff` (bash) or `fc.exe` (PowerShell).
 *
 * Run with: npx tsx scripts/snapshot-worldgen.ts
 */
import { createNoise2D } from 'simplex-noise';
import { generateWorldData } from '../src/canvas/world-gen';
import { GRID_RADIUS, STRATEGIC_RESOLUTION, DIVE_ZOOM, DEFAULT_GEN_SETTINGS } from '../src/data/world-gen';

const mulberry32 = (seed: number): () => number => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const noise = createNoise2D(mulberry32(0xC0FFEE));

// Seed Math.random for the river pass so diffs are purely terrain-signal,
// not run-to-run noise. The river-start picker and tactical river-thickening
// at world-gen.ts:129,145 both call Math.random() directly.
Math.random = mulberry32(0xDEADBEEF);

const runStrategic = () => generateWorldData({
  settings: { ...DEFAULT_GEN_SETTINGS, noiseOffset: { q: 0, r: 0 }, resolution: STRATEGIC_RESOLUTION },
  gridRadius: GRID_RADIUS,
  viewMode: 'STRATEGIC',
  noise,
});

const runTactical = () => generateWorldData({
  settings: { ...DEFAULT_GEN_SETTINGS, noiseOffset: { q: 7, r: -3 }, resolution: STRATEGIC_RESOLUTION / DIVE_ZOOM },
  gridRadius: GRID_RADIUS,
  viewMode: 'TACTICAL',
  noise,
});

const dump = (label: string, data: { gridData: { hex: { q: number; r: number }; type: string }[] }) => {
  const sorted = [...data.gridData].sort((a, b) =>
    a.hex.q - b.hex.q || a.hex.r - b.hex.r,
  );
  for (const { hex, type } of sorted) {
    console.log(`${label}\t${hex.q},${hex.r}\t${type}`);
  }
};

dump('STRATEGIC', runStrategic());
dump('TACTICAL',  runTactical());
