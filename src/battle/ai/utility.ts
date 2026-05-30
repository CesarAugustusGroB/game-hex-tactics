import type { Team, Unit, OrderMode } from '../simulate';
import { CP_COSTS, type CpIntent } from '../command-points';
import type { AiRole, UtilityWeights } from '../../data/ai';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { CAPTURE_CENTER } from '../../data/game';

/** Deterministic, seedable RNG (mulberry32) so harness runs are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ActionChoice {
  mode: OrderMode;
  heading: number;
  attackTarget: Hex | null;
  intent: CpIntent;
}

export interface ScoreInput {
  team: Team;
  role: AiRole;
  groupUnits: Unit[];
  enemyUnits: Unit[];
  weights: UtilityWeights;
  cp: number;
  getHeight: (h: Hex) => number;
  rng: () => number;
  noise: number;
}

const forwardHeading = (team: Team): number => (team === 'red' ? 2 : 5);

function centroid(units: Unit[]): Hex {
  const q = units.reduce((s, u) => s + u.tacticalHex.q, 0) / units.length;
  const r = units.reduce((s, u) => s + u.tacticalHex.r, 0) / units.length;
  return { q: Math.round(q), r: Math.round(r) };
}

/** The hex a role wants its group to approach. */
function objectiveHex(role: AiRole, groupUnits: Unit[], enemyUnits: Unit[]): Hex {
  switch (role) {
    case 'centerHold': return CAPTURE_CENTER;
    case 'raid':       return enemyUnits.length ? centroid(enemyUnits) : CAPTURE_CENTER;
    case 'defendLine':
    case 'reserve':    return centroid(groupUnits);
  }
}

/** Nearest living enemy to the group centroid, preferring low HP (focus fire). */
function pickTarget(centre: Hex, enemyUnits: Unit[]): Unit | null {
  let best: Unit | null = null, bestScore = Infinity;
  for (const e of enemyUnits) {
    if (e.hp <= 0) continue;
    const score = HexUtils.distance(centre, e.tacticalHex) + e.hp / 50;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

/**
 * Score the candidate actions for one group and return the best AFFORDABLE choice, or null to
 * keep the current order (no CP spent). Pure aside from `rng`. Features are normalized to ~[0,1]
 * and combined with doctrine weights; difficulty noise perturbs the totals before argmax.
 */
export function chooseAction(input: ScoreInput): ActionChoice | null {
  const { team, role, groupUnits, enemyUnits, weights, cp, getHeight, rng, noise } = input;
  if (groupUnits.length === 0) return null;

  const centre = centroid(groupUnits);
  const target = pickTarget(centre, enemyUnits);
  const objective = objectiveHex(role, groupUnits, enemyUnits);
  const distToObjective = HexUtils.distance(centre, objective);
  const distToTarget = target ? HexUtils.distance(centre, target.tacticalHex) : Infinity;

  type Cand = { choice: ActionChoice; base: number };
  const cands: Cand[] = [];
  const fwd = forwardHeading(team);

  const heightAdv = target ? Math.max(0, getHeight(centre) - getHeight(target.tacticalHex)) / 12 : 0;
  const weakness = target ? 1 - Math.min(1, target.hp / 100) : 0;
  const outnumbered = enemyUnits.length > groupUnits.length * 1.5 ? 1 : 0;
  const cpHeadroom = Math.min(1, cp / 12);

  cands.push({
    choice: { mode: 'march', heading: fwd, attackTarget: objective, intent: 'march' },
    base: weights.objective * Math.min(1, distToObjective / 10),
  });

  if (target && distToTarget <= 3) {
    cands.push({
      choice: { mode: 'charge', heading: fwd, attackTarget: target.tacticalHex, intent: 'charge' },
      base: weights.targetWeakness * weakness + weights.height * heightAdv - weights.cpHeadroom * (1 - cpHeadroom),
    });
  }

  if (target && distToTarget <= 4) {
    cands.push({
      choice: { mode: 'unleash', heading: fwd, attackTarget: target.tacticalHex, intent: 'unleash' },
      base: weights.targetWeakness * weakness * 0.8 + weights.objective * 0.3,
    });
  }

  cands.push({
    choice: { mode: 'hold', heading: fwd, attackTarget: centre, intent: 'hold' },
    base: weights.risk * outnumbered + weights.height * (getHeight(centre) / 12) * 0.5
      + (role === 'defendLine' || role === 'reserve' ? 0.4 : 0),
  });

  if (outnumbered && groupUnits.some(u => u.hp < 40)) {
    cands.push({
      choice: { mode: 'retreat', heading: (fwd + 3) % 6, attackTarget: null, intent: 'retreat' },
      base: weights.risk * 1.2,
    });
  }

  let best: ActionChoice | null = null, bestScore = -Infinity;
  for (const c of cands) {
    if (cp < CP_COSTS[c.choice.intent]) continue;
    const score = c.base + (rng() - 0.5) * 2 * noise;
    if (score > bestScore) { bestScore = score; best = c.choice; }
  }
  return best;
}
