// Verifies planDeployment: scales with forceScale, respects roster, and — critically —
// deploys at the FRONT edge with each group in its own lateral band (so the sim's rigid-block
// march can't interlock packed groups). Run: npx tsx scripts/test-ai-deploy.ts
import { planDeployment } from '../src/battle/ai/deploy';
import { AI } from '../src/data/ai';
import { HexUtils } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// Build a realistic deploy zone the way deployZoneFor does: take a hex disk, then keep the top
// py-band (a thin horizontal strip). Supplied unsorted to prove placement is geometry-driven,
// not order-driven (the real game's gridData order bunches into a corner).
const disk: { q: number; r: number; key: string }[] = [];
for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) {
  if (Math.abs(q + r) <= 8) disk.push({ q, r, key: HexUtils.key({ q, r }) });
}
const diskYs = disk.map(h => HexUtils.hexToPixel(h).y);
const minY = Math.min(...diskYs), maxY = Math.max(...diskYs);
const stripTop = minY + (maxY - minY) * 0.25; // top 25% = a deploy strip
const freeHexes = disk.filter(h => HexUtils.hexToPixel(h).y <= stripTop);
const fullRoster = { infantry: 200, cavalry: 200, skirmisher: 200 };
const frontSign = 1; // blue: front edge = larger py (bottom of the top strip, facing centre)

const easy = planDeployment({ roleMix: AI.doctrines.balanced.roleMix, forceScale: AI.difficulties.easy.forceScale, freeHexes, roster: fullRoster, frontSign });
const hard = planDeployment({ roleMix: AI.doctrines.balanced.roleMix, forceScale: AI.difficulties.hard.forceScale, freeHexes, roster: fullRoster, frontSign });

check('easy deploys at least one cohort', easy.length >= 1, `n=${easy.length}`);
check('hard deploys >= easy', hard.length >= easy.length, `hard=${hard.length} easy=${easy.length}`);
check('all groupIds in 1..4', hard.every(p => p.groupId >= 1 && p.groupId <= 4));
check('anchors are distinct', new Set(hard.map(p => `${p.anchorHex.q},${p.anchorHex.r}`)).size === hard.length);

// Front placement: the army's centre of mass leans to the front of the strip (high py for
// frontSign +1). Robust to multi-wave (a group's 2nd cohort necessarily stacks behind its 1st).
const stripYs = freeHexes.map(h => HexUtils.hexToPixel(h).y).sort((a, b) => a - b);
const stripMed = stripYs[Math.floor(stripYs.length / 2)];
const avgAnchorY = hard.reduce((s, p) => s + HexUtils.hexToPixel(p.anchorHex).y, 0) / hard.length;
check('anchors lean to the front of the deploy zone', avgAnchorY >= stripMed,
  `avgY=${Math.round(avgAnchorY)} stripMed=${Math.round(stripMed)}`);

// Lateral separation: each group occupies a disjoint lateral (px) range, so rigid-block march
// can't interlock them. This is the fix for the in-game corner-jam.
const byGroup = new Map<number, number[]>();
for (const p of hard) {
  const x = HexUtils.hexToPixel(p.anchorHex).x;
  const arr = byGroup.get(p.groupId) ?? [];
  arr.push(x); byGroup.set(p.groupId, arr);
}
const ranges = [...byGroup.entries()]
  .map(([g, xs]) => ({ g, min: Math.min(...xs), max: Math.max(...xs) }))
  .sort((a, b) => a.min - b.min);
let separated = true;
for (let i = 1; i < ranges.length; i++) if (ranges[i].min <= ranges[i - 1].max) separated = false;
check('groups deploy in separate lateral bands', separated,
  JSON.stringify(ranges.map(r => ({ g: r.g, min: Math.round(r.min), max: Math.round(r.max) }))));

const noCav = planDeployment({ roleMix: AI.doctrines.aggressive.roleMix, forceScale: 1, freeHexes, roster: { infantry: 200, cavalry: 0, skirmisher: 200 }, frontSign });
check('respects empty cavalry roster', noCav.every(p => p.unitType !== 'cavalry'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
