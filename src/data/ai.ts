import raw from './ai.json';
import type { AiRule } from '../battle/ai/rules';

import type { UnitType } from '../battle/simulate';

export type Doctrine = 'balanced' | 'aggressive' | 'defensive';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DoctrineConfig {
  /** Unit type for each lateral FRONT band, left→right. Length = number of front groups (3). */
  front: UnitType[];
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

export interface AiConfig {
  /** CP a group may spend amassing before it marches (referenced by the `cpSpentAmassingLt`
   *  condition in the default ruleset). */
  amassCpBudget: number;
  /** Authored behaviour: ordered `condition → action` rules, first match wins. */
  rules: AiRule[];
  doctrines: Record<Doctrine, DoctrineConfig>;
  difficulties: Record<Difficulty, DifficultyConfig>;
}

export const AI: AiConfig = raw as AiConfig;

export const DOCTRINES = Object.keys(AI.doctrines) as Doctrine[];
export const DIFFICULTIES = Object.keys(AI.difficulties) as Difficulty[];
