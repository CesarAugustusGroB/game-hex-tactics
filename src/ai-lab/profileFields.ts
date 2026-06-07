import type { TeamAiProfile } from '../data/ai-profile';
import { resolveProfile } from '../data/ai-profile';

/** A numeric, editable profile field. `path` is `key` (top-level) or `block.key` (combat/counter/strategy). */
export interface NumField { group: string; label: string; path: string; step: number; }

export const PROFILE_NUM_FIELDS: NumField[] = [
  { group: 'Core', label: 'reactionTicks', path: 'reactionTicks', step: 1 },
  { group: 'Core', label: 'cpBudgetFrac', path: 'cpBudgetFrac', step: 0.05 },
  { group: 'Core', label: 'forceScale', path: 'forceScale', step: 0.05 },
  { group: 'Combat', label: 'chargeReach', path: 'combat.chargeReach', step: 1 },
  { group: 'Combat', label: 'engageRange', path: 'combat.engageRange', step: 1 },
  { group: 'Combat', label: 'homelandRepelThreshold', path: 'combat.homelandRepelThreshold', step: 1 },
  { group: 'Combat', label: 'repelPerGroup', path: 'combat.repelPerGroup', step: 1 },
  { group: 'Combat', label: 'focusRadius', path: 'combat.focusRadius', step: 1 },
  { group: 'Counter', label: 'vpWeight', path: 'counter.vpWeight', step: 0.05 },
  { group: 'Counter', label: 'pressureWeight', path: 'counter.pressureWeight', step: 0.05 },
  { group: 'Counter', label: 'breacherWeight', path: 'counter.breacherWeight', step: 0.01 },
  { group: 'Counter', label: 'raiderWeight', path: 'counter.raiderWeight', step: 0.01 },
  { group: 'Counter', label: 'enemyCenterWeight', path: 'counter.enemyCenterWeight', step: 0.05 },
  { group: 'Counter', label: 'maxLaunchReduction', path: 'counter.maxLaunchReduction', step: 0.05 },
  { group: 'Counter', label: 'raidWatchRadius', path: 'counter.raidWatchRadius', step: 1 },
  { group: 'Strategy', label: 'raidDeficitFrac', path: 'strategy.raidDeficitFrac', step: 0.05 },
  { group: 'Strategy', label: 'raidGroups', path: 'strategy.raidGroups', step: 1 },
  { group: 'Strategy', label: 'centerFocusVpFrac', path: 'strategy.centerFocusVpFrac', step: 0.05 },
];

/** The EFFECTIVE (resolved) value at `path` — the override if set, else the difficulty/ai.json default. */
export function effectiveNum(p: TeamAiProfile, path: string): number {
  const r = resolveProfile(p) as unknown as Record<string, unknown>;
  const [a, b] = path.split('.');
  return (b ? (r[a] as Record<string, number>)[b] : (r[a] as number));
}

/** Set an override at `path`, returning a NEW profile (immutable). Nested paths spread the block. */
export function setNum(p: TeamAiProfile, path: string, value: number): TeamAiProfile {
  const [a, b] = path.split('.');
  if (!b) return { ...p, [a]: value };
  const block = { ...((p[a as keyof TeamAiProfile] as Record<string, number> | undefined) ?? {}), [b]: value };
  return { ...p, [a]: block };
}
