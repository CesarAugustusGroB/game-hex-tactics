/**
 * Battle-loop balance probe. Measures the real timescales of the victory-points loop on a
 * tactical-scale (radius-35) grassland map, using the actual pure functions:
 *   - deployZoneFor (where each team starts / scores),
 *   - simulateTick (how fast a marching group crosses the map),
 *   - scoreTick / scoring config (how fast points accrue).
 *
 * It prints travel times and a point-rate model so we can reason about game length and the
 * balance between the two scoring paths (raid the enemy line vs. hold the centre).
 *
 * Run with: npx tsx scripts/sim-battle-loop.ts
 */
import { simulateTick, groupHeading, MARCH_HEXES_PER_TICK } from '../src/battle/simulate';
import type { Unit, GroupOrder, Team, UnitType, SimulationConfig, MapApi } from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { deployZoneFor, captureZoneKeys, groupOrderKey, COHORT_SIZE } from '../src/canvas/constants';
import { TICK_MS } from '../src/data/game';
import { POINTS_TO_WIN, POINTS_PER_UNIT_REACHED, CENTER_HOLD_POINTS_PER_TICK } from '../src/data/scoring';
import { CP_CAP, CP_REGEN_N, CP_REGEN_PER_TICK_STEP, CP_COSTS } from '../src/battle/command-points';

const GRID_RADIUS = 35;

// Radius-35 all-GRASSLAND axial disk (the baseline open battlefield).
const grid: { hex: Hex; type: string }[] = [];
for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
  for (let r = Math.max(-GRID_RADIUS, -q - GRID_RADIUS); r <= Math.min(GRID_RADIUS, -q + GRID_RADIUS); r++) {
    grid.push({ hex: { q, r }, type: 'GRASSLAND' });
  }
}
const gridSet = new Set(grid.map(d => HexUtils.key(d.hex)));
const redZone = deployZoneFor('red', grid);
const blueZone = deployZoneFor('blue', grid);

const mapApi: MapApi = {
  isInside: (h) => gridSet.has(HexUtils.key(h)),
  isWalkable: (h) => gridSet.has(HexUtils.key(h)),
  getTerrainType: () => 'GRASSLAND',
  getTerrainMods: () => getTerrainMods('GRASSLAND'),
  getTerrainHeight: () => 12,
  isInDeployZone: (t: Team, h: Hex) => (t === 'red' ? redZone : blueZone).has(HexUtils.key(h)),
};
const config: SimulationConfig = { damagePerTick: 10, mapApi, currentTick: 0 };

const py = (h: Hex) => HexUtils.hexToPixel(h).y;
const zoneHexes = (zone: Set<string>) => grid.filter(d => zone.has(HexUtils.key(d.hex))).map(d => d.hex);

// Front edge of red's zone = the hex closest to centre (min pixel-y), tie-break q near 0.
const redFront = zoneHexes(redZone).sort((a, b) => py(a) - py(b) || Math.abs(a.q) - Math.abs(b.q))[0];
// Blue near edge = the blue-zone hex straight ahead of red front (same q column, highest py).
const blueColumn = zoneHexes(blueZone).filter(h => h.q === redFront.q);
const blueNear = (blueColumn.length ? blueColumn : zoneHexes(blueZone)).sort((a, b) => py(b) - py(a))[0];
// March target: straight north, deep into blue, so the raider crosses the near edge en route.
const blueDeep: Hex = { q: redFront.q, r: redFront.r - 45 };

function seed(type: UnitType, hex: Hex): Unit {
  return {
    id: 'probe', team: 'red', unitType: type, tacticalHex: hex, homeHex: hex,
    groupId: 1, hp: 100, state: 'idle', nextMoveTick: 0, visionRadius: 4,
  };
}

/** March a single red unit of `type` from the red front edge toward `target`; return the
 *  number of ticks until `reached(unit.tacticalHex)` is true (or null if it never does). */
function marchUntil(type: UnitType, target: Hex, reached: (h: Hex) => boolean, maxTicks = 400): number | null {
  let units = [seed(type, redFront)];
  const heading = groupHeading(units, target);
  let orders = new Map<string, GroupOrder>([
    [groupOrderKey('red', 1), { team: 'red', groupId: 1, attackTarget: target, heading, mode: 'march' }],
  ]);
  for (let tick = 1; tick <= maxTicks; tick++) {
    const res = simulateTick(units, orders, { ...config, currentTick: tick });
    units = res.units; orders = res.orders;
    if (reached(units[0].tacticalHex)) return tick;
  }
  return null;
}

const fmt = (ticks: number | null) =>
  ticks == null ? 'never' : `${ticks} ticks (${(ticks * TICK_MS / 1000).toFixed(1)}s)`;

const center: Hex = { q: 0, r: 0 };
const centerKeys = captureZoneKeys();
const gapRows = ((py(redFront) - py(blueNear)) / (HexUtils.size * Math.sqrt(3))); // vertical gap in hex rows

console.log('='.repeat(72));
console.log('BATTLE-LOOP BALANCE PROBE  (radius-35 grassland, TICK_MS=' + TICK_MS + ')');
console.log('='.repeat(72));
console.log(`\nMap geometry:`);
console.log(`  red front edge   : (${redFront.q},${redFront.r})  pixel-y=${py(redFront).toFixed(0)}`);
console.log(`  blue near edge   : (${blueNear.q},${blueNear.r})  pixel-y=${py(blueNear).toFixed(0)}`);
console.log(`  centre flower    : (0,0) + 6 neighbours`);
console.log(`  front-to-front gap ≈ ${gapRows.toFixed(0)} hex rows`);
console.log(`  hex distance front→blueNear = ${HexUtils.distance(redFront, blueNear)}`);
console.log(`  hex distance front→centre   = ${HexUtils.distance(redFront, center)}`);

console.log(`\nTravel time (single unit, open grassland, no enemy):`);
for (const type of ['infantry', 'cavalry', 'skirmisher'] as const) {
  const toEnemy = marchUntil(type, blueDeep, (h) => blueZone.has(HexUtils.key(h)));
  const toCenter = marchUntil(type, center, (h) => centerKeys.has(HexUtils.key(h)));
  console.log(`  ${type.padEnd(10)} march=${MARCH_HEXES_PER_TICK[type]} hex/tick  →enemy line: ${fmt(toEnemy)}   →centre: ${fmt(toCenter)}`);
}

// --- Point-rate model ---
const cpPerSec = CP_REGEN_PER_TICK_STEP * CP_REGEN_N * (1000 / TICK_MS); // CP regenerated per second (0.1·n per tick)
const raidLaunchCP = CP_COSTS.placeCohort + CP_COSTS.march;     // deploy a cohort + order it to march
console.log(`\nScoring config: pointsToWin=${POINTS_TO_WIN}  perUnitReached=${POINTS_PER_UNIT_REACHED}  centreHold=${CENTER_HOLD_POINTS_PER_TICK}/tick (${CENTER_HOLD_POINTS_PER_TICK * 1000 / TICK_MS}/s)`);
console.log(`CP economy: cap=${CP_CAP}  regen=${cpPerSec.toFixed(2)} CP/s  raid launch cost=${raidLaunchCP} CP (placeCohort ${CP_COSTS.placeCohort} + march ${CP_COSTS.march})`);

console.log(`\nPath B — hold the centre (uncontested):`);
const holdTicksTo100 = POINTS_TO_WIN / CENTER_HOLD_POINTS_PER_TICK;
console.log(`  ${CENTER_HOLD_POINTS_PER_TICK}/tick → ${POINTS_TO_WIN} pts in ${holdTicksTo100} ticks = ${(holdTicksTo100 * TICK_MS / 1000).toFixed(0)}s of holding (after travel to centre).`);

const cohortPts = COHORT_SIZE * POINTS_PER_UNIT_REACHED;
const raidPtsPerSec = (cpPerSec / raidLaunchCP) * cohortPts;
console.log(`\nPath A — raid the enemy line (raid & return, cohort of ${COHORT_SIZE}):`);
console.log(`  Each cohort that reaches the line scores ${cohortPts} pts (${COHORT_SIZE}×${POINTS_PER_UNIT_REACHED}) and returns to roster.`);
console.log(`  CP-limited: each launch costs ${raidLaunchCP} CP; sustained = ${(cpPerSec / raidLaunchCP).toFixed(3)} cohorts/s = ${raidPtsPerSec.toFixed(2)} pts/s once the travel pipeline is full.`);
console.log(`  Raid-only time to ${POINTS_TO_WIN}: ≈ ${(POINTS_TO_WIN / raidPtsPerSec).toFixed(0)}s (CP-gated) vs centre ${(POINTS_TO_WIN / (CENTER_HOLD_POINTS_PER_TICK * 1000 / TICK_MS)).toFixed(0)}s.`);
console.log(`  Burst: opening ${CP_CAP} CP funds ${Math.floor(CP_CAP / raidLaunchCP)} immediate launches (${Math.floor(CP_CAP / raidLaunchCP) * cohortPts} pts) — a real pressure spike, ${(Math.floor(CP_CAP / raidLaunchCP) * cohortPts / POINTS_TO_WIN * 100).toFixed(0)}% of the win.`);

console.log('\n' + '='.repeat(72));
console.log('NOTE: no AI controller is registered (registerAiController is never called),');
console.log('so in single-player the enemy never moves, deploys, or contests. Both paths');
console.log('above are therefore UNCONTESTED in practice — there is currently no opponent.');
console.log('='.repeat(72));
