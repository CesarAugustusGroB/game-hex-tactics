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
  reactionTicks: number;
  decisionNoise: number;
  cpBudgetFrac: number;
  forceScale: number;
  commanderCadence: number;
}

export interface AiConfig {
  doctrines: Record<Doctrine, DoctrineConfig>;
  difficulties: Record<Difficulty, DifficultyConfig>;
}

export const AI: AiConfig = raw as AiConfig;

export const DOCTRINES = Object.keys(AI.doctrines) as Doctrine[];
export const DIFFICULTIES = Object.keys(AI.difficulties) as Difficulty[];
