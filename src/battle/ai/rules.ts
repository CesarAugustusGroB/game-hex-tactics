/**
 * Authored AI behaviour: an ordered list of `condition → action` rules, evaluated top-down,
 * first match wins. Deterministic — no scoring, no noise. The author writes the rules in
 * ai.json; weights only enter later, for rules that offer a choice between alternatives.
 */
import type { UnitType } from '../simulate';

/** What a group can be told to do this tick. Grows as the author writes more behaviour.
 *  - amass:   keep placing cohorts into this band (deploy phase).
 *  - march:   advance toward the centre objective.
 *  - defend:  march back to the threatened spot on our own line (raid interception).
 *  - hold:    stand and anchor with the defensive damage reduction.
 *  - charge:  cavalry lance into a nearby enemy (impact bypasses defence).
 *  - unleash: skirmisher per-unit kite + missile harassment.
 *  - repel:   a mass has pushed into our half; the nearest group(s) march to intercept it. */
export type AiAction = 'amass' | 'march' | 'defend' | 'hold' | 'charge' | 'unleash' | 'repel';

/** Facts a rule can test. `when` is an AND of the present keys (absent keys are ignored).
 *  The perception fields (`isReserve`/`threatened`/`atDefensePos`) are optional: the deploy
 *  (amass) phase omits them, so a `when` that requires one simply never matches there. */
export interface RuleCtx {
  /** Living units in the group. */
  size: number;
  /** Group size has reached its mass target. */
  massed: boolean;
  /** Every living unit is still inside the deploy zone. */
  inZone: boolean;
  /** Cumulative CP this group has spent amassing. */
  cpSpentAmassing: number;
  /** This is the active fill group AND roster + free zone space remain. */
  canAmass: boolean;
  /** This group is the doctrine's reserve band (the line's defender). */
  isReserve?: boolean;
  /** An enemy is in or approaching our own deploy zone (raid threat live). */
  threatened?: boolean;
  /** This group already has a unit in contact with the raid threat — time to hold. */
  atDefensePos?: boolean;
  /** The unit type this group fields (homogeneous per band). */
  groupType?: UnitType;
  /** An enemy is close enough for this group to lance on a charge. */
  enemyInChargeRange?: boolean;
  /** An enemy is close enough to engage (skirmish/harass range). */
  enemyInPlay?: boolean;
  /** This group has a unit standing on the central capture flower. */
  holdsCentre?: boolean;
  /** A losing-size enemy mass has pushed past the centre into our own half (team-wide fact). */
  homelandThreat?: boolean;
}

export interface RuleCondition {
  massed?: boolean;
  inZone?: boolean;
  canAmass?: boolean;
  isReserve?: boolean;
  threatened?: boolean;
  atDefensePos?: boolean;
  groupType?: UnitType;
  enemyInChargeRange?: boolean;
  enemyInPlay?: boolean;
  holdsCentre?: boolean;
  homelandThreat?: boolean;
  /** Matches when `cpSpentAmassing` is strictly below this value. */
  cpSpentAmassingLt?: number;
}

export interface AiRule {
  /** Omitted → always matches (default/fallback rule). */
  when?: RuleCondition;
  do: AiAction;
}

const matches = (when: RuleCondition | undefined, ctx: RuleCtx): boolean => {
  if (!when) return true;
  if (when.massed !== undefined && when.massed !== ctx.massed) return false;
  if (when.inZone !== undefined && when.inZone !== ctx.inZone) return false;
  if (when.canAmass !== undefined && when.canAmass !== ctx.canAmass) return false;
  if (when.isReserve !== undefined && when.isReserve !== ctx.isReserve) return false;
  if (when.threatened !== undefined && when.threatened !== ctx.threatened) return false;
  if (when.atDefensePos !== undefined && when.atDefensePos !== ctx.atDefensePos) return false;
  if (when.groupType !== undefined && when.groupType !== ctx.groupType) return false;
  if (when.enemyInChargeRange !== undefined && when.enemyInChargeRange !== ctx.enemyInChargeRange) return false;
  if (when.enemyInPlay !== undefined && when.enemyInPlay !== ctx.enemyInPlay) return false;
  if (when.holdsCentre !== undefined && when.holdsCentre !== ctx.holdsCentre) return false;
  if (when.homelandThreat !== undefined && when.homelandThreat !== ctx.homelandThreat) return false;
  if (when.cpSpentAmassingLt !== undefined && !(ctx.cpSpentAmassing < when.cpSpentAmassingLt)) return false;
  return true;
};

/** First rule whose `when` matches, or null when none do. */
export function evaluateRules(rules: readonly AiRule[], ctx: RuleCtx): AiAction | null {
  for (const rule of rules) if (matches(rule.when, ctx)) return rule.do;
  return null;
}
