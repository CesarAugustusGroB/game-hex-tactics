import { HexUtils, type Hex } from '../hex-engine/HexUtils';

export type Team = 'red' | 'blue';
export type GroupId = 1 | 2 | 3;
export type UnitState = 'idle' | 'moving' | 'fighting';

export interface Unit {
  id: string;
  team: Team;
  tacticalHex: Hex;
  homeHex: Hex;
  groupId: GroupId | null;
  hp: number;
  state: UnitState;
}

export interface GroupOrder {
  team: Team;
  groupId: GroupId;
  attackTarget: Hex | null;
}

export interface SimulationConfig {
  damagePerTick: number;
}

const groupOrderKey = (team: Team, groupId: GroupId): string => `${team}:${groupId}`;

const sameHex = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

const greedyStep = (from: Hex, to: Hex): Hex => {
  if (sameHex(from, to)) return from;
  const neighbors = HexUtils.getNeighbors(from);
  let best = neighbors[0];
  let bestD = HexUtils.distance(best, to);
  for (let i = 1; i < neighbors.length; i++) {
    const d = HexUtils.distance(neighbors[i], to);
    if (d < bestD || (d === bestD && (neighbors[i].q < best.q || (neighbors[i].q === best.q && neighbors[i].r < best.r)))) {
      best = neighbors[i];
      bestD = d;
    }
  }
  return best;
};

/**
 * Run one simulation tick. Returns a fresh array of surviving units with updated state.
 * Pure: no mutation of inputs; deterministic given inputs.
 */
export const simulateTick = (
  units: Unit[],
  orders: Map<string, GroupOrder>,
  config: SimulationConfig,
): Unit[] => {
  const occupiedByHex = new Map<string, Unit>();
  for (const u of units) occupiedByHex.set(HexUtils.key(u.tacticalHex), u);

  const working: Unit[] = units.map(u => ({ ...u }));
  const byId = new Map<string, Unit>(working.map(u => [u.id, u]));

  const damage = new Map<string, number>();
  for (const u of working) {
    const adjacentEnemies = HexUtils.getNeighbors(u.tacticalHex)
      .map(h => occupiedByHex.get(HexUtils.key(h)))
      .filter((other): other is Unit => !!other && other.team !== u.team);
    if (adjacentEnemies.length > 0) {
      let target = adjacentEnemies[0];
      for (let i = 1; i < adjacentEnemies.length; i++) {
        const e = adjacentEnemies[i];
        if (e.hp < target.hp || (e.hp === target.hp && e.id < target.id)) target = e;
      }
      damage.set(target.id, (damage.get(target.id) ?? 0) + config.damagePerTick);
      u.state = 'fighting';
    }
  }

  damage.forEach((dmg, id) => {
    const t = byId.get(id);
    if (t) t.hp -= dmg;
  });

  const liveOccupancy = new Map<string, Unit>();
  for (const u of working) {
    if (u.state === 'fighting') {
      liveOccupancy.set(HexUtils.key(u.tacticalHex), u);
    }
  }

  for (const u of working) {
    if (u.state === 'fighting') continue;
    const order = u.groupId !== null ? orders.get(groupOrderKey(u.team, u.groupId)) : undefined;
    const target = order?.attackTarget ?? u.homeHex;
    if (sameHex(u.tacticalHex, target)) {
      u.state = 'idle';
      liveOccupancy.set(HexUtils.key(u.tacticalHex), u);
      continue;
    }
    const next = greedyStep(u.tacticalHex, target);
    const nextKey = HexUtils.key(next);
    if (liveOccupancy.has(nextKey)) {
      u.state = 'idle';
      liveOccupancy.set(HexUtils.key(u.tacticalHex), u);
      continue;
    }
    u.tacticalHex = next;
    u.state = 'moving';
    liveOccupancy.set(nextKey, u);
  }

  return working.filter(u => u.hp > 0);
};
