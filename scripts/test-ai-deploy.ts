// Verifies planDeployment: scales with forceScale, respects roster, and lays out a THREE-band
// FRONT line (each front group in its own lateral band, at the front edge — so the sim's march
// can't interlock packed groups) with the RESERVE group held BACK. Run: npx tsx scripts/test-ai-deploy.ts
import { planDeployment } from '../src/battle/ai/deploy';
import { AI } from '../src/data/ai';
import { HexUtils } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// Deterministic RNG so the random reserve placement is reproducible in the test.
let seed = 0x1234abcd;
const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

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

const bal = AI.doctrines.balanced;
const easy = planDeployment({ frontTypes: bal.front, reserveType: bal.reserve, forceScale: AI.difficulties.easy.forceScale, freeHexes, roster: fullRoster, frontSign, rng });
const hard = planDeployment({ frontTypes: bal.front, reserveType: bal.reserve, forceScale: AI.difficulties.hard.forceScale, freeHexes, roster: fullRoster, frontSign, rng });

check('easy deploys at least one cohort', easy.length >= 1, `n=${easy.length}`);
check('hard deploys >= easy', hard.length >= easy.length, `hard=${hard.length} easy=${easy.length}`);
check('all groupIds in 1..4', hard.every(p => p.groupId >= 1 && p.groupId <= 4));
check('anchors are distinct', new Set(hard.map(p => `${p.anchorHex.q},${p.anchorHex.r}`)).size === hard.length);

// Front placement: the FRONT groups (1-3) lean to the front of the strip (high py for frontSign
// +1). The reserve (group 4) is excluded — it's deliberately held back.
const front = hard.filter(p => p.groupId !== 4);
const reserve = hard.filter(p => p.groupId === 4);
const stripYs = freeHexes.map(h => HexUtils.hexToPixel(h).y).sort((a, b) => a - b);
const stripMed = stripYs[Math.floor(stripYs.length / 2)];
const frontAvgY = front.reduce((s, p) => s + HexUtils.hexToPixel(p.anchorHex).y, 0) / front.length;
check('front anchors lean to the front of the deploy zone', frontAvgY >= stripMed,
  `frontY=${Math.round(frontAvgY)} stripMed=${Math.round(stripMed)}`);

// Reserve held back: its anchors sit behind the front line (lower py for frontSign +1).
const reserveAvgY = reserve.reduce((s, p) => s + HexUtils.hexToPixel(p.anchorHex).y, 0) / (reserve.length || 1);
check('reserve (group 4) is held behind the front', reserve.length > 0 && reserveAvgY < frontAvgY,
  `reserveY=${Math.round(reserveAvgY)} frontY=${Math.round(frontAvgY)}`);

// Lateral separation: each FRONT group occupies a disjoint lateral (px) range, so rigid-block
// march can't interlock them. (The reserve is free to overlap laterally — it's behind the line.)
const byGroup = new Map<number, number[]>();
for (const p of front) {
  const x = HexUtils.hexToPixel(p.anchorHex).x;
  const arr = byGroup.get(p.groupId) ?? [];
  arr.push(x); byGroup.set(p.groupId, arr);
}
const ranges = [...byGroup.entries()]
  .map(([g, xs]) => ({ g, min: Math.min(...xs), max: Math.max(...xs) }))
  .sort((a, b) => a.min - b.min);
let separated = true;
for (let i = 1; i < ranges.length; i++) if (ranges[i].min <= ranges[i - 1].max) separated = false;
check('front groups deploy in separate lateral bands', separated,
  JSON.stringify(ranges.map(r => ({ g: r.g, min: Math.round(r.min), max: Math.round(r.max) }))));

// Skirmishers are rear SUPPORT: the skirmisher band (G3 in balanced) fills the back rows, behind
// the melee bands (G1 infantry, G2 cavalry). frontSign +1 → front = higher py.
const bandY = (g: number) => {
  const a = hard.filter(p => p.groupId === g);
  return a.reduce((s, p) => s + HexUtils.hexToPixel(p.anchorHex).y, 0) / (a.length || 1);
};
check('skirmisher band (G3) deploys BEHIND the melee bands (G1/G2)',
  bandY(3) < bandY(1) && bandY(3) < bandY(2),
  `skir=${Math.round(bandY(3))} inf=${Math.round(bandY(1))} cav=${Math.round(bandY(2))}`);

const agg = AI.doctrines.aggressive; // cavalry-heavy doctrine
const noCav = planDeployment({ frontTypes: agg.front, reserveType: agg.reserve, forceScale: 1, freeHexes, roster: { infantry: 200, cavalry: 0, skirmisher: 200 }, frontSign, rng });
check('respects empty cavalry roster', noCav.every(p => p.unitType !== 'cavalry'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
