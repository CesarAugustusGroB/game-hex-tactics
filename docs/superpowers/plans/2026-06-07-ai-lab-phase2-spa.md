# AI Lab — Phase 2 (SPA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **AI LAB** screen — a per-team parameter editor (Go → saves profiles to localStorage as game defaults) plus an in-browser AI-vs-AI simulation panel — and route to it from the game.

**Architecture:** A declarative field catalog (`src/ai-lab/profileFields.ts`, pure + tested) drives the numeric controls. `src/ai-lab/AiLab.tsx` renders two per-team columns bound to `TeamAiProfile` state (seeded from `loadAiProfiles()`), saves via `saveAiProfiles`, and runs `runSeries()` for the sim. `src/App.tsx` switches between `<GameCanvas/>` and `<AiLab/>`. All foundation pieces (profiles, persistence, `resolveProfile`, `runSeries`) exist from Phase 1.

**Tech Stack:** React + TypeScript, inline-styled (dark theme). Foundation: `src/data/ai-profile.ts` (`TeamAiProfile`, `resolveProfile`, `loadAiProfiles`, `saveAiProfiles`), `src/sim/runMatch.ts` (`runSeries`, `SimResult`), `src/data/ai.ts` (`DOCTRINES`, `DIFFICULTIES`, `ALL_CAPABILITIES`, types `Doctrine`/`Difficulty`/`AiCapability`). Spec: `docs/superpowers/specs/2026-06-07-ai-lab-tuning-spa-design.md`.

**Notes for the engineer:**
- React UI isn't unit-tested here (no DOM test runner configured); Tasks 2-4 are gated by `npm run build` (the tsc + Vite build) plus a manual checklist. Task 1 (pure logic) is TDD with a headless `tsx` test.
- `npm run build` is the real type gate for `.tsx` (the `scripts/` and `src/data`/`src/battle`/`src/sim` are covered by `tsc -b`; React files are covered by the app tsconfig that `npm run build` runs).
- Economy/scoring (global match rules) are **out of scope** for Phase 2 per the spec (deferred). The editor covers the per-team `TeamAiProfile` fields only.

---

### Task 1: Profile field catalog + get/set helpers

**Files:**
- Create: `src/ai-lab/profileFields.ts`
- Create: `scripts/test-ai-profile-fields.ts`

- [ ] **Step 1: Write the failing test** — create `scripts/test-ai-profile-fields.ts`:

```ts
// Catalog-driven numeric field access on a TeamAiProfile. Run: npx tsx scripts/test-ai-profile-fields.ts
import { PROFILE_NUM_FIELDS, effectiveNum, setNum } from '../src/ai-lab/profileFields';
import { profileFromDifficulty } from '../src/data/ai-profile';
import { AI } from '../src/data/ai';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

const p = profileFromDifficulty('test');
check('catalog covers core + combat + counter + strategy (18 fields)', PROFILE_NUM_FIELDS.length === 18, `${PROFILE_NUM_FIELDS.length}`);
check('effective top-level reactionTicks = 10 (test default)', effectiveNum(p, 'reactionTicks') === 10);
check('effective nested combat.chargeReach = ai.json default', effectiveNum(p, 'combat.chargeReach') === AI.combat.chargeReach);

const p2 = setNum(p, 'reactionTicks', 4);
check('setNum top-level override applies', p2.reactionTicks === 4 && effectiveNum(p2, 'reactionTicks') === 4);

const p3 = setNum(p, 'combat.chargeReach', 9);
check('setNum nested override applies', effectiveNum(p3, 'combat.chargeReach') === 9);
check('setNum nested keeps sibling defaults', effectiveNum(p3, 'combat.engageRange') === AI.combat.engageRange);

check('setNum is immutable (original untouched)', p.reactionTicks === undefined && p.combat === undefined);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-ai-profile-fields.ts`
Expected: FAIL — module `../src/ai-lab/profileFields` does not exist.

- [ ] **Step 3: Implement the catalog** — create `src/ai-lab/profileFields.ts`:

```ts
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

/** The EFFECTIVE (resolved) value at `path` — the override if set, else the difficulty/ai.json default.
 *  Used as the input's displayed value so the editor always shows what the AI will actually use. */
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-ai-profile-fields.ts`
Expected: `7/7 passed`.

- [ ] **Step 5: Type-check & commit**

Run: `npx tsc -b` → no errors.
```bash
git add src/ai-lab/profileFields.ts scripts/test-ai-profile-fields.ts
git commit -m "feat(ai-lab): numeric profile field catalog + effective/setNum helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `AiLab.tsx` — the per-team editor + Go

**Files:**
- Create: `src/ai-lab/AiLab.tsx`

- [ ] **Step 1: Implement the editor component** — create `src/ai-lab/AiLab.tsx`:

```tsx
import React, { useState } from 'react';
import type { Team, UnitType } from '../battle/simulate';
import type { TeamAiProfile } from '../data/ai-profile';
import { loadAiProfiles, saveAiProfiles } from '../data/ai-profile';
import { DOCTRINES, DIFFICULTIES, ALL_CAPABILITIES } from '../data/ai';
import type { Doctrine, Difficulty, AiCapability } from '../data/ai';
import { PROFILE_NUM_FIELDS, effectiveNum, setNum } from './profileFields';

const UNIT_TYPES: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];
const FLAGS: Array<'frontLines' | 'serialWaves' | 'horizontalFront' | 'fastDeploy'> =
  ['frontLines', 'serialWaves', 'horizontalFront', 'fastDeploy'];

const box: React.CSSProperties = { background: '#111a2e', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14, marginBottom: 12 };
const label: React.CSSProperties = { fontSize: 10, letterSpacing: 1, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 };
const chip = (on: boolean, accent = '#0ea5e9'): React.CSSProperties => ({ padding: '4px 9px', borderRadius: 8, fontSize: 11, cursor: 'pointer', border: '1px solid rgba(255,255,255,.1)', background: on ? accent : 'rgba(255,255,255,.06)', color: '#e2e8f0' });
const numInput: React.CSSProperties = { width: 64, padding: '3px 6px', background: '#0a1020', color: '#e2e8f0', border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, fontSize: 12 };

const TeamColumn: React.FC<{ team: Team; profile: TeamAiProfile; onChange: (p: TeamAiProfile) => void }> = ({ team, profile, onChange }) => {
  const accent = team === 'red' ? '#dc2626' : '#1d4ed8';
  const caps = new Set(profile.capabilities ?? []);
  const lt = profile.lineTypes ?? ['infantry', 'skirmisher', 'cavalry'];
  const groups = [...new Set(PROFILE_NUM_FIELDS.map(f => f.group))];
  return (
    <div style={{ flex: 1, minWidth: 300 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: accent, marginBottom: 10 }}>{team.toUpperCase()}</div>

      <div style={box}>
        <div style={label}>Difficulty (base)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {DIFFICULTIES.map(d => (
            <button key={d} style={chip(profile.difficulty === d, '#d97706')} onClick={() => onChange({ ...profile, difficulty: d as Difficulty })}>{d}</button>
          ))}
        </div>
        <div style={label}>Doctrine</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DOCTRINES.map(d => (
            <button key={d} style={chip(profile.doctrine === d)} onClick={() => onChange({ ...profile, doctrine: d as Doctrine })}>{d}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label}>Capabilities</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ALL_CAPABILITIES.map(c => (
            <button key={c} style={chip(caps.has(c))} onClick={() => {
              const next = new Set(caps);
              if (next.has(c)) next.delete(c); else next.add(c);
              onChange({ ...profile, capabilities: [...next] as AiCapability[] });
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label}>Deploy flags</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FLAGS.map(f => (
            <button key={f} style={chip(!!profile[f])} onClick={() => onChange({ ...profile, [f]: !profile[f] })}>{f}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label}>Line types (front → back)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <select key={i} value={lt[i] ?? 'infantry'} style={numInput}
              onChange={e => { const next = [...lt]; next[i] = e.target.value as UnitType; onChange({ ...profile, lineTypes: next }); }}>
              {UNIT_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          ))}
        </div>
      </div>

      {groups.map(g => (
        <div key={g} style={box}>
          <div style={label}>{g}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 8px', alignItems: 'center' }}>
            {PROFILE_NUM_FIELDS.filter(f => f.group === g).map(f => (
              <React.Fragment key={f.path}>
                <span style={{ fontSize: 12, color: '#cbd5e1' }}>{f.label}</span>
                <input type="number" step={f.step} value={effectiveNum(profile, f.path)} style={numInput}
                  onChange={e => onChange(setNum(profile, f.path, Number(e.target.value)))} />
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export const AiLab: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [profiles, setProfiles] = useState(() => loadAiProfiles());
  const [saved, setSaved] = useState(false);
  const setTeam = (team: Team, p: TeamAiProfile) => { setProfiles(prev => ({ ...prev, [team]: p })); setSaved(false); };
  const go = () => { saveAiProfiles(profiles); setSaved(true); };

  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: '#e2e8f0', padding: 24, fontFamily: '"Inter", sans-serif', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button onClick={onExit} style={chip(false)}>← BACK TO GAME</button>
        <h1 style={{ fontSize: 22, margin: 0 }}>AI LAB</h1>
        <button onClick={go} style={{ ...chip(true, '#10b981'), marginLeft: 'auto', fontWeight: 800, padding: '8px 16px' }}>GO — save as game defaults</button>
        {saved && <span style={{ color: '#10b981', fontSize: 13 }}>✓ saved</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', maxWidth: 1100 }}>
        <TeamColumn team="red" profile={profiles.red} onChange={p => setTeam('red', p)} />
        <TeamColumn team="blue" profile={profiles.blue} onChange={p => setTeam('blue', p)} />
      </div>
      {/* SIM_PANEL (Task 3 inserts the simulation panel here) */}
    </div>
  );
};
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: succeeds (tsc + Vite). No type errors. (`AiLab` is not yet routed; this confirms it compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/ai-lab/AiLab.tsx
git commit -m "feat(ai-lab): per-team profile editor screen with Go (save to localStorage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Simulation panel in `AiLab.tsx`

**Files:**
- Modify: `src/ai-lab/AiLab.tsx`

- [ ] **Step 1: Add the imports.** In `src/ai-lab/AiLab.tsx`, add to the import block:

```ts
import { runSeries, type SimResult } from '../sim/runMatch';
```

- [ ] **Step 2: Add sim state + run handler** inside `AiLab`, right after the `go` definition:

```ts
  const [reps, setReps] = useState(20);
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    setResult(null);
    // Defer so the "Running…" label paints before the synchronous sim blocks the thread.
    setTimeout(() => {
      setResult(runSeries(profiles.red, profiles.blue, reps));
      setRunning(false);
    }, 20);
  };
```

- [ ] **Step 3: Replace the `{/* SIM_PANEL ... */}` placeholder** with the panel:

```tsx
      <div style={{ ...box, maxWidth: 1100, marginTop: 16 }}>
        <div style={label}>Simulation — RED profile vs BLUE profile</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: '#cbd5e1' }}>reps</span>
          <input type="number" min={1} step={1} value={reps} style={numInput}
            onChange={e => setReps(Math.max(1, Number(e.target.value)))} />
          <button onClick={run} disabled={running}
            style={{ ...chip(true, '#0ea5e9'), padding: '8px 16px', fontWeight: 800, opacity: running ? 0.6 : 1 }}>
            {running ? 'Running…' : 'RUN'}
          </button>
        </div>
        {result && (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <div><b style={{ color: '#dc2626' }}>RED</b> {Math.round(100 * result.redWins / result.reps)}% <span style={{ color: '#64748b' }}>({result.redWins})</span></div>
            <div><b style={{ color: '#1d4ed8' }}>BLUE</b> {Math.round(100 * result.blueWins / result.reps)}% <span style={{ color: '#64748b' }}>({result.blueWins})</span></div>
            <div><b style={{ color: '#94a3b8' }}>DRAW</b> {Math.round(100 * result.draws / result.reps)}% <span style={{ color: '#64748b' }}>({result.draws})</span></div>
            <div>avg score <b style={{ color: '#dc2626' }}>{result.avgScoreRed.toFixed(0)}</b> : <b style={{ color: '#1d4ed8' }}>{result.avgScoreBlue.toFixed(0)}</b></div>
            <div>avg ticks <b>{result.avgTicks.toFixed(0)}</b></div>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Verify the build**

Run: `npm run build` → succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ai-lab/AiLab.tsx
git commit -m "feat(ai-lab): simulation panel — runSeries(red,blue,reps) → win% + scores

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Route to the lab from the game (`App.tsx`)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement the screen switch** — replace the entire contents of `src/App.tsx` with:

```tsx
import { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { AiLab } from './ai-lab/AiLab';

type Screen = 'game' | 'ai-lab';

function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(window.location.search).get('screen') === 'ai-lab' ? 'ai-lab' : 'game');

  if (screen === 'ai-lab') return <AiLab onExit={() => setScreen('game')} />;

  return (
    <div className="App">
      <GameCanvas />
      <button
        onClick={() => setScreen('ai-lab')}
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 200, padding: '10px 16px', borderRadius: 10,
          background: '#0ea5e9', color: '#04121c', border: 'none', fontWeight: 800, cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,.5)',
        }}>
        AI LAB
      </button>
    </div>
  );
}

export default App;
```

(Going to the lab unmounts `GameCanvas`; returning remounts it, so its `useState(() => loadAiProfiles())` initialiser re-reads the just-saved profiles — i.e. **Go → Back → the game uses the new defaults**.)

- [ ] **Step 2: Verify the build**

Run: `npm run build` → succeeds, no type errors.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev -- --port 5174` and in the browser:
1. Game loads; an **AI LAB** button sits bottom-right.
2. Click it → the lab opens with RED and BLUE columns showing `normal` defaults.
3. Change RED difficulty to `test`, toggle a capability, edit a number (e.g. `forceScale`).
4. Set reps to ~10, click **RUN** → after a moment, win% + avg scores + avg ticks appear.
5. Click **GO — save as game defaults** → `✓ saved`.
6. Click **← BACK TO GAME**; open the in-game **AI CONTROL** panel → RED's shown doctrine·difficulty reflect the saved profile (e.g. `balanced · test`).
7. Reload the page with `?screen=ai-lab` appended → opens straight into the lab.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ai-lab): screen switch — AI LAB button + ?screen=ai-lab entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc -b` clean.
- [ ] `npx tsx scripts/test-ai-profile-fields.ts` → `7/7 passed`.
- [ ] `npm run build` → succeeds.
- [ ] Manual checklist from Task 4 Step 3 passes (editor edits, Go persists, sim runs, defaults flow into the game).

## Notes / out of scope

- Economy/scoring (global match rules) editing is deferred (spec second-tier) — would need `runSeries`/the game to accept a match-config override. Add later if wanted.
- No Web Worker: the sim runs on the main thread behind a 20ms defer so "Running…" paints. If large rep counts jank the UI, a Worker is the follow-up.
- `lineTypes` is edited as three front→back dropdowns (covers the practical cases); a variable-length editor is unnecessary now (YAGNI).
