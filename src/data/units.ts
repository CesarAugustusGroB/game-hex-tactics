import raw from './units.json';
import type { UnitType } from '../battle/simulate';

export interface UnitConfig {
  maxHp: number;
  marchSpeed: number;
  chargeSpeed: number;
  chargeImpactDamage: number;
  missileRange?: number;
  missileDamage?: number;
  kiteThreshold?: number;
}

export const UNITS: Record<UnitType, UnitConfig> = raw;

// Legacy-shape derivations — preserve existing per-record exports.
const derive = <K extends keyof UnitConfig>(key: K): Record<UnitType, UnitConfig[K]> =>
  Object.fromEntries(
    Object.entries(UNITS).map(([k, v]) => [k, v[key]]),
  ) as Record<UnitType, UnitConfig[K]>;

export const MAX_HP_BY_TYPE                = derive('maxHp')              as Record<UnitType, number>;
export const MARCH_HEXES_PER_TICK          = derive('marchSpeed')         as Record<UnitType, number>;
export const CHARGE_HEXES_PER_TICK         = derive('chargeSpeed')        as Record<UnitType, number>;
export const CHARGE_IMPACT_DAMAGE_BY_TYPE  = derive('chargeImpactDamage') as Record<UnitType, number>;

// Skirmisher-only fields — the `!` is safe because the JSON guarantees skirmisher
// carries these fields; the wrapper is the single point of that guarantee.
export const SKIRMISHER_MISSILE_RANGE  = UNITS.skirmisher.missileRange!;
export const SKIRMISHER_MISSILE_DAMAGE = UNITS.skirmisher.missileDamage!;
export const SKIRMISHER_KITE_THRESHOLD = UNITS.skirmisher.kiteThreshold!;
