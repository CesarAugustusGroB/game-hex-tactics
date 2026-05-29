import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { TICK_MS } from '../constants';

/** Center-to-center pixel spacing of adjacent hexes — converts hex/tick speeds to px/sec. */
export const PX_PER_HEX = (() => {
  const o = HexUtils.hexToPixel({ q: 0, r: 0 });
  const n = HexUtils.hexToPixel(HexUtils.directions[0]);
  return Math.hypot(n.x - o.x, n.y - o.y);
})();

export interface FollowerLeg { x: number; y: number; speed: number }

/**
 * Plan the visual glide for a unit that moved oldHex→newHex in ONE sim tick.
 * Returns one leg per intermediate hex center (via HexUtils.hexLine) so the sprite traces
 * the real hex path instead of a straight diagonal, all sharing one speed so the whole move
 * completes in exactly one tick — lengthened by destination moveCost to match the sim's
 * entry cooldown (nextMoveTick = tick + 1 + moveCost). Returns [] when nothing moved.
 *
 * `topPixel` maps a hex to its on-screen position including terrain elevation (so legs glide
 * over hills/valleys, not through them).
 */
export function planFollowerLegs(
  oldHex: Hex,
  newHex: Hex,
  topPixel: (h: Hex) => { x: number; y: number },
  moveCostAtDest: number,
): FollowerLeg[] {
  const dist = HexUtils.distance(oldHex, newHex);
  if (dist === 0) return [];
  const tickSeconds = (TICK_MS * (1 + moveCostAtDest)) / 1000;
  const speed = (dist * PX_PER_HEX) / tickSeconds;
  return HexUtils.hexLine(oldHex, newHex).slice(1).map(h => {
    const p = topPixel(h);
    return { x: p.x, y: p.y, speed };
  });
}
