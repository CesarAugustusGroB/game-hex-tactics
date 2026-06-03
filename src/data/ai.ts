import raw from './ai.json';
import type { AiRule } from '../battle/ai/rules';

import type { UnitType } from '../battle/simulate';

export type Doctrine = 'balanced' | 'aggressive' | 'defensive';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DoctrineConfig {
  /** Unit type for each lateral FRONT band, left→right. EXACTLY 3 (a fixed tuple) so the 4th of
   *  GROUP_IDS is unambiguously the reserve — the controller derives `reserveGid` as
   *  `GROUP_IDS[front.length]` and relies on this length being 3. */
  front: [UnitType, UnitType, UnitType];
  /** Unit type of the RESERVE group held behind the front line. */
  reserve: UnitType;
}

export interface DifficultyConfig {
  /** Ticks between a group's decisions. */
  reactionTicks: number;
  /** Fraction of current CP the AI will spend per tick. */
  cpBudgetFrac: number;
  /** Scales wave count in the deploy planner. */
  forceScale: number;
}

/** Counterattack tuning: how "danger of defeat" is blended and how far it lowers the launch bar. */
export interface CounterConfig {
  /** Weight of the VP signal (how close the enemy is to winning / our deficit) in danger. */
  vpWeight: number;
  /** Weight of the observable-pressure signal (raids on our zone, enemy holding centre). */
  pressureWeight: number;
  /** Pressure contribution per enemy already inside our deploy zone. */
  breacherWeight: number;
  /** Pressure contribution per enemy approaching our deploy zone. */
  raiderWeight: number;
  /** Pressure contribution when the enemy alone holds the centre. */
  enemyCenterWeight: number;
  /** Max fraction the per-band launch threshold can be cut at full danger (0..1). */
  maxLaunchReduction: number;
  /** Hex distance out from our deploy zone at which an enemy counts as an approaching raider. */
  raidWatchRadius: number;
}

/** Combat engagement thresholds (hex distances) for the per-type fighting rules. */
export interface CombatConfig {
  /** Enemy within this distance of a cavalry group triggers a charge. */
  chargeReach: number;
  /** Enemy within this distance of a group counts as "in play" (skirmisher unleash). */
  engageRange: number;
  /** This many enemies past the centre into our own half triggers an all-groups repel. */
  homelandRepelThreshold: number;
}

export interface AiConfig {
  /** CP a group may spend amassing before it marches (referenced by the `cpSpentAmassingLt`
   *  condition in the default ruleset). */
  amassCpBudget: number;
  /** Authored behaviour: ordered `condition → action` rules, first match wins. */
  rules: AiRule[];
  counter: CounterConfig;
  combat: CombatConfig;
  doctrines: Record<Doctrine, DoctrineConfig>;
  difficulties: Record<Difficulty, DifficultyConfig>;
}

export const AI: AiConfig = raw as AiConfig;

export const DOCTRINES = Object.keys(AI.doctrines) as Doctrine[];
export const DIFFICULTIES = Object.keys(AI.difficulties) as Difficulty[];
