/**
 * Deterministic dump of `generateWorldData` output for every map archetype at a
 * fixed seed. The seed makes noise + rivers reproducible, so before/after diffs
 * isolate behavior changes. Outputs JSON-Lines on stdout; compare runs with
 * `diff` (bash) or `fc.exe` (PowerShell).
 *
 * Run with: npx tsx scripts/snapshot-worldgen.ts
 */
import { generateWorldData } from '../src/canvas/world-gen';
import { GRID_RADIUS, STRATEGIC_RESOLUTION, DIVE_ZOOM, MAP_TYPE_IDS } from '../src/data/world-gen';

const SEED = 0xc0ffee;

const dump = (label: string, data: { gridData: { hex: { q: number; r: number }; type: string }[] }) => {
  const sorted = [...data.gridData].sort((a, b) => a.hex.q - b.hex.q || a.hex.r - b.hex.r);
  for (const { hex, type } of sorted) console.log(`${label}\t${hex.q},${hex.r}\t${type}`);
};

for (const mapType of MAP_TYPE_IDS) {
  dump(`STRATEGIC:${mapType}`, generateWorldData({
    settings: { mapType, seed: SEED, noiseOffset: { q: 0, r: 0 }, resolution: STRATEGIC_RESOLUTION },
    gridRadius: GRID_RADIUS,
    viewMode: 'STRATEGIC',
  }));
  dump(`TACTICAL:${mapType}`, generateWorldData({
    settings: { mapType, seed: SEED, noiseOffset: { q: 7 * DIVE_ZOOM, r: -3 * DIVE_ZOOM }, resolution: STRATEGIC_RESOLUTION / DIVE_ZOOM },
    gridRadius: GRID_RADIUS,
    viewMode: 'TACTICAL',
  }));
}
