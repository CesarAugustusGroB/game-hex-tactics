/**
 * Headless AI-config search. Hill-climbs over the fields of an `ai.json` difficulty entry
 * (reactionTicks, cpBudgetFrac, forceScale, capabilities, deploy flags) to find a profile
 * STRONGER than the current `test` difficulty, measured by side-bias-cancelled win-rate vs the
 * ladder [normal, hard, test]. Pure compute (no LLM) — meant to be launched by the 3am cron.
 *
 * It does NOT touch the global combat/counter/strategy blocks (those are shared by every
 * difficulty, so auto-tuning them is unsafe). Doctrine is fixed to 'balanced' (the in-game default)
 * so candidates map 1:1 onto the `test` entry for clean auto-apply.
 *
 * Run: npx tsx scripts/search-ai-config.ts --budget-sec 720 --reps 6
 * Outputs: docs/ai-search/result.json (latest full result), appends docs/ai-search/history.md,
 *          and prints a `SUMMARY <json>` line the cron parses.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runSeries } from '../src/sim/runMatch';
import type { TeamAiProfile } from '../src/data/ai-profile';
import { AI } from '../src/data/ai';
import type { AiCapability } from '../src/data/ai';

const argNum = (flag: string, def: number): number => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const BUDGET_MS = argNum('--budget-sec', 720) * 1000;
const REPS = argNum('--reps', 6);
// Optional run timestamp (the cron has Date; pass it so the report is dated even if the host clock
// is awkward). Falls back to Date.now().
const stampArg = process.argv.indexOf('--stamp');
const STAMP = stampArg >= 0 && process.argv[stampArg + 1] ? process.argv[stampArg + 1] : new Date().toISOString();

const ALL_CAPS: AiCapability[] = ['focusFire', 'charge', 'unleash', 'raid', 'defend', 'repel', 'earlyLaunch'];
const FLAGS = ['frontLines', 'serialWaves', 'horizontalFront', 'fastDeploy'] as const;
type Flag = typeof FLAGS[number];

/** The searchable gene set — exactly the fields a difficulty entry in ai.json can hold. */
interface Cand {
  reactionTicks: number;
  cpBudgetFrac: number;
  forceScale: number;
  capabilities: AiCapability[];
  frontLines: boolean;
  serialWaves: boolean;
  horizontalFront: boolean;
  fastDeploy: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round05 = (v: number) => Math.round(v * 20) / 20;
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

const candToProfile = (c: Cand): TeamAiProfile => ({
  doctrine: AI.difficulties.test.doctrine ?? 'balanced', difficulty: 'normal',
  reactionTicks: c.reactionTicks, cpBudgetFrac: c.cpBudgetFrac, forceScale: c.forceScale,
  capabilities: [...c.capabilities],
  frontLines: c.frontLines, serialWaves: c.serialWaves, horizontalFront: c.horizontalFront, fastDeploy: c.fastDeploy,
});

/** Seed the baseline from the live `test` entry so we always compare against the current champion. */
const baselineCand = (): Cand => {
  const t = AI.difficulties.test;
  return {
    reactionTicks: t.reactionTicks, cpBudgetFrac: t.cpBudgetFrac, forceScale: t.forceScale,
    capabilities: [...t.capabilities],
    frontLines: !!t.frontLines, serialWaves: !!t.serialWaves, horizontalFront: !!t.horizontalFront, fastDeploy: !!t.fastDeploy,
  };
};

const mutate = (c: Cand): Cand => {
  const n: Cand = { ...c, capabilities: [...c.capabilities] };
  const ops = 1 + Math.floor(Math.random() * 2); // 1-2 mutations
  for (let k = 0; k < ops; k++) {
    switch (Math.floor(Math.random() * 5)) {
      case 0: n.reactionTicks = clamp(n.reactionTicks + pick([-3, -2, -1, 1, 2, 3]), 1, 14); break;
      case 1: n.cpBudgetFrac = round05(clamp(n.cpBudgetFrac + pick([-0.1, -0.05, 0.05, 0.1]), 0.3, 1.0)); break;
      case 2: n.forceScale = round05(clamp(n.forceScale + pick([-0.1, -0.05, 0.05, 0.1]), 0.4, 1.2)); break;
      case 3: { const f = pick([...FLAGS]) as Flag; n[f] = !n[f]; break; }
      case 4: {
        const cap = pick(ALL_CAPS);
        const has = n.capabilities.includes(cap);
        n.capabilities = has ? n.capabilities.filter(x => x !== cap) : [...n.capabilities, cap];
        break;
      }
    }
  }
  return n;
};

const LADDER = ['normal', 'hard', 'test'] as const;
const ladderProfiles = LADDER.map(d => ({ d, p: { doctrine: AI.difficulties[d].doctrine ?? 'balanced', difficulty: d } as TeamAiProfile }));

/** Side-bias-cancelled win-rate vs one opponent (run as red AND blue). */
function winRateVs(p: TeamAiProfile, opp: TeamAiProfile, reps: number): number {
  const a = runSeries(p, opp, reps);   // p as red
  const b = runSeries(opp, p, reps);   // p as blue
  return (a.redWins + b.blueWins) / (2 * reps);
}

/** Fitness = mean side-cancelled win-rate across the ladder (0..1). */
function fitness(c: Cand, reps: number): { fit: number; breakdown: Record<string, number> } {
  const p = candToProfile(c);
  const breakdown: Record<string, number> = {};
  let sum = 0;
  for (const { d, p: opp } of ladderProfiles) {
    const wr = winRateVs(p, opp, reps);
    breakdown[d] = Math.round(wr * 100);
    sum += wr;
  }
  return { fit: sum / ladderProfiles.length, breakdown };
}

// ---- search ----
const start = Date.now();
let best = baselineCand();
let { fit: bestFit, breakdown: bestBreak } = fitness(best, REPS);
const baselineFit = bestFit;
const baselineBreak = bestBreak;
let evals = 1, improvements = 0;

console.log(`[search] baseline test fitness=${(baselineFit * 100).toFixed(1)}% breakdown=${JSON.stringify(baselineBreak)} | budget ${BUDGET_MS / 1000}s reps=${REPS}`);

while (Date.now() - start < BUDGET_MS) {
  const cand = mutate(best);
  const { fit } = fitness(cand, REPS);
  evals++;
  if (fit > bestFit + 0.001) {
    // Confirm with 2x reps to avoid chasing sim noise.
    const confCand = fitness(cand, REPS * 2);
    const confBest = fitness(best, REPS * 2);
    if (confCand.fit > confBest.fit) {
      best = cand; bestFit = confCand.fit; bestBreak = confCand.breakdown; improvements++;
      console.log(`[search] +improve #${improvements} fitness=${(bestFit * 100).toFixed(1)}% evals=${evals} ${JSON.stringify(best)}`);
    }
  }
}

// Final confirmation pass at higher reps for both, so the reported margin is trustworthy.
const finalReps = REPS * 3;
const finalBest = fitness(best, finalReps);
const finalBase = fitness(baselineCand(), finalReps);
const marginPts = Math.round((finalBest.fit - finalBase.fit) * 1000) / 10;
const beatsBaseline = finalBest.fit > finalBase.fit;

const result = {
  ranAt: STAMP,
  budgetSec: BUDGET_MS / 1000,
  reps: REPS,
  evals,
  improvements,
  baseline: { fields: baselineCand(), fitnessPct: Math.round(finalBase.fit * 1000) / 10, breakdown: finalBase.breakdown },
  best: { fields: best, fitnessPct: Math.round(finalBest.fit * 1000) / 10, breakdown: finalBest.breakdown },
  beatsBaseline,
  marginPts,
};

const outDir = path.resolve('docs/ai-search');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
const histLine = `- ${STAMP} — evals ${evals}, base ${result.baseline.fitnessPct}% → best ${result.best.fitnessPct}% (margin ${marginPts >= 0 ? '+' : ''}${marginPts}pts)${beatsBaseline ? ` — candidate ${JSON.stringify(best)}` : ' — no improvement'}\n`;
fs.appendFileSync(path.join(outDir, 'history.md'), histLine);

console.log(`\nSUMMARY ${JSON.stringify(result)}`);
