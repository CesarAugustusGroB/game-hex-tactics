import type { AiTickFn, AiTickState } from '../ai';
import type { GroupId, Team, UnitType } from '../simulate';
import type { Doctrine, Difficulty } from '../../data/ai';
import { AI } from '../../data/ai';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { CP_COSTS } from '../command-points';
import { COHORT_SIZE, CAPTURE_CENTER } from '../../data/game';
import { POINTS_TO_WIN } from '../../data/scoring';
import { planDeployment } from './deploy';
import { GROUP_IDS, isGroupSealed } from '../groups';
import { evaluateRules, type RuleCtx } from './rules';
import { perceive, CENTER_KEYS } from './perception';
import type { Unit } from '../simulate';

// Team-forward heading index: red marches up (dir 2), blue marches down (dir 5).
const forwardHeading = (team: Team): number => (team === 'red' ? 2 : 5);

// March moves along `heading` (one of 6 fixed dirs), NOT toward attackTarget — so to send a
// group toward an arbitrary hex (e.g. a raid behind our line) we pick the heading whose single
// step lands closest to the target.
const headingToward = (from: Hex, to: Hex): number => {
  let best = 0, bestD = Infinity;
  HexUtils.directions.forEach((d, i) => {
    const dist = HexUtils.distance({ q: from.q + d.q, r: from.r + d.r }, to);
    if (dist < bestD) { bestD = dist; best = i; }
  });
  return best;
};

const centroidOf = (units: Unit[]): Hex => {
  let q = 0, r = 0;
  for (const u of units) { q += u.tacticalHex.q; r += u.tacticalHex.r; }
  return { q: Math.round(q / units.length), r: Math.round(r / units.length) };
};

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

  // Unit type a group deploys: front groups (1..N) take doc.front[i]; the next group is the reserve.
  const typeOfGroup = (g: GroupId): UnitType => {
    const idx = GROUP_IDS.indexOf(g);
    return idx >= 0 && idx < doc.front.length ? doc.front[idx] : doc.reserve;
  };
  // The band held behind the front line: the doctrine's reserve. It's the group that peels off to
  // intercept raids on our own deploy zone instead of pushing the centre.
  const reserveGid = GROUP_IDS[doc.front.length];

  // Total standing-force cap (half the zone) and the per-band share that spreads it WIDE across the
  // four bands rather than deep in one. Resolved once the deploy zone is known.
  let targetUnits = -1;
  let bandShare = -1;

  const cpSpentAmassing = new Map<GroupId, number>();
  const lastDecisionTick = new Map<GroupId, number>();
  // Round-robin starts for the amass and march scans so a scarce CP budget is shared fairly across
  // bands instead of always feeding the lowest-numbered ones. Cursors advance once PER ACTION TAKEN
  // (not per tick) so the rotation can't resonate with the CP-regen period.
  let amassCursor = 0;
  let marchCursor = 0;

  return (state: AiTickState): void => {
    const myUnits = state.myUnits.filter(u => u.hp > 0);
    // The eyes: enemies in/near our line and who holds the centre. Drives reserve defence below.
    const threat = perceive(state, { raidWatchRadius: AI.counter.raidWatchRadius });
    const threatened = threat.raidThreatHex != null;
    const threatUnits = threatened ? [...threat.breachers, ...threat.raiders] : [];

    // Danger of defeat ∈ [0,1], blending the VP race (how close the enemy is to winning / our
    // deficit) with observable pressure (raiders on our line, enemy holding the centre). It lowers
    // the launch bar below: the more we're losing, the fewer amassed units we wait for before we
    // counterattack — better to commit a partial front than to die fully assembled.
    const c = AI.counter;
    const combat = AI.combat;
    const liveEnemies = state.enemyUnits.filter(u => u.hp > 0);
    const myScore = state.myScore ?? 0;
    const enemyScore = state.enemyScore ?? 0;
    // Blend absolute enemy progress toward the win with how far they're ahead of us, so a lead of
    // our own genuinely lowers the alarm. (max(enemyScore, enemyScore - myScore) collapsed to just
    // enemyScore for any myScore ≥ 0 — the deficit term never counted.)
    const winTarget = state.pointsToWin ?? POINTS_TO_WIN;
    const enemyProgress = enemyScore / winTarget;
    const deficit = Math.max(0, enemyScore - myScore) / winTarget;
    const vpDanger = 0.5 * enemyProgress + 0.5 * deficit;
    const pressure = threat.breachers.length * c.breacherWeight
      + threat.raiders.length * c.raiderWeight
      + (threat.centerControl === 'enemy' ? c.enemyCenterWeight : 0);
    const danger = Math.min(1, Math.max(0, c.vpWeight * Math.min(1, vpDanger) + c.pressureWeight * Math.min(1, pressure)));

    // Enemies that have pushed PAST the centre flag into OUR half (toward our deploy zone). A
    // losing-size mass here would raid through and cost the battle, so it overrides the per-type
    // combat rules: every group marches to intercept the mass (crude all-in for now; tactical later).
    const centreY = HexUtils.hexToPixel(CAPTURE_CENTER).y;
    const inMyHalf = liveEnemies.filter(e => frontSign * (HexUtils.hexToPixel(e.tacticalHex).y - centreY) < 0);
    const homelandThreat = inMyHalf.length >= combat.homelandRepelThreshold;
    const myHalfThreatHex = inMyHalf.length > 0 ? centroidOf(inMyHalf) : null;

    // Score-aware posture: when behind on VP by raidDeficitFrac of the win target, the lowest-
    // numbered front bands become RAIDERS that push through the centre to the enemy line (a second
    // scoring axis). Leading/level keeps the default contest-the-centre + defend posture.
    const strat = AI.strategy;
    const losing = enemyScore - myScore >= winTarget * strat.raidDeficitFrac;
    const raiderSet: ReadonlySet<GroupId> = losing
      ? new Set(GROUP_IDS.slice(0, Math.min(doc.front.length, strat.raidGroups)))
      : new Set<GroupId>();

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
    // Local roster copy: state.roster is a start-of-tick snapshot the host does NOT mutate in place
    // (placeCohort swaps in a fresh map), so we decrement our own copy as we deploy to keep
    // canAmass / canGrowMore honest within the tick.
    const roster: Record<UnitType, number> = { ...state.roster };
    let rosterTotal = roster.infantry + roster.cavalry + roster.skirmisher;
    const budget = Math.floor(state.cp * diff.cpBudgetFrac);
    let cpSpent = 0;

    // Per-group facts. A band may amass while unsealed, below its lateral share, and resources
    // remain. The ai.json rule list turns these facts into amass/march per group.
    const groups = GROUP_IDS.map(g => {
      const groupUnits = myUnits.filter(u => u.groupId === g);
      const sealed = isGroupSealed(myUnits, state.allOrders, state.deployZone, state.team, g);
      return { g, groupUnits, size: groupUnits.length, sealed };
    });

    // --- Amass phase: widen every eligible band in parallel, front-row-first. Scan order starts
    // at a round-robin cursor that advances once PER COHORT PLACED (not per tick) so a scarce CP
    // budget is shared fairly across bands. Per-tick rotation resonated with the slow CP regen
    // (a placement every ~N ticks, N a multiple of the band count) and kept feeding the same
    // band — starving cavalry/skirmisher. Per-placement rotation is timing-independent. ---
    const amassOrder = groups.map((_, i) => groups[(amassCursor + i) % groups.length]);
    for (const grp of amassOrder) {
      const canAmass = !grp.sealed && grp.size < bandShare && freeZoneCount > 0 && rosterTotal > 0;
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
        frontTypes: doc.front, reserveType: doc.reserve, forceScale: diff.forceScale, freeHexes, roster, frontSign,
      }).filter(p => p.groupId === grp.g);

      for (const p of plan) {
        if (grp.size >= bandShare) break;     // this band reached its width share
        if (cpSpent + 2 > budget) break;
        if (!state.placeCohort(p.groupId, p.anchorHex, p.unitType)) continue;
        amassCursor = (amassCursor + 1) % groups.length; // next cohort starts the scan one band on
        cpSpent += 2;
        grp.size += COHORT_SIZE;
        freeZoneCount -= COHORT_SIZE;
        roster[p.unitType] = Math.max(0, roster[p.unitType] - COHORT_SIZE);
        rosterTotal = Math.max(0, rosterTotal - COHORT_SIZE);
        cpSpentAmassing.set(grp.g, (cpSpentAmassing.get(grp.g) ?? 0) + 2);
        for (const c of [p.anchorHex, ...HexUtils.getNeighbors(p.anchorHex)]) occupied.add(HexUtils.key(c));
      }
    }

    // --- March phase: the front is "built" once no band can grow any further — every band has
    // reached its bandShare, or genuinely can't (zone full / its unit type exhausted). Crucially
    // this is NOT "nothing placed this tick": on a CP-starved tick a half-filled band places
    // nothing yet still wants to grow, so it must keep HOLDING — otherwise later (CP-poor) waves
    // launched at a fraction of bandShare while the first (CP-rich) wave filled completely. ---
    // Counterattack: at danger 0 the launch bar is the full bandShare (unchanged behaviour); as
    // danger rises it drops toward COHORT_SIZE, so a half-built front launches early rather than
    // waiting. A band is "ready" once it reaches the (lowered) launchShare OR genuinely can't grow.
    const launchShare = Math.max(COHORT_SIZE, Math.ceil(bandShare * (1 - c.maxLaunchReduction * danger)));
    const frontReady = groups.every(grp => {
      if (grp.size === 0 || grp.sealed) return true;
      if (grp.size >= launchShare) return true;
      const canGrowMore = grp.size < bandShare && freeZoneCount > 0 && (roster[typeOfGroup(grp.g)] ?? 0) > 0;
      return !canGrowMore;
    });
    // Tactical repel: don't pull the WHOLE army back at a mass in our half — only the nearest
    // groups peel off (count scales with the mass), so a screen stays on the objective. The rest
    // see homelandThreat=false below and keep pushing/fighting.
    const repelSet = new Set<GroupId>();
    if (homelandThreat && myHalfThreatHex) {
      const need = Math.min(GROUP_IDS.length, Math.max(1, Math.ceil(inMyHalf.length / combat.repelPerGroup)));
      groups
        .filter(grp => grp.groupUnits.length > 0)
        .map(grp => ({ g: grp.g, d: HexUtils.distance(centroidOf(grp.groupUnits), myHalfThreatHex!) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, need)
        .forEach(x => repelSet.add(x.g));
    }
    const marchOrder = groups.map((_, i) => groups[(marchCursor + i) % groups.length]);
    // Defence is time-critical (raids score on contact), so when our line is threatened let the
    // reserve claim CP before the front spends the budget on centre-march orders. Stable sort keeps
    // the round-robin order among the rest.
    if (threatened) marchOrder.sort((a, b) => Number(b.g === reserveGid) - Number(a.g === reserveGid));
    for (const grp of marchOrder) {
      if (grp.size === 0) continue;
      // grp.size counts units placed THIS tick (absent from the start-of-tick snapshot); those
      // cohorts land in the deploy zone, so a group whose snapshot units are all in-zone (or was
      // empty at snapshot) is still fully in-zone. Use grp.size, not the stale snapshot length.
      const inZone = grp.groupUnits.every(u => state.deployZone.has(HexUtils.key(u.tacticalHex)));

      const isReserve = grp.g === reserveGid;
      // In contact with the raid once any of our units is adjacent to a breacher/raider → hold.
      const atDefensePos = isReserve && threatened
        && grp.groupUnits.some(gu => threatUnits.some(t => HexUtils.distance(gu.tacticalHex, t.tacticalHex) <= 1));

      // Nearest live enemy to this group (drives the charge target/heading); holdsCentre = a foot
      // on the flower. Both are false/Infinity for a just-placed cohort (empty snapshot), so the
      // combat rules can't fire on one — no centroidOf([]) / null-target hazard.
      let nearestEnemy: Unit | null = null;
      let enemyDist = Infinity;
      for (const gu of grp.groupUnits) for (const e of liveEnemies) {
        const d = HexUtils.distance(gu.tacticalHex, e.tacticalHex);
        if (d < enemyDist) { enemyDist = d; nearestEnemy = e; }
      }
      const holdsCentre = grp.groupUnits.some(gu => CENTER_KEYS.has(HexUtils.key(gu.tacticalHex)));

      const action = evaluateRules(AI.rules, {
        size: grp.size, massed: grp.size >= bandShare, inZone,
        cpSpentAmassing: cpSpentAmassing.get(grp.g) ?? 0, canAmass: false,
        isReserve, threatened, atDefensePos,
        groupType: typeOfGroup(grp.g),
        enemyInChargeRange: enemyDist <= combat.chargeReach,
        enemyInPlay: enemyDist <= combat.engageRange,
        holdsCentre, homelandThreat: repelSet.has(grp.g), raider: raiderSet.has(grp.g),
      });

      const last = lastDecisionTick.get(grp.g) ?? -Infinity;
      if (state.tick - last < diff.reactionTicks) continue;
      const order = state.myOrders.find(o => o.groupId === grp.g);

      if (action === 'hold') {
        if (order?.mode === 'hold') continue;                 // already anchoring
        if (cpSpent + CP_COSTS.hold > budget) continue;
        if (state.issueOrder(grp.g, { mode: 'hold' }, 'hold')) {
          cpSpent += CP_COSTS.hold;
          lastDecisionTick.set(grp.g, state.tick);
        }
        continue;
      }

      if (action === 'defend' || action === 'repel') {
        // defend = the reserve plugs a raid on our deploy zone; repel = EVERY group turns back to
        // intercept a mass that pushed into our half. Both march to a hex — heading aimed at it
        // (march follows heading, not attackTarget; attackTarget only ranks units front-to-back so
        // the rear ranks, nearest the threat, lead). A cohort placed THIS tick isn't in the snapshot
        // yet (only in grp.size) → no positions to average; it acts next tick. Guards centroidOf([]).
        if (grp.groupUnits.length === 0) continue;
        const tgt = action === 'defend' ? threat.raidThreatHex! : myHalfThreatHex!;
        // Re-issue only when the needed heading actually changes — keying the skip on attackTarget
        // proximity would leave a stale heading when a moving threat needs a new direction.
        const heading = headingToward(centroidOf(grp.groupUnits), tgt);
        if (order?.mode === 'march' && order.heading === heading) continue;
        if (cpSpent + CP_COSTS.march > budget) continue;
        if (state.issueOrder(grp.g, { mode: 'march', heading, attackTarget: { ...tgt }, looseFormation: true }, 'march')) {
          cpSpent += CP_COSTS.march;
          lastDecisionTick.set(grp.g, state.tick);
        }
        continue;
      }

      if (action === 'raid') {
        if (grp.groupUnits.length === 0) continue;
        // Push forward THROUGH the centre to the enemy back line. March follows heading, so the deep
        // forward target is just front-to-back ranking; the heading carries the band across to raid.
        const fwd = HexUtils.directions[forwardHeading(state.team)];
        const tgt = { q: CAPTURE_CENTER.q + fwd.q * 20, r: CAPTURE_CENTER.r + fwd.r * 20 };
        if (order?.mode === 'march' && order.attackTarget?.q === tgt.q && order.attackTarget?.r === tgt.r) continue;
        if (cpSpent + CP_COSTS.march > budget) continue;
        if (state.issueOrder(grp.g, { mode: 'march', heading: forwardHeading(state.team), attackTarget: tgt, looseFormation: true }, 'march')) {
          cpSpent += CP_COSTS.march;
          lastDecisionTick.set(grp.g, state.tick);
        }
        continue;
      }

      if (action === 'charge') {
        if (order?.mode === 'charge' || !nearestEnemy) continue;   // already lancing / no target
        if (cpSpent + CP_COSTS.charge > budget) continue;
        // charge, like march, advances AND lances along `heading` — aim it at the nearest enemy.
        const heading = headingToward(centroidOf(grp.groupUnits), nearestEnemy.tacticalHex);
        if (state.issueOrder(grp.g, { mode: 'charge', heading }, 'charge')) {
          cpSpent += CP_COSTS.charge;
          lastDecisionTick.set(grp.g, state.tick);
        }
        continue;
      }

      if (action === 'unleash') {
        if (order?.mode === 'unleash') continue;                   // already committed to the unleash
        if (cpSpent + CP_COSTS.unleash > budget) continue;
        // unleash self-acquires targets and kites at missile range — no heading to aim.
        if (state.issueOrder(grp.g, { mode: 'unleash' }, 'unleash')) {
          cpSpent += CP_COSTS.unleash;
          lastDecisionTick.set(grp.g, state.tick);
        }
        continue;
      }

      // action 'march' — the fallback rule (or null, unreachable while the ruleset keeps a
      // condition-less catch-all): push the centre objective.
      if (inZone && !frontReady) continue;
      if (order && order.mode === 'march'
        && order.attackTarget?.q === CAPTURE_CENTER.q && order.attackTarget?.r === CAPTURE_CENTER.r) continue;
      if (cpSpent + CP_COSTS.march > budget) continue;
      // LOOSE march: the AI fields large, tightly-packed bands that touch at their lateral
      // boundaries. A rigid block is all-or-nothing, so a single boundary unit whose forward hex
      // holds an adjacent band's unit freezes the entire 80+-unit band forever — only the first
      // band (clear path) ever advanced. Per-unit advance lets the band flow forward around the
      // few blocked boundary units, so every flank actually attacks.
      if (state.issueOrder(grp.g, { mode: 'march', heading: forwardHeading(state.team), attackTarget: { ...CAPTURE_CENTER }, looseFormation: true }, 'march')) {
        cpSpent += CP_COSTS.march;
        lastDecisionTick.set(grp.g, state.tick);
        marchCursor = (marchCursor + 1) % groups.length; // next march starts the scan one band on
      }
    }
  };
}
