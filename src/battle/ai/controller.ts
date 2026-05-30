import type { AiTickFn, AiTickState } from '../ai';
import type { GroupId, Team } from '../simulate';
import type { Doctrine, Difficulty, AiRole } from '../../data/ai';
import { AI } from '../../data/ai';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { CP_COSTS } from '../command-points';
import { COHORT_SIZE } from '../../data/game';
import { assignRoles } from './commander';
import { planDeployment } from './deploy';
import { chooseAction, makeRng } from './utility';
import terrainJson from '../../data/terrain.json';

const GROUP_IDS: GroupId[] = [1, 2, 3, 4];

const heightOf = (type: string): number =>
  (terrainJson as Record<string, { height?: number }>)[type]?.height ?? 0;

/**
 * Build a stateful per-tick controller for `team`. It maintains a target standing force (scaled
 * by difficulty): it fills up to that fast at the start AND reinforces from its remaining roster
 * to replace casualties — it does not deploy once and quit. Reinforcement and command both run
 * every tick (no phase that blocks commanding). Closure state (roles, per-group decision tick,
 * rng) persists across ticks; the sim stays pure.
 */
export function makeAiController(team: Team, doctrine: Doctrine, difficulty: Difficulty): AiTickFn {
  const doc = AI.doctrines[doctrine];
  const diff = AI.difficulties[difficulty];
  const rng = makeRng(0x9e37 ^ (doctrine.length << 8) ^ difficulty.length);
  // Blue's deploy zone is the top strip (small py) marching down → front = larger py; red is the
  // bottom strip marching up → front = smaller py.
  const frontSign = team === 'red' ? -1 : 1;

  const nGroups = Math.min(GROUP_IDS.length,
    doc.roleMix.centerHold + doc.roleMix.defendLine + doc.roleMix.raid + doc.roleMix.reserve);
  const waves = Math.max(1, Math.round(diff.forceScale * 2));
  const forceTarget = nGroups * waves * COHORT_SIZE;

  // Resolved on the first tick once the deploy zone is known. Capped at half the zone's hex
  // count so the army never packs the zone solid — a dense zone makes lateral bands bleed into
  // each other and the rigid-block march interlocks (units need clear forward cells to advance).
  let targetUnits = -1;

  let roles = new Map<GroupId, AiRole>();
  const lastDecisionTick = new Map<GroupId, number>();
  let lastCommanderTick = -Infinity;

  return (state: AiTickState): void => {
    const myUnits = state.myUnits.filter(u => u.hp > 0);
    if (targetUnits < 0) targetUnits = Math.min(forceTarget, Math.floor(state.deployZone.size * 0.5));

    // --- Reinforce: top up to the target force from the front of each group's lateral band.
    //     Runs every tick (a no-op when at strength), so the army self-replenishes losses. ---
    if (myUnits.length < targetUnits) {
      const occupied = new Set(myUnits.map(u => HexUtils.key(u.tacticalHex)));
      const freeHexes = [...state.deployZone]
        .filter(k => !occupied.has(k))
        .map(k => { const { q, r } = HexUtils.fromKey(k); return { q, r, key: k }; });
      if (freeHexes.length > 0) {
        const plan = planDeployment({
          roleMix: doc.roleMix, forceScale: diff.forceScale, freeHexes, roster: state.roster, frontSign,
        });
        const budget = Math.floor(state.cp * diff.cpBudgetFrac);
        let spent = 0;
        let projected = myUnits.length;
        for (const p of plan) {
          if (projected >= targetUnits || spent + 2 > budget) break;
          if (state.placeCohort(p.groupId, p.anchorHex, p.unitType)) { spent += 2; projected += COHORT_SIZE; }
        }
      }
    }

    // --- Commander: refresh role assignment on its cadence (or whenever roles are missing). ---
    if (state.tick - lastCommanderTick >= diff.commanderCadence || roles.size === 0) {
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
