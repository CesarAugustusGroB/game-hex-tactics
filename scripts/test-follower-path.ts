// Verifies planFollowerLegs traces the per-tick hex path and finishes each tick's move in
// exactly one tick. Run: npx tsx scripts/test-follower-path.ts
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import { planFollowerLegs, PX_PER_HEX } from '../src/canvas/render/followerPath';
import { TICK_MS } from '../src/canvas/constants';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};
const approx = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;
const flat = (h: Hex) => HexUtils.hexToPixel(h); // identity pixel map, no elevation

// dist 0 → no legs (nothing moved).
check('dist 0 yields no legs', planFollowerLegs({ q: 0, r: 0 }, { q: 0, r: 0 }, flat, 0).length === 0);

// dist 1 → one leg ending at the destination, covered in one tick (moveCost 0).
{
  const dest = HexUtils.directions[0];
  const legs = planFollowerLegs({ q: 0, r: 0 }, dest, flat, 0);
  const p = HexUtils.hexToPixel(dest);
  check('dist 1 yields one leg', legs.length === 1);
  check('dist 1 ends at destination', approx(legs[0].x, p.x) && approx(legs[0].y, p.y));
  check('dist 1 finishes in one tick', approx(legs[0].speed * (TICK_MS / 1000), PX_PER_HEX));
}

// dist 2 straight → two legs tracing hexLine centers, equal speed, total covered in one tick.
{
  const a = { q: 0, r: 0 }, b = { q: 2, r: 0 };
  const legs = planFollowerLegs(a, b, flat, 0);
  const line = HexUtils.hexLine(a, b).slice(1);
  check('dist 2 yields two legs', legs.length === 2);
  check('dist 2 legs share one speed', approx(legs[0].speed, legs[1].speed));
  check('dist 2 traces hex centers', line.every((h, i) => {
    const p = HexUtils.hexToPixel(h);
    return approx(legs[i].x, p.x) && approx(legs[i].y, p.y);
  }));
  check('dist 2 finishes in one tick', approx(legs[0].speed * (TICK_MS / 1000), 2 * PX_PER_HEX));
}

// moveCost lengthens the tick: cost 2 → one-third the speed of cost 0.
{
  const fast = planFollowerLegs({ q: 0, r: 0 }, HexUtils.directions[0], flat, 0)[0].speed;
  const slow = planFollowerLegs({ q: 0, r: 0 }, HexUtils.directions[0], flat, 2)[0].speed;
  check('moveCost 2 is one-third speed', approx(slow * 3, fast));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
