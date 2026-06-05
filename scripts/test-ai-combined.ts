// One wave = one combined-arms group: cavalry on both flanks, an infantry front line that is
// thicker in the centre, skirmishers in the rear ranks. Run: npx tsx scripts/test-ai-combined.ts
import { planCombinedArmsWave } from '../src/battle/ai/deploy';
import type { UnitType, GroupId } from '../src/battle/simulate';
import { HexUtils } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// Wide, shallow deploy strip: q ∈ [-12,12], r ∈ [-3,0] (blue side → frontSign +1, front = high y).
const freeHexes: { q: number; r: number; key: string }[] = [];
for (let q = -12; q <= 12; q++) for (let r = -3; r <= 0; r++)
  freeHexes.push({ q, r, key: HexUtils.key({ q, r }) });

const gid = 1 as GroupId;
const roster: Record<UnitType, number> = { infantry: 200, cavalry: 200, skirmisher: 200 };
const plan = planCombinedArmsWave({ groupId: gid, freeHexes, roster, frontSign: 1, waveCohorts: 20 });

const lat = (q: number, r: number) => HexUtils.hexToPixel({ q, r }).x;
const fwd = (q: number, r: number) => 1 * HexUtils.hexToPixel({ q, r }).y;
const xs = freeHexes.map(h => lat(h.q, h.r));
const minX = Math.min(...xs), maxX = Math.max(...xs), midX = (minX + maxX) / 2, span = maxX - minX;
const of = (t: UnitType) => plan.filter(p => p.unitType === t);
const mean = (ns: number[]) => ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;

check('placed something', plan.length > 0, `n=${plan.length}`);
check('all placements share one groupId', plan.every(p => p.groupId === gid));
check('has all three arms', of('infantry').length > 0 && of('cavalry').length > 0 && of('skirmisher').length > 0,
  `inf=${of('infantry').length} cav=${of('cavalry').length} skr=${of('skirmisher').length}`);

// Cavalry sits on the flanks (far from centre laterally); infantry sits centrally.
const cavLat = of('cavalry').map(p => Math.abs(lat(p.anchorHex.q, p.anchorHex.r) - midX));
const infLat = of('infantry').map(p => Math.abs(lat(p.anchorHex.q, p.anchorHex.r) - midX));
check('cavalry is on the flanks (outer third)', cavLat.every(d => d > span * 0.25), `minCavOffset=${Math.min(...cavLat).toFixed(0)}`);
check('infantry is more central than cavalry', mean(infLat) < mean(cavLat),
  `infMeanOffset=${mean(infLat).toFixed(0)} cavMeanOffset=${mean(cavLat).toFixed(0)}`);

// Cavalry split across BOTH flanks.
check('cavalry on both flanks', of('cavalry').some(p => lat(p.anchorHex.q, p.anchorHex.r) < midX)
  && of('cavalry').some(p => lat(p.anchorHex.q, p.anchorHex.r) > midX));

// Skirmishers sit BEHIND the infantry line (lower fwd = farther from the enemy).
const infFwd = mean(of('infantry').map(p => fwd(p.anchorHex.q, p.anchorHex.r)));
const skrFwd = mean(of('skirmisher').map(p => fwd(p.anchorHex.q, p.anchorHex.r)));
check('skirmishers sit behind the infantry line', skrFwd < infFwd, `skrFwd=${skrFwd.toFixed(0)} infFwd=${infFwd.toFixed(0)}`);

// Centre is thicker: more infantry in the central third than in either flank-adjacent third of the centre.
const centreInf = of('infantry').filter(p => Math.abs(lat(p.anchorHex.q, p.anchorHex.r) - midX) < span * 0.16).length;
const wingInf = of('infantry').length - centreInf;
check('centre of the line is thicker than the wings', centreInf >= wingInf,
  `centreInf=${centreInf} wingInf=${wingInf}`);

// No two cohorts share an anchor (disjoint footprints).
const anchors = plan.map(p => HexUtils.key(p.anchorHex));
check('anchors are distinct', new Set(anchors).size === anchors.length);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
