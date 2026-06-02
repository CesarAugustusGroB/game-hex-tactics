/**
 * AI perception layer ("the eyes"). A pure, per-tick read of the battlefield from the inputs
 * the controller already receives but ignores — enemy positions and the deploy/centre geometry.
 * `makeAiController` is blind today: it never reads `enemyUnits`, so it can't defend its line,
 * contest the centre, or pick targets. This module turns those raw inputs into the small set of
 * facts the reactive tiers (defence, charge, hold, focus-fire) need to decide.
 *
 * Pure: no React/PIXI, no sim mutation. Cheap enough to run every tick.
 */
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import type { Unit } from '../simulate';
import type { AiTickState } from '../ai';
import { CAPTURE_CENTER } from '../../data/game';

export type CenterControl = 'mine' | 'enemy' | 'contested' | 'empty';

export interface ThreatState {
  /** Enemy units standing INSIDE my deploy zone — already farming raid points (+2/unit). */
  breachers: Unit[];
  /** Enemy units within `raidWatchRadius` of my zone but not yet in it — incoming raiders. */
  raiders: Unit[];
  /** Aim point for a defender: centroid of breachers ∪ raiders. Null when the line is clear.
   *  Coarse (independent axial rounding) — meant as a heading target, not an exact hex. */
  raidThreatHex: Hex | null;
  /** Who holds the central capture flower this tick. `contested` = both teams present → nobody scores. */
  centerControl: CenterControl;
  myInCenter: number;
  enemyInCenter: number;
  /** Rounded centroid of all living enemy units — coarse main-body locator for targeting. */
  enemyCentroid: Hex | null;
  enemyCount: number;
}

export interface PerceiveOptions {
  /** Hex distance out from my deploy zone that counts an enemy as an approaching raider. Default 2. */
  raidWatchRadius?: number;
}

// The 7-hex capture flower is fixed for the whole battle, so build its keyset once.
export const CENTER_KEYS: ReadonlySet<string> = new Set(
  [CAPTURE_CENTER, ...HexUtils.getNeighbors(CAPTURE_CENTER)].map(HexUtils.key),
);

/** Axial-range disk of radius `r` around `center` (cube-distance ≤ r), center included. */
const hexesWithin = (center: Hex, r: number): Hex[] => {
  const out: Hex[] = [];
  for (let dq = -r; dq <= r; dq++) {
    const lo = Math.max(-r, -dq - r);
    const hi = Math.min(r, -dq + r);
    for (let dr = lo; dr <= hi; dr++) out.push({ q: center.q + dq, r: center.r + dr });
  }
  return out;
};

const centroid = (units: Unit[]): Hex | null => {
  if (units.length === 0) return null;
  let q = 0, r = 0;
  for (const u of units) { q += u.tacticalHex.q; r += u.tacticalHex.r; }
  return { q: Math.round(q / units.length), r: Math.round(r / units.length) };
};

/** Read the battlefield into a {@link ThreatState}. Takes only the slice of {@link AiTickState}
 *  it needs, so tiers (and tests) can call it with a minimal object. Filters dead units. */
export function perceive(
  state: Pick<AiTickState, 'myUnits' | 'enemyUnits' | 'deployZone'>,
  opts: PerceiveOptions = {},
): ThreatState {
  const r = opts.raidWatchRadius ?? 2;
  const mine = state.myUnits.filter(u => u.hp > 0);
  const enemies = state.enemyUnits.filter(u => u.hp > 0);
  const zone = state.deployZone;

  const breachers: Unit[] = [];
  const raiders: Unit[] = [];
  for (const e of enemies) {
    if (zone.has(HexUtils.key(e.tacticalHex))) { breachers.push(e); continue; }
    if (hexesWithin(e.tacticalHex, r).some(h => zone.has(HexUtils.key(h)))) raiders.push(e);
  }

  let myInCenter = 0, enemyInCenter = 0;
  for (const u of mine) if (CENTER_KEYS.has(HexUtils.key(u.tacticalHex))) myInCenter++;
  for (const e of enemies) if (CENTER_KEYS.has(HexUtils.key(e.tacticalHex))) enemyInCenter++;
  const centerControl: CenterControl =
    myInCenter && enemyInCenter ? 'contested'
      : myInCenter ? 'mine'
        : enemyInCenter ? 'enemy'
          : 'empty';

  return {
    breachers,
    raiders,
    raidThreatHex: centroid([...breachers, ...raiders]),
    centerControl,
    myInCenter,
    enemyInCenter,
    enemyCentroid: centroid(enemies),
    enemyCount: enemies.length,
  };
}
