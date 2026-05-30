// Verifies planDeployment scales with forceScale, respects roster, and emits valid groups.
// Run: npx tsx scripts/test-ai-deploy.ts
import { planDeployment } from '../src/battle/ai/deploy';
import { AI } from '../src/data/ai';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const freeHexes = Array.from({ length: 40 }, (_, i) => ({ q: i, r: 0, key: `${i}:0` }));
const fullRoster = { infantry: 200, cavalry: 200, skirmisher: 200 };

const easy = planDeployment({ roleMix: AI.doctrines.balanced.roleMix, forceScale: AI.difficulties.easy.forceScale, freeHexes, roster: fullRoster });
const hard = planDeployment({ roleMix: AI.doctrines.balanced.roleMix, forceScale: AI.difficulties.hard.forceScale, freeHexes, roster: fullRoster });

check('easy deploys at least one cohort', easy.length >= 1, `n=${easy.length}`);
check('hard deploys >= easy', hard.length >= easy.length, `hard=${hard.length} easy=${easy.length}`);
check('all groupIds in 1..4', hard.every(p => p.groupId >= 1 && p.groupId <= 4));
check('anchors are distinct', new Set(hard.map(p => `${p.anchorHex.q}:${p.anchorHex.r}`)).size === hard.length);

const noCav = planDeployment({ roleMix: AI.doctrines.aggressive.roleMix, forceScale: 1, freeHexes, roster: { infantry: 200, cavalry: 0, skirmisher: 200 } });
check('respects empty cavalry roster', noCav.every(p => p.unitType !== 'cavalry'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
