import type { AiTickFn, AiTickState } from '../ai';
import type { GroupId, Team } from '../simulate';
import type { Doctrine, Difficulty } from '../../data/ai';
import { AI } from '../../data/ai';
import { HexUtils } from '../../hex-engine/HexUtils';
import { CP_COSTS } from '../command-points';
import { COHORT_SIZE, CAPTURE_CENTER } from '../../data/game';
import { planDeployment } from './deploy';
import { activeFillGroup } from '../groups';
import { evaluateRules, type RuleCtx } from './rules';

const GROUP_IDS: GroupId[] = [1, 2, 3, 4];

// Team-forward heading index: red marches up (dir 2), blue marches down (dir 5).
const forwardHeading = (team: Team): number => (team === 'red' ? 2 : 5);

/**
 * Build a stateful per-tick controller for `team`. Behaviour is AUTHORED, not scored: each tick,
 * per group, the ordered rule list in `ai.json` is evaluated (first match wins) and the chosen
 * action is dispatched. Slice 1 actions: `amass` (fill the single active group, respecting the
 * group-discipline fill/seal rule) and `march` (advance to the front). Closure state (per-group
 * amass spend, per-group last decision tick) persists across ticks; the sim stays pure.
 */
export function makeAiController(team: Team, doctrine: Doctrine, difficulty: Difficulty): AiTickFn {
  const doc = AI.doctrines[doctrine];
  const diff = AI.difficulties[difficulty];
  // Blue's deploy zone is the top strip (small py) marching down → front = larger py; red is the
  // bottom strip marching up → front = smaller py.
  const frontSign = team === 'red' ? -1 : 1;

  const waves = Math.max(1, Math.round(diff.forceScale * 2));
  // A size label for rule conditions (`massed`); NOT the amass gate — a group amasses until it
  // has spent `amassCpBudget` CP, per the authored ruleset.
  const perGroupTarget = Math.max(2, waves) * COHORT_SIZE;

  // Total standing-force safety cap (half the zone) so one group can't pack the zone solid and
  // interlock the rigid-block march. Resolved once the deploy zone is known.
  let targetUnits = -1;

  const cpSpentAmassing = new Map<GroupId, number>();
  const lastDecisionTick = new Map<GroupId, number>();

  return (state: AiTickState): void => {
    const myUnits = state.myUnits.filter(u => u.hp > 0);
    if (targetUnits < 0) targetUnits = Math.floor(state.deployZone.size * 0.5);

    // Recycled slot: a group that emptied re-amasses from scratch.
    for (const g of GROUP_IDS) if (!myUnits.some(u => u.groupId === g)) cpSpentAmassing.delete(g);

    const af = activeFillGroup(myUnits, state.allOrders, state.deployZone, state.team);
    const occupied = new Set(myUnits.map(u => HexUtils.key(u.tacticalHex)));
    const freeZoneCount = [...state.deployZone].filter(k => !occupied.has(k)).length;
    const rosterTotal = state.roster.infantry + state.roster.cavalry + state.roster.skirmisher;
    const budget = Math.floor(state.cp * diff.cpBudgetFrac);
    let cpSpent = 0;

    for (const g of GROUP_IDS) {
      const groupUnits = myUnits.filter(u => u.groupId === g);
      const size = groupUnits.length;
      const isActive = g === af;
      if (size === 0 && !isActive) continue; // empty group we're not currently filling

      const ctx: RuleCtx = {
        size,
        massed: size >= perGroupTarget,
        inZone: size > 0 && groupUnits.every(u => state.deployZone.has(HexUtils.key(u.tacticalHex))),
        cpSpentAmassing: cpSpentAmassing.get(g) ?? 0,
        // Physical ability to amass: only the active fill group, while roster + zone space and
        // total headroom remain. The CP-budget gate lives in the ruleset (`cpSpentAmassingLt`);
        // the room/roster checks also prevent a full/blocked group from "amassing" nothing.
        canAmass: isActive && myUnits.length < targetUnits && freeZoneCount > 0 && rosterTotal > 0,
      };
      const action = evaluateRules(AI.rules, ctx);

      if (action === 'amass') {
        const freeHexes = [...state.deployZone]
          .filter(k => !occupied.has(k))
          .map(k => { const { q, r } = HexUtils.fromKey(k); return { q, r, key: k }; });
        // Only this group's band — discipline, not a 4-band spread.
        const plan = planDeployment({
          roleMix: doc.roleMix, forceScale: diff.forceScale, freeHexes, roster: state.roster, frontSign,
        }).filter(p => p.groupId === g);
        const otherGroups = myUnits.length - size;
        let projected = size;
        for (const p of plan) {
          // Stop at the group's CP amass budget (the authored gate), the total zone cap, or the
          // per-tick CP budget.
          if ((cpSpentAmassing.get(g) ?? 0) + 2 > AI.amassCpBudget) break;
          if (otherGroups + projected >= targetUnits) break;
          if (cpSpent + 2 > budget) break;
          if (state.placeCohort(p.groupId, p.anchorHex, p.unitType)) {
            cpSpent += 2;
            projected += COHORT_SIZE;
            cpSpentAmassing.set(g, (cpSpentAmassing.get(g) ?? 0) + 2);
            for (const c of [p.anchorHex, ...HexUtils.getNeighbors(p.anchorHex)]) occupied.add(HexUtils.key(c));
          }
        }
      } else if (action === 'march') {
        const last = lastDecisionTick.get(g) ?? -Infinity;
        if (state.tick - last < diff.reactionTicks) continue;
        const order = state.myOrders.find(o => o.groupId === g);
        // Already marching to the front → don't re-issue (wastes CP).
        if (order && order.mode === 'march'
          && order.attackTarget?.q === CAPTURE_CENTER.q && order.attackTarget?.r === CAPTURE_CENTER.r) continue;
        if (cpSpent + CP_COSTS.march > budget) continue;
        if (state.issueOrder(g, { mode: 'march', heading: forwardHeading(state.team), attackTarget: { ...CAPTURE_CENTER } }, 'march')) {
          cpSpent += CP_COSTS.march;
          lastDecisionTick.set(g, state.tick);
        }
      }
    }
  };
}
