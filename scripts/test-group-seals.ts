// Verifies the group seal / active-fill state machine (src/canvas/constants.ts).
// Run: npx tsx scripts/test-group-seals.ts
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';
import type { Unit, GroupId, GroupOrder, Team } from '../src/battle/simulate';
import { isGroupSealed, activeFillGroup, type GroupOrders } from '../src/canvas/constants';
import { groupOrderKey } from '../src/canvas/constants';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const team: Team = 'red';
// Deploy zone = a few home hexes.
const homeHexes: Hex[] = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
const deployZone = new Set(homeHexes.map(h => HexUtils.key(h)));
const field: Hex = { q: 0, r: -10 }; // outside the deploy zone

let uid = 0;
const unit = (gid: GroupId, hex: Hex, hp = 10): Unit => ({
  id: `u${uid++}`, team, unitType: 'infantry', tacticalHex: hex, homeHex: hex,
  groupId: gid, hp, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});
const orders = (...os: GroupOrder[]): GroupOrders =>
  new Map(os.map(o => [groupOrderKey(o.team, o.groupId), o]));
const marchOrder = (gid: GroupId, target: Hex): GroupOrder =>
  ({ team, groupId: gid, mode: 'march', attackTarget: target, heading: 2 });
const idleDragOrder = (gid: GroupId, target: Hex): GroupOrder =>
  ({ team, groupId: gid, mode: 'idle', attackTarget: target, heading: 2 });
const blankOrder = (gid: GroupId): GroupOrder =>
  ({ team, groupId: gid, mode: undefined, attackTarget: null, heading: 2 });

const active = (units: Unit[], o: GroupOrders) => activeFillGroup(units, o, deployZone, team);
const sealed = (units: Unit[], o: GroupOrders, gid: GroupId) => isGroupSealed(units, o, deployZone, team, gid);

// 1. No units → active = 1, nothing sealed.
check('empty army: active = G1', active([], orders()) === 1);
check('empty army: G1 not sealed', !sealed([], orders(), 1));

// 2. G1 filling in deploy zone, no order → active = 1, not sealed.
{
  const u = [unit(1, homeHexes[0])];
  check('filling G1 (home, no order): not sealed', !sealed(u, orders(), 1));
  check('filling G1: active = G1', active(u, orders()) === 1);
}

// 3. G1 marched (order with target, units still home) → sealed immediately, active = G2.
{
  const u = [unit(1, homeHexes[0])];
  const o = orders(marchOrder(1, field));
  check('marched G1 (units still home): sealed at once', sealed(u, o, 1));
  check('marched G1: active advances to G2', active(u, o) === 2);
}

// 4. order-drag (mode idle + target, units home) does NOT seal.
{
  const u = [unit(1, homeHexes[0])];
  const o = orders(idleDragOrder(1, field));
  check('order-drag G1 (idle+target, home): not sealed', !sealed(u, o, 1));
}

// 5. G1 committed on the field (unit outside zone), no advance order → still sealed.
{
  const u = [unit(1, field)];
  check('G1 unit outside deploy zone (no order): sealed', sealed(u, orders(), 1));
}

// 6. G1 sealed + G2 holds units → active = G2 (the one with units), not G1.
{
  const u = [unit(1, field), unit(2, homeHexes[0])];
  check('G1 sealed, G2 filling: active = G2', active(u, orders(marchOrder(1, field))) === 2);
}

// 7. G1 emptied after being sealed (0 units, stale march order) → un-sealed, active = G1.
{
  const u = [unit(2, field)]; // only G2 alive, on the field (sealed)
  const o = orders(marchOrder(1, field), marchOrder(2, field));
  check('G1 empty (stale order): not sealed', !sealed(u, o, 1));
  check('G1 empty + G2 on field: active = G1 (freed slot)', active(u, o) === 1);
}

// 8. G1 retreated home (sim blanked the order: target null, all units home) → un-sealed.
{
  const u = [unit(1, homeHexes[0])];
  check('G1 redeployed home (blank order): not sealed', !sealed(u, orders(blankOrder(1)), 1));
}

// 9. All four sealed → active = null.
{
  const u = [unit(1, field), unit(2, field), unit(3, field), unit(4, field)];
  check('all 4 on field: every group sealed', [1, 2, 3, 4].every(g => sealed(u, orders(), g as GroupId)));
  check('all 4 sealed: active = null', active(u, orders()) === null);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
