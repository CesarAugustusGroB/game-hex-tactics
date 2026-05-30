import raw from './ai.json';

export type Doctrine = 'balanced' | 'aggressive' | 'defensive';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type AiRole = 'centerHold' | 'defendLine' | 'raid' | 'reserve';

export interface UtilityWeights {
  objective: number;
  targetWeakness: number;
  height: number;
  risk: number;
  cpHeadroom: number;
}

export interface DoctrineConfig {
  roleMix: Record<AiRole, number>;
  weights: UtilityWeights;
}

export interface DifficultyConfig {
  /** A group re-decides every N ticks (cadence). */
  reactionTicks: number;
  /** Random perturbation added to utility scores before argmax (0 = optimal). */
  decisionNoise: number;
  /** Fraction of available CP the AI permits itself to spend per decision window. */
  cpBudgetFrac: number;
  /** Scales how much of the roster the AI deploys. */
  forceScale: number;
  /** Ticks between commander role re-assignments. */
  commanderCadence: number;
}

export interface AiConfig {
  doctrines: Record<Doctrine, DoctrineConfig>;
  difficulties: Record<Difficulty, DifficultyConfig>;
}

export const AI: AiConfig = raw as AiConfig;

export const DOCTRINES: Doctrine[] = ['balanced', 'aggressive', 'defensive'];
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
