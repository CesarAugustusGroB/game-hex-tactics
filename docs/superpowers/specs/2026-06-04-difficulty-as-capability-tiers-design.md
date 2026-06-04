# Difficulty as capability tiers, not force

## Problem

The AI's three difficulty knobs (`forceScale`, `cpBudgetFrac`, `reactionTicks`) all scale
one thing: how big and how eagerly-committed the army is. A head-to-head harness
(`scripts/sim-ai-vs-ai.ts`) proved this **inverts** the difficulty axis — harder loses.

Measured (side-bias-cancelled, 24 reps/side):

| pairing | stronger wins |
|---|---|
| hard vs easy | 17% |
| hard vs normal | 27% |
| normal vs easy | 50% |

Mechanism (`--mech`, vs a fixed `normal` opponent):

| D | avgForce | VP/1000t | winrate |
|---|---|---|---|
| easy | 28.7 | 216.5 | 69% |
| normal | 32.4 | 208.3 | 53% |
| hard | 35.8 | 174.3 | 19% |

Force and effectiveness are **negatively correlated**: a bigger force clogs its own deploy
zone and chokes the rigid-block march pipeline (`LEARNINGS.md`: "rigid-block march is fatal
for large touching blobs"), converting fewer units to points. The cliff is at `forceScale`
≈ 1.0 (hard); 0.6/0.85 stay below it.

## Goal

Re-base difficulty on **decision quality**, not army size. The AI already implements every
"smart" behavior (focus fire, charge, unleash/kite, score-aware raids, breach defense,
repel, danger-scaled early launch); today they fire identically at all difficulties. Make
*which behaviors a difficulty executes* the axis. Hold force constant below the stall cliff.

Deterministic capability tiers (no RNG). AI-layer only — no sim/movement changes.

## Design

### Data — `src/data/ai.json` + `src/data/ai.ts`

- `forceScale` → **0.7** for all three difficulties (removes the stall variable; isolates skill).
- Keep `reactionTicks` (12 / 6 / 2) and `cpBudgetFrac` (0.5 / 0.8 / 1.0) — mild
  sharpness/decisiveness signals, harmless once force is flat.
- Add `capabilities` to each difficulty:
  - **easy:** `[]`
  - **normal:** `["focusFire", "charge", "unleash"]`
  - **hard:** `["focusFire", "charge", "unleash", "raid", "defend", "repel", "earlyLaunch"]`
- `ai.ts`: add `export type AiCapability = 'focusFire' | 'charge' | 'unleash' | 'raid' | 'defend' | 'repel' | 'earlyLaunch'`
  and `capabilities: AiCapability[]` on `DifficultyConfig`.

### Always-on baseline (every tier, incl. easy)

Deploy/amass, march to the centre, hold the flag. Easy is a "dumb brawler": plays the core
objective and fights passively on melee contact, but never focus-fires, charges, kites,
raids, or defends its line.

### Controller gating — `src/battle/ai/controller.ts`

Read `diff.capabilities` once (a `Set<AiCapability>` for O(1) `has`). Guard six existing
decision points; everything else is untouched:

| Capability | Gated point | Behavior when absent |
|---|---|---|
| `focusFire` | `focusHex` computation | `focusHex = null` → march targets plain centre |
| `charge` | `'charge'` action dispatch | fall through to the `march` fallback |
| `unleash` | `'unleash'` action dispatch | fall through to the `march` fallback |
| `raid` | `raiderSet` construction | stays empty (never raids) |
| `defend` | defensive-deploy block + `'defend'` action | block skipped; action falls through to march |
| `repel` | `repelSet` construction | stays empty (never peels off to repel) |
| `earlyLaunch` | `danger` in `launchShare` | treat `danger` as 0 → full-bandShare launch bar, no early commit |

The rule engine (`ai.json` rules / `evaluateRules`) is unchanged. Gating happens where an
action is **applied** (downgrade to the march/hold fallback) and where controller-level sets
(`focusHex`, `raiderSet`, `repelSet`) are **built**. A downgraded combat action means the
group just marches/holds — no new code paths.

## Testing / acceptance

1. `npm run test:ai` stays green. Decision tests that assert a gated behavior (e.g.
   `test-ai-strategy.ts`, `test-ai-combat.ts`, `test-ai-counter.ts`) already construct the
   controller at `hard`, so they keep their behavior. Any that use a lower difficulty and
   assert a gated action get bumped to `hard` (the difficulty under which that behavior is
   defined).
2. Acceptance gate — `scripts/sim-ai-vs-ai.ts`:
   - `--study`: red win-rate of the stronger difficulty flips to **> 50%** for both
     `hard vs easy` and `hard vs normal` (monotone: easy < normal < hard).
   - `--mech`: `avgForce` roughly equal across tiers; `VP/1000t` and `winrate` **increase**
     with difficulty.

## Out of scope

- Fixing the rigid-block march stall itself (that was the rejected "Path A"). Force stays
  flat below the cliff instead.
- Any probabilistic / human-feel competence model (rejected in favor of deterministic tiers).
- Doctrine changes (`balanced` / `aggressive` / `defensive` are orthogonal to difficulty).
