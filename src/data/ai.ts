import raw from './ai.json';
import type { AiRule } from '../battle/ai/rules';

import type { UnitType } from '../battle/simulate';

export type Doctrine = 'balanced' | 'aggressive' | 'defensive';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'test';

export interface DoctrineConfig {
  /** Unit type for each lateral FRONT band, left→right. EXACTLY 3 (a fixed tuple) so the 4th of
   *  GROUP_IDS is unambiguously the reserve — the controller derives `reserveGid` as
   *  `GROUP_IDS[front.length]` and relies on this length being 3. */
  front: [UnitType, UnitType, UnitType];
  /** Unit type of the RESERVE group held behind the front line. */
  reserve: UnitType;
}

/** Tactical behaviours a difficulty executes ON TOP of the always-on baseline (deploy /
 *  march-to-centre / hold). Counter-intuitively these are HANDICAPS, not skill: the head-to-head
 *  ablation (scripts/sim-ai-vs-ai.ts --ablate) showed every one LOSES to the pure centre-rush,
 *  because the win condition makes camping the flag dominant and each behaviour pulls the army off
 *  it (focusFire 8%, repel 23%, … raid 45% — none reach 50%). So the difficulty axis is inverted:
 *  HARD runs the disciplined empty set, EASY carries the full distracting repertoire. */
export type AiCapability = 'focusFire' | 'charge' | 'unleash' | 'raid' | 'defend' | 'repel' | 'earlyLaunch';

export interface DifficultyConfig {
  /** Ticks between a group's decisions. */
  reactionTicks: number;
  /** Fraction of current CP the AI will spend per tick. */
  cpBudgetFrac: number;
  /** Scales wave count in the deploy planner. Held flat across difficulties (below the stall
   *  cliff) — difficulty is decided by `capabilities`, not force size. */
  forceScale: number;
  /** Which smart behaviours this difficulty executes (empty = the dumb-brawler baseline). */
  capabilities: AiCapability[];
  /** Serial-wave attack: amass ONE band to full and launch it, then the next, then the next —
   *  a rolling stream of waves. Default (false) amasses the whole front in parallel and launches
   *  it together. */
  serialWaves?: boolean;
  /** Fast deploy: emit a whole band of placement anchors per tick so the AI brushes units down as
   *  fast as its CP budget allows (like a human click-spamming), instead of the default ~1 cohort
   *  per tick. Placement still SPENDS command points normally — this only lifts the artificial
   *  per-tick anchor cap, not the cost. */
  fastDeploy?: boolean;
  /** Horizontal fronts: each band deploys as a WIDE line spanning the full map width (filling the
   *  front row across, then back), instead of a narrow lateral column. With serialWaves this sends
   *  one full battle line at a time. Supersedes the centre-first column layout. */
  horizontalFront?: boolean;
  /** Combined-arms waves: each serial wave is ONE group laid out as a battle line — infantry front
   *  (centre-thick), skirmishers in the rear, cavalry on the flanks — via planCombinedArmsWave,
   *  instead of one unit type per band. Implies a horizontal front. */
  combinedArms?: boolean;
  /** Rolling front-lines doctrine: ONE attack group is built as successive horizontal lines, each
   *  filled centre→flanks, one unit type per line cycling [infantry, skirmisher, cavalry], and
   *  marched forward as a continuous rolling front. The other front groups stay dormant; the reserve
   *  group defends the back line reactively. Replaces the combined-arms chunk layout for `test`. */
  frontLines?: boolean;
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
  /** This many enemies past the centre into our own half triggers a repel. */
  homelandRepelThreshold: number;
  /** Enemies one diverted group is expected to handle — sets how many of the NEAREST groups peel
   *  off to repel (the rest keep their objective): repelGroups = ceil(massSize / repelPerGroup). */
  repelPerGroup: number;
  /** Radius (hexes) of the enemy cluster around the weakest foe that the army focuses fire on. */
  focusRadius: number;
}

/** Score-aware posture: when behind on VP, convert front bands into raiders. */
export interface StrategyConfig {
  /** Behind by this fraction of pointsToWin (enemyScore − myScore) → start raiding. */
  raidDeficitFrac: number;
  /** How many front bands (lowest-numbered) become raiders while losing. */
  raidGroups: number;
  /** Until myScore reaches this fraction of pointsToWin, the centre is the priority: the army
   *  marches to TAKE/HOLD the flag and raids are suppressed (0.3 × 200 = 60 VP at defaults). */
  centerFocusVpFrac: number;
}

export interface AiConfig {
  /** CP a group may spend amassing before it marches (referenced by the `cpSpentAmassingLt`
   *  condition in the default ruleset). */
  amassCpBudget: number;
  /** Authored behaviour: ordered `condition → action` rules, first match wins. */
  rules: AiRule[];
  counter: CounterConfig;
  combat: CombatConfig;
  strategy: StrategyConfig;
  doctrines: Record<Doctrine, DoctrineConfig>;
  difficulties: Record<Difficulty, DifficultyConfig>;
}

// JSON infers string literals as `string` (e.g. `capabilities`/`front` widen to `string[]`), which
// no longer overlaps the narrowed union/tuple fields — assert through `unknown`.
export const AI: AiConfig = raw as unknown as AiConfig;

export const DOCTRINES = Object.keys(AI.doctrines) as Doctrine[];
export const DIFFICULTIES = Object.keys(AI.difficulties) as Difficulty[];

/** Every tactical behaviour, for tests/harnesses that exercise a behaviour regardless of which
 *  difficulty tier currently carries it (the tier→capability mapping is policy, not the behaviour). */
export const ALL_CAPABILITIES: AiCapability[] = ['focusFire', 'charge', 'unleash', 'raid', 'defend', 'repel', 'earlyLaunch'];
