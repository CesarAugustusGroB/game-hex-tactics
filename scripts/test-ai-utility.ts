// Verifies chooseAction picks sensible actions and respects CP affordability.
// Run: npx tsx scripts/test-ai-utility.ts
import { chooseAction, makeRng } from '../src/battle/ai/utility';
import { AI } from '../src/data/ai';
import type { Unit, GroupId, UnitType } from '../src/battle/simulate';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const mk = (id: string, team: 'red' | 'blue', q: number, r: number, hp = 100, unitType: UnitType = 'infantry'): Unit => ({
  id, team, unitType, tacticalHex: { q, r }, homeHex: { q, r },
  groupId: 1 as GroupId, hp, state: 'idle', nextMoveTick: 0, visionRadius: 1,
});

const getHeight = () => 10;
const w = AI.doctrines.balanced.weights;

const far = chooseAction({
  team: 'blue', role: 'centerHold', groupUnits: [mk('g', 'blue', 0, 8)], enemyUnits: [],
  weights: w, cp: 50, current: undefined, getHeight, rng: makeRng(1), noise: 0,
});
check('marches toward objective when far', far?.mode === 'march', `mode=${far?.mode}`);

const engage = chooseAction({
  team: 'blue', role: 'raid', groupUnits: [mk('g', 'blue', 0, 0)], enemyUnits: [mk('e', 'red', 1, 0, 15)],
  weights: AI.doctrines.aggressive.weights, cp: 50, current: undefined, getHeight, rng: makeRng(2), noise: 0,
});
check('engages adjacent weak enemy', engage?.mode === 'charge' || engage?.mode === 'unleash', `mode=${engage?.mode}`);

const broke = chooseAction({
  team: 'blue', role: 'raid', groupUnits: [mk('g', 'blue', 0, 0)], enemyUnits: [mk('e', 'red', 1, 0, 15)],
  weights: w, cp: 0, current: undefined, getHeight, rng: makeRng(3), noise: 0,
});
check('no action when nothing affordable at 0 CP', broke === null, `mode=${broke?.mode}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
