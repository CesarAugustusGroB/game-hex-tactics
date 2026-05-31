import type { AiTickFn, AiTickState } from '../ai';
import type { GroupId, Team } from '../simulate';
import type { Doctrine, Difficulty } from '../../data/ai';
import { AI } from '../../data/ai';
import { HexUtils } from '../../hex-engine/HexUtils';
import { CP_COSTS } from '../command-points';
import { COHORT_SIZE, CAPTURE_CENTER } from '../../data/game';
import { planDeployment } from './deploy';
import { GROUP_IDS, isGroupSealed } from '../groups';
import { evaluateRules, type RuleCtx } from './rules';

// Team-forward heading index: red marches up (dir 2), blue marches down (dir 5).
const forwardHeading = (team: Team): number => (team === 'red' ? 2 : 5);

/**
 * Build a stateful per-tick controller for `team`. The deploy doctrine is WIDE-FIRST: every
 * unsealed group fills its own lateral band IN PARALLEL, front-row-first, up to a per-band `share`
 * — so the army forms one continuous front across the whole deploy zone instead of amassing a deep
 * column in a single corner. The line is HELD in the zone until no more can be placed (front built),
 * then the whole front marches off together. Behaviour stays AUTHORED via the ai.json rule list
 * (amass vs. march); the controller only decides which bands are still eligible. Closure state
 * (per-group amass spend, per-group last decision tick) persists; the sim stays pure.
 */
export function makeAiController(team: Team, doctrine: Doctrine, difficulty: Difficulty): AiTickFn {
  const doc = AI.doctrines[doctrine];
  const diff = AI.difficulties[difficulty];
  // Blue's deploy zone is the top strip (small py) marching down → front = larger py; red is the
  // bottom strip marching up → front = smaller py.
  const frontSign = team === 'red' ? -1 : 1;

  // Total standing-force cap (half the zone) and the per-band share that spreads it WIDE across the
  // four bands rather than deep in one. Resolved once the deploy zone is known.
  let targetUnits = -1;
  let bandShare = -1;

  const cpSpentAmassing = new Map<GroupId, number>();
  const lastDecisionTick = new Map<GroupId, number>();

  return (state: AiTickState): void => {
    const myUnits = state.myUnits.filter(u => u.hp > 0);
    if (targetUnits < 0) {
      // Half the zone is the hard-difficulty ceiling; forceScale shrinks it so easier AIs field a
      // smaller standing army. bandShare spreads the cap WIDE across the four bands, not deep.
      targetUnits = Math.max(GROUP_IDS.length * COHORT_SIZE, Math.floor(state.deployZone.size * 0.5 * diff.forceScale));
      bandShare = Math.max(COHORT_SIZE, Math.floor(targetUnits / GROUP_IDS.length));
    }

    // Recycled slot: a group that emptied re-amasses from scratch.
    for (const g of GROUP_IDS) if (!myUnits.some(u => u.groupId === g)) cpSpentAmassing.delete(g);

    const occupied = new Set(myUnits.map(u => HexUtils.key(u.tacticalHex)));
    let freeZoneCount = [...state.deployZone].filter(k => !occupied.has(k)).length;
    const rosterTotal = state.roster.infantry + state.roster.cavalry + state.roster.skirmisher;
    const budget = Math.floor(state.cp * diff.cpBudgetFrac);
    let cpSpent = 0;
    let totalUnits = myUnits.length;

    // Per-group facts. A band may amass while unsealed, below its lateral share, and resources
    // remain. The ai.json rule list turns these facts into amass/march per group.
    const groups = GROUP_IDS.map(g => {
      const groupUnits = myUnits.filter(u => u.groupId === g);
      const sealed = isGroupSealed(myUnits, state.allOrders, state.deployZone, state.team, g);
      return { g, groupUnits, size: groupUnits.length, sealed };
    });

    // --- Amass phase: widen every eligible band in parallel, front-row-first. ---
    let placedAny = false;
    for (const grp of groups) {
      const canAmass = !grp.sealed && grp.size < bandShare
        && totalUnits < targetUnits && freeZoneCount > 0 && rosterTotal > 0;
      const ctx: RuleCtx = {
        size: grp.size,
        massed: grp.size >= bandShare,
        inZone: grp.size > 0 && grp.groupUnits.every(u => state.deployZone.has(HexUtils.key(u.tacticalHex))),
        cpSpentAmassing: cpSpentAmassing.get(grp.g) ?? 0,
        canAmass,
      };
      if (evaluateRules(AI.rules, ctx) !== 'amass' || !canAmass) continue;

      const freeHexes = [...state.deployZone]
        .filter(k => !occupied.has(k))
        .map(k => { const { q, r } = HexUtils.fromKey(k); return { q, r, key: k }; });
      const plan = planDeployment({
        roleMix: doc.roleMix, forceScale: diff.forceScale, freeHexes, roster: state.roster, frontSign,
      }).filter(p => p.groupId === grp.g);

      for (const p of plan) {
        if (grp.size >= bandShare) break;     // this band reached its width share
        if (totalUnits >= targetUnits) break; // total standing-force cap
        if (cpSpent + 2 > budget) break;
        if (!state.placeCohort(p.groupId, p.anchorHex, p.unitType)) continue;
        cpSpent += 2;
        grp.size += COHORT_SIZE;
        totalUnits += COHORT_SIZE;
        freeZoneCount -= COHORT_SIZE;
        placedAny = true;
        cpSpentAmassing.set(grp.g, (cpSpentAmassing.get(grp.g) ?? 0) + 2);
        for (const c of [p.anchorHex, ...HexUtils.getNeighbors(p.anchorHex)]) occupied.add(HexUtils.key(c));
      }
    }

    // --- March phase: the front is "built" once nothing more could be placed this tick. Hold the
    // in-zone line until then so the whole front advances together; groups already outside the zone
    // keep advancing regardless. ---
    const frontBuilt = !placedAny;
    for (const grp of groups) {
      if (grp.size === 0) continue;
      // grp.size counts units placed THIS tick (absent from the start-of-tick snapshot); those
      // cohorts land in the deploy zone, so a group whose snapshot units are all in-zone (or was
      // empty at snapshot) is still fully in-zone. Use grp.size, not the stale snapshot length.
      const inZone = grp.groupUnits.every(u => state.deployZone.has(HexUtils.key(u.tacticalHex)));
      if (inZone && !frontBuilt) continue;

      const last = lastDecisionTick.get(grp.g) ?? -Infinity;
      if (state.tick - last < diff.reactionTicks) continue;
      const order = state.myOrders.find(o => o.groupId === grp.g);
      if (order && order.mode === 'march'
        && order.attackTarget?.q === CAPTURE_CENTER.q && order.attackTarget?.r === CAPTURE_CENTER.r) continue;
      if (cpSpent + CP_COSTS.march > budget) continue;
      if (state.issueOrder(grp.g, { mode: 'march', heading: forwardHeading(state.team), attackTarget: { ...CAPTURE_CENTER } }, 'march')) {
        cpSpent += CP_COSTS.march;
        lastDecisionTick.set(grp.g, state.tick);
      }
    }
  };
}
