// One attack group built as horizontal lines: filled front→back, each line centre-out, one unit
// type per line cycling [infantry, skirmisher, cavalry]. Run: npx tsx scripts/test-ai-frontlines.ts
import { planFrontLines } from '../src/battle/ai/deploy';
import type { UnitType, GroupId } from '../src/battle/simulate';
import { HexUtils } from '../src/hex-engine/HexUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

// Wide horizontal rows (blue side → frontSign +1, front = high y). Cells with q=2i, r=-i-d share
// the same pixel-y, so each depth d is one WIDE line of 13 cells — exercises the centre-out fill.
const freeHexes: { q: number; r: number; key: string }[] = [];
for (let d = 0; d <= 8; d++) for (let i = -6; i <= 6; i++) {
  const q = 2 * i, r = -i - d;
  freeHexes.push({ q, r, key: HexUtils.key({ q, r }) });
}

const gid = 1 as GroupId;
const roster: Record<UnitType, number> = { infantry: 200, cavalry: 200, skirmisher: 200 };
const plan = planFrontLines({ groupId: gid, freeHexes, roster, frontSign: 1, waveCohorts: 40 });

const lat = (q: number, r: number) => HexUtils.hexToPixel({ q, r }).x;
const fwd = (q: number, r: number) => HexUtils.hexToPixel({ q, r }).y; // frontSign +1
const xs = freeHexes.map(h => lat(h.q, h.r));
const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
const mean = (ns: number[]) => ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;

check('placed something', plan.length > 0, `n=${plan.length}`);
check('all placements share one groupId', plan.every(p => p.groupId === gid));
check('anchors are distinct', new Set(plan.map(p => HexUtils.key(p.anchorHex))).size === plan.length);

// Lines = maximal contiguous same-type runs in plan order (the planner emits one full line, then
// cycles type for the next).
type Run = { type: UnitType; fwds: number[]; lats: number[] };
const runs: Run[] = [];
for (const p of plan) {
  const f = fwd(p.anchorHex.q, p.anchorHex.r);
  const l = Math.abs(lat(p.anchorHex.q, p.anchorHex.r) - midX);
  const last = runs[runs.length - 1];
  if (last && last.type === p.unitType) { last.fwds.push(f); last.lats.push(l); }
  else runs.push({ type: p.unitType, fwds: [f], lats: [l] });
}
check('forms at least 3 lines', runs.length >= 3, `lines=${runs.length}`);

const cycle: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];
check('type cycles per line (inf→skir→cav…)',
  runs.every((r, i) => r.type === cycle[i % cycle.length]),
  runs.map(r => r.type[0]).join(''));

// Lines fill front→back: each line's mean depth ≤ the line ahead of it (1px float tolerance).
let monotonic = true;
for (let i = 1; i < runs.length; i++) if (mean(runs[i].fwds) > mean(runs[i - 1].fwds) + 1) monotonic = false;
check('lines fill front→back (depth non-increasing)', monotonic,
  runs.map(r => mean(r.fwds).toFixed(0)).join(' → '));

// First line is laid centre-out: lateral offset from centre is non-decreasing in placement order.
const l0 = runs[0].lats;
let centreOut = true;
for (let i = 1; i < l0.length; i++) if (l0[i] < l0[i - 1] - 1) centreOut = false;
check('first line is placed centre-out', centreOut, l0.map(x => x.toFixed(0)).join(','));

// Roster fallback: when the cycle's type is exhausted, the line still builds from remaining stock.
const scarce = planFrontLines({ groupId: gid, freeHexes, frontSign: 1, waveCohorts: 40,
  roster: { infantry: 0, cavalry: 200, skirmisher: 0 } });
check('falls back when a line type is exhausted',
  scarce.length > 0 && scarce.every(p => p.unitType === 'cavalry'), `n=${scarce.length}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
