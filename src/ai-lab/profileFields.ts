import type { TeamAiProfile } from '../data/ai-profile';
import { resolveProfile } from '../data/ai-profile';

/** A numeric, editable profile field. `path` is `key` (top-level) or `block.key` (combat/counter/strategy).
 *  `desc` is the hover tooltip shown in the editor. */
export interface NumField { group: string; label: string; path: string; step: number; desc: string; }

export const PROFILE_NUM_FIELDS: NumField[] = [
  { group: 'Core', label: 'reactionTicks', path: 'reactionTicks', step: 1, desc: 'Ticks entre decisiones de un grupo. Alto = compromete las órdenes (más fuerte); bajo = cambia de orden y quema CP (thrash).' },
  { group: 'Core', label: 'cpBudgetFrac', path: 'cpBudgetFrac', step: 0.05, desc: 'Fracción del CP actual que la IA gasta por tick. Más alto = despliega y ordena más rápido.' },
  { group: 'Core', label: 'forceScale', path: 'forceScale', step: 0.05, desc: 'Escala el tope del ejército permanente (mitad de la zona × este valor). NO monótono: demasiado grande se atasca.' },
  { group: 'Combat', label: 'chargeReach', path: 'combat.chargeReach', step: 1, desc: 'Distancia (hex) a la que un enemigo dispara una carga de caballería.' },
  { group: 'Combat', label: 'engageRange', path: 'combat.engageRange', step: 1, desc: 'Distancia (hex) a la que un enemigo cuenta como "en juego" (dispara el unleash de skirmishers).' },
  { group: 'Combat', label: 'homelandRepelThreshold', path: 'combat.homelandRepelThreshold', step: 1, desc: 'Cuántos enemigos colados en tu mitad disparan un repel (devolver grupos a interceptar).' },
  { group: 'Combat', label: 'repelPerGroup', path: 'combat.repelPerGroup', step: 1, desc: 'Enemigos que se espera maneje un grupo desviado: define cuántos grupos se devuelven a repeler.' },
  { group: 'Combat', label: 'focusRadius', path: 'combat.focusRadius', step: 1, desc: 'Radio (hex) del clúster enemigo alrededor del más débil sobre el que se concentra el fuego (focusFire).' },
  { group: 'Counter', label: 'vpWeight', path: 'counter.vpWeight', step: 0.05, desc: 'Peso de la señal de VP (qué tan cerca está el enemigo de ganar / tu déficit) en el "peligro de derrota".' },
  { group: 'Counter', label: 'pressureWeight', path: 'counter.pressureWeight', step: 0.05, desc: 'Peso de la presión observable (raiders en tu línea, enemigo en el centro) en el "peligro de derrota".' },
  { group: 'Counter', label: 'breacherWeight', path: 'counter.breacherWeight', step: 0.01, desc: 'Aporte de presión por cada enemigo ya dentro de tu zona de despliegue.' },
  { group: 'Counter', label: 'raiderWeight', path: 'counter.raiderWeight', step: 0.01, desc: 'Aporte de presión por cada enemigo acercándose a tu zona de despliegue.' },
  { group: 'Counter', label: 'enemyCenterWeight', path: 'counter.enemyCenterWeight', step: 0.05, desc: 'Aporte de presión cuando solo el enemigo controla el centro.' },
  { group: 'Counter', label: 'maxLaunchReduction', path: 'counter.maxLaunchReduction', step: 0.05, desc: 'Cuánto baja el umbral de lanzamiento a peligro máximo (0..1). Con earlyLaunch: lanza un frente a medio formar antes.' },
  { group: 'Counter', label: 'raidWatchRadius', path: 'counter.raidWatchRadius', step: 1, desc: 'Distancia (hex) desde tu zona a la que un enemigo ya cuenta como raider entrante.' },
  { group: 'Strategy', label: 'raidDeficitFrac', path: 'strategy.raidDeficitFrac', step: 0.05, desc: 'Si vas detrás por esta fracción del objetivo de VP, las bandas bajas se vuelven raiders.' },
  { group: 'Strategy', label: 'raidGroups', path: 'strategy.raidGroups', step: 1, desc: 'Cuántas bandas (las de menor número) se vuelven raiders mientras vas perdiendo.' },
  { group: 'Strategy', label: 'centerFocusVpFrac', path: 'strategy.centerFocusVpFrac', step: 0.05, desc: 'Hasta banquear esta fracción del objetivo, el centro es la prioridad y los raids se suprimen.' },
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
