import { AI } from './ai';
import type { Doctrine, Difficulty, AiCapability, CombatConfig, CounterConfig, StrategyConfig } from './ai';
import type { UnitType } from '../battle/simulate';

/** Default per-line unit-type cycle for the frontLines doctrine (mirrors planFrontLines' default). */
export const DEFAULT_LINE_TYPES: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];

/** Per-team override of every AI knob. Unset fields fall back to the chosen difficulty's defaults
 *  (and to the global ai.json blocks for combat/counter/strategy). */
export interface TeamAiProfile {
  doctrine: Doctrine;
  difficulty: Difficulty;
  reactionTicks?: number;
  cpBudgetFrac?: number;
  forceScale?: number;
  capabilities?: AiCapability[];
  serialWaves?: boolean;
  fastDeploy?: boolean;
  horizontalFront?: boolean;
  frontLines?: boolean;
  lineTypes?: UnitType[];
  combat?: Partial<CombatConfig>;
  counter?: Partial<CounterConfig>;
  strategy?: Partial<StrategyConfig>;
}

/** A profile with every field filled in (overrides merged over ai.json). */
export interface ResolvedProfile {
  doctrine: Doctrine;
  reactionTicks: number;
  cpBudgetFrac: number;
  forceScale: number;
  capabilities: AiCapability[];
  serialWaves: boolean;
  fastDeploy: boolean;
  horizontalFront: boolean;
  frontLines: boolean;
  lineTypes: UnitType[];
  combat: CombatConfig;
  counter: CounterConfig;
  strategy: StrategyConfig;
}

export function resolveProfile(p: TeamAiProfile): ResolvedProfile {
  const base = AI.difficulties[p.difficulty];
  return {
    doctrine: p.doctrine,
    reactionTicks: p.reactionTicks ?? base.reactionTicks,
    cpBudgetFrac: p.cpBudgetFrac ?? base.cpBudgetFrac,
    forceScale: p.forceScale ?? base.forceScale,
    capabilities: p.capabilities ?? base.capabilities,
    serialWaves: p.serialWaves ?? base.serialWaves ?? false,
    fastDeploy: p.fastDeploy ?? base.fastDeploy ?? false,
    horizontalFront: p.horizontalFront ?? base.horizontalFront ?? false,
    frontLines: p.frontLines ?? base.frontLines ?? false,
    lineTypes: p.lineTypes ?? DEFAULT_LINE_TYPES,
    combat: { ...AI.combat, ...p.combat },
    counter: { ...AI.counter, ...p.counter },
    strategy: { ...AI.strategy, ...p.strategy },
  };
}

export function profileFromDifficulty(difficulty: Difficulty, doctrine?: Doctrine): TeamAiProfile {
  return { doctrine: doctrine ?? AI.difficulties[difficulty].doctrine ?? 'balanced', difficulty };
}

export const AI_PROFILES_KEY = 'hex-tactics:ai-profiles';

export interface AiProfiles { red: TeamAiProfile; blue: TeamAiProfile; }

const defaultProfiles = (): AiProfiles => ({
  red: profileFromDifficulty('normal'),
  blue: profileFromDifficulty('normal'),
});

/** Read saved per-team profiles. Returns defaults when storage is unavailable, empty, or corrupt. */
export function loadAiProfiles(): AiProfiles {
  try {
    if (typeof localStorage === 'undefined') return defaultProfiles();
    const raw = localStorage.getItem(AI_PROFILES_KEY);
    if (!raw) return defaultProfiles();
    const parsed = JSON.parse(raw) as Partial<AiProfiles>;
    if (!parsed || !parsed.red || !parsed.blue) return defaultProfiles();
    return { red: parsed.red, blue: parsed.blue };
  } catch {
    return defaultProfiles();
  }
}

/** Persist per-team profiles. No-op when storage is unavailable (headless). */
export function saveAiProfiles(p: AiProfiles): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AI_PROFILES_KEY, JSON.stringify(p));
}
