/**
 * Authored AI behaviour: an ordered list of `condition → action` rules, evaluated top-down,
 * first match wins. Deterministic — no scoring, no noise. The author writes the rules in
 * ai.json; weights only enter later, for rules that offer a choice between alternatives.
 */

/** What a group can be told to do this tick. Grows as the author writes more behaviour.
 *  - amass:  keep placing cohorts into this band (deploy phase).
 *  - march:  advance toward the centre objective.
 *  - defend: march back to the threatened spot on our own line (raid interception).
 *  - hold:   stand and anchor with the defensive damage reduction. */
export type AiAction = 'amass' | 'march' | 'defend' | 'hold';

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
}

export interface RuleCondition {
  massed?: boolean;
  inZone?: boolean;
  canAmass?: boolean;
  isReserve?: boolean;
  threatened?: boolean;
  atDefensePos?: boolean;
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
  if (when.cpSpentAmassingLt !== undefined && !(ctx.cpSpentAmassing < when.cpSpentAmassingLt)) return false;
  return true;
};

/** First rule whose `when` matches, or null when none do. */
export function evaluateRules(rules: readonly AiRule[], ctx: RuleCtx): AiAction | null {
  for (const rule of rules) if (matches(rule.when, ctx)) return rule.do;
  return null;
}
