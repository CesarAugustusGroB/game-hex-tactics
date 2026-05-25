/**
 * Headless checks for the pure scoreTick scoring function. No test runner is configured;
 * this throws a non-zero exit code on any failed assertion.
 *
 * Run with: npx tsx scripts/sim-scoring.ts
 */
import { scoreTick } from '../src/battle/scoring';
import type { Unit, Team } from '../src/battle/simulate';
import { HexUtils } from '../src/hex-engine/HexUtils';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`); failures++; }
}

function unit(id: string, team: Team, q: number, r: number, extra: Partial<Unit> = {}): Unit {
  return {
    id, team, unitType: 'infantry',
    tacticalHex: { q, r }, homeHex: { q, r },
    groupId: 1, hp: 10, state: 'idle',
    nextMoveTick: 0, visionRadius: 4,
    ...extra,
  };
}

const cfg = { pointsToWin: 100, pointsPerUnitReached: 1, centerHoldPointsPerTick: 1 };
const center = new Set([HexUtils.key({ q: 0, r: 0 })]);
const noZone = { red: new Set<string>(), blue: new Set<string>() };

// 1. A red unit standing in red's scoring zone scores, is removed, and refunds roster.
{
  const zoneKey = HexUtils.key({ q: 5, r: -5 });
  const r = scoreTick({
    units: [unit('a', 'red', 5, -5, { unitType: 'cavalry' })],
    score: { red: 0, blue: 0 },
    centerKeys: center,
    scoringZone: { red: new Set([zoneKey]), blue: new Set<string>() },
    config: cfg,
  });
  check('reach: red +1 point', r.score.red === 1);
  check('reach: unit removed', r.reachedUnitIds.has('a'));
  check('reach: roster +1 cavalry', r.rosterDelta.red.cavalry === 1);
  check('reach: changed flag set', r.changed === true);
}

// 2. Uncontested centre accrues per-tick points; no removal.
{
  const r = scoreTick({
    units: [unit('a', 'red', 0, 0)],
    score: { red: 0, blue: 0 },
    centerKeys: center,
    scoringZone: noZone,
    config: cfg,
  });
  check('centre uncontested: red +1', r.score.red === 1);
  check('centre uncontested: no removal', r.reachedUnitIds.size === 0);
}

// 3. Contested centre — nobody scores, nothing changes.
{
  const r = scoreTick({
    units: [unit('a', 'red', 0, 0), unit('b', 'blue', 0, 0)],
    score: { red: 5, blue: 5 },
    centerKeys: center,
    scoringZone: noZone,
    config: cfg,
  });
  check('centre contested: red unchanged', r.score.red === 5);
  check('centre contested: blue unchanged', r.score.blue === 5);
  check('centre contested: changed false', r.changed === false);
}

// 4. Win at threshold.
{
  const r = scoreTick({
    units: [unit('a', 'red', 0, 0)],
    score: { red: 99, blue: 0 },
    centerKeys: center,
    scoringZone: noZone,
    config: cfg,
  });
  check('win: red reaches 100', r.score.red === 100);
  check('win: winner is red', r.winner === 'red');
}

// 5. A dead unit in the scoring zone does not score and is not removed.
{
  const zoneKey = HexUtils.key({ q: 5, r: -5 });
  const r = scoreTick({
    units: [unit('a', 'red', 5, -5, { hp: 0 })],
    score: { red: 0, blue: 0 },
    centerKeys: center,
    scoringZone: { red: new Set([zoneKey]), blue: new Set<string>() },
    config: cfg,
  });
  check('dead unit: no score', r.score.red === 0);
  check('dead unit: no removal', r.reachedUnitIds.size === 0);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll scoring checks passed.');
}
