import type { AiTickFn, AiTickState } from '../ai';
import type { GroupId, Team } from '../simulate';
import type { Doctrine, Difficulty, AiRole } from '../../data/ai';
import { AI } from '../../data/ai';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { CP_COSTS } from '../command-points';
import { assignRoles } from './commander';
import { planDeployment, type Placement } from './deploy';
import { chooseAction, makeRng } from './utility';
import terrainJson from '../../data/terrain.json';

const GROUP_IDS: GroupId[] = [1, 2, 3, 4];

const heightOf = (type: string): number =>
  (terrainJson as Record<string, { height?: number }>)[type]?.height ?? 0;

/**
 * Build a stateful per-tick controller for `team`. Closure state (roles, per-group last-decision
 * tick, deploy progress, rng) persists across ticks; the sim stays pure. Difficulty gates the
 * decision cadence, deploy force, and CP spend; doctrine sets role mix and utility weights.
 */
export function makeAiController(team: Team, doctrine: Doctrine, difficulty: Difficulty): AiTickFn {
  const doc = AI.doctrines[doctrine];
  const diff = AI.difficulties[difficulty];
  const rng = makeRng(0x9e37 ^ (doctrine.length << 8) ^ difficulty.length);

  let roles = new Map<GroupId, AiRole>();
  const lastDecisionTick = new Map<GroupId, number>();
  let lastCommanderTick = -Infinity;
  // Deploy is planned ONCE (so forceScale controls total army size, not per-tick throughput),
  // then consumed progressively as CP allows across ticks.
  let deployPlan: Placement[] | null = null;
  let deployIdx = 0;
  let deployDone = false;

  return (state: AiTickState): void => {
    const myUnits = state.myUnits.filter(u => u.hp > 0);

    // --- Deploy phase: apply the one-shot plan, bounded each tick by the CP budget fraction. ---
    if (!deployDone) {
      if (deployPlan === null) {
        const occupied = new Set(myUnits.map(u => HexUtils.key(u.tacticalHex)));
        const freeHexes = [...state.deployZone]
          .filter(k => !occupied.has(k))
          .map(k => { const { q, r } = HexUtils.fromKey(k); return { q, r, key: k }; });
        deployPlan = planDeployment({
          roleMix: doc.roleMix, forceScale: diff.forceScale, freeHexes, roster: state.roster,
          // Blue's deploy zone is the top strip (small py) marching down → front = larger py;
          // red is the bottom strip marching up → front = smaller py.
          frontSign: team === 'red' ? -1 : 1,
        });
      }
      if (deployIdx >= deployPlan.length) {
        deployDone = true;
      } else {
        const budget = Math.floor(state.cp * diff.cpBudgetFrac);
        let spent = 0;
        while (deployIdx < deployPlan.length && spent + 2 <= budget) {
          const p = deployPlan[deployIdx];
          deployIdx++;
          if (state.placeCohort(p.groupId, p.anchorHex, p.unitType)) spent += 2;
        }
      }
      return; // one phase per tick: don't also issue orders while still deploying
    }

    // --- Commander: refresh role assignment on its cadence. ---
    if (state.tick - lastCommanderTick >= diff.commanderCadence) {
      roles = assignRoles(myUnits, doc.roleMix);
      lastCommanderTick = state.tick;
    }

    // --- Command: per group, on its reaction cadence, choose & issue an action. ---
    const typeByKey = new Map(state.gridData.map(g => [HexUtils.key(g.hex), g.type]));
    const getHeight = (h: Hex): number => heightOf(typeByKey.get(HexUtils.key(h)) ?? '');
    const commandBudget = Math.floor(state.cp * diff.cpBudgetFrac);
    let cpSpent = 0;
    for (const g of GROUP_IDS) {
      const role = roles.get(g);
      if (!role) continue;
      const groupUnits = myUnits.filter(u => u.groupId === g);
      if (groupUnits.length === 0) continue;
      const last = lastDecisionTick.get(g) ?? -Infinity;
      if (state.tick - last < diff.reactionTicks) continue;
      lastDecisionTick.set(g, state.tick);

      const order = state.myOrders.find(o => o.groupId === g);
      const choice = chooseAction({
        team, role, groupUnits, enemyUnits: state.enemyUnits.filter(u => u.hp > 0),
        weights: doc.weights, cp: state.cp, getHeight, rng, noise: diff.decisionNoise,
      });
      if (!choice) continue;
      // Don't re-issue an identical order (wastes CP).
      if (order && order.mode === choice.mode &&
          (order.attackTarget?.q ?? null) === (choice.attackTarget?.q ?? null) &&
          (order.attackTarget?.r ?? null) === (choice.attackTarget?.r ?? null)) continue;
      const cost = CP_COSTS[choice.intent];
      if (cpSpent + cost > commandBudget) continue;
      if (state.issueOrder(g, { mode: choice.mode, heading: choice.heading, attackTarget: choice.attackTarget }, choice.intent)) {
        cpSpent += cost;
      }
    }
  };
}
