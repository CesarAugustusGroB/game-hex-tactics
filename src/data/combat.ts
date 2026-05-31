import raw from './combat.json';

export interface CombatConfig {
  tickDamage: number;
  charge:  { durationTicks: number; impactRange: number };
  hold:    { reductionPerTick: number; reductionCap: number; autoIdleAfterTicks: number };
  support: { reductionPerAlly: number; reductionCap: number };
  unleash: { maxEngagers: number };
  height:  { bonusPerUnit: number; bonusCap: number };
}

export const COMBAT: CombatConfig = raw;

// Legacy-shape exports — preserve existing call sites unchanged.
export const DAMAGE_PER_TICK            = COMBAT.tickDamage;
export const CHARGE_DURATION_TICKS      = COMBAT.charge.durationTicks;
export const CHARGE_IMPACT_RANGE        = COMBAT.charge.impactRange;
export const HOLD_REDUCTION_PER_TICK    = COMBAT.hold.reductionPerTick;
export const HOLD_REDUCTION_CAP         = COMBAT.hold.reductionCap;
export const HOLD_AUTO_IDLE_AFTER_TICKS = COMBAT.hold.autoIdleAfterTicks;
export const SUPPORT_REDUCTION_PER_ALLY = COMBAT.support.reductionPerAlly;
export const SUPPORT_REDUCTION_CAP      = COMBAT.support.reductionCap;
export const UNLEASH_MAX_ENGAGERS       = COMBAT.unleash.maxEngagers;
export const HEIGHT_BONUS_PER_UNIT      = COMBAT.height.bonusPerUnit;
export const HEIGHT_BONUS_CAP           = COMBAT.height.bonusCap;
