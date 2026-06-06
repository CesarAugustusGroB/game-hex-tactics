# `test` AI — Rolling Front-Lines Doctrine (Design)

**Date:** 2026-06-06
**Status:** Approved (interactive)

## Goal

Replace the combined-arms *chunk* deployment with a symmetric **front-line builder**:
the AI lays horizontal lines from the centre outward, one unit-type per line (alternating),
all feeding **one** attacking group that rolls forward; a separate reserve group reactively
plugs raids on its own back line (where the player scores).

## Motivation

The player scores by reaching the AI's deploy line. The current `combinedArms` doctrine
deploys disjoint *chunks* (cavalry on flanks, infantry centre, skirmishers rear). The user
wants instead an even, symmetric build: **lines, not chunks** — build a front line centre→
flanks, send it, build the next, send it, as a continuous rolling front of one group; and a
rearguard that reactively covers the lane a detected raider is heading for.

## Decisions (from brainstorming)

- **Line composition:** one unit type per line, cycling `[infantry, skirmisher, cavalry]`
  (line 1 infantry = front wall, line 2 skirmishers, line 3 cavalry, line 4 infantry…).
- **Defense:** reactive to a detected raider/breacher (keep the existing `defend` behaviour).
- **Grouping:** all attack lines in ONE group; the defensive rearguard is a separate group.
- **`raid` dropped:** the rolling front already pushes to the enemy line. `serialWaves` /
  `horizontalFront` / `combinedArms` are folded away for `test`. `fastDeploy` kept.

## Components

### 1. `planFrontLines` — new pure planner (`src/battle/ai/deploy.ts`)

Replaces `planCombinedArmsWave`. Signature mirrors it:

```ts
export interface FrontLinesInput {
  groupId: GroupId;
  freeHexes: { q: number; r: number; key: string }[];
  roster: Readonly<Record<UnitType, number>>;
  frontSign: number;       // +1 blue, -1 red
  waveCohorts: number;     // cohort cap for this plan
  lineTypes?: UnitType[];  // cycle order; default ['infantry','skirmisher','cavalry']
}
export function planFrontLines(input: FrontLinesInput): Placement[];
```

Algorithm:
1. Annotate cells: `lat = px.x`, `fwd = frontSign · px.y`, `midX = (minLat+maxLat)/2`.
2. Bucket cells into **hex rows** by exact `fwd` value; order rows **front→back**
   (descending `fwd`).
3. Walk rows front→back. For each row, order its cells **centre-out** (ascending
   `|lat − midX|`). Place a cohort at each free (un-`claim`ed) cell, `claim()`ing the
   anchor + its 6 neighbours so cohorts don't overlap and consecutive lines are spaced.
4. **Type per line:** the Nth *line actually placed* uses `lineTypes[N % lineTypes.length]`.
   If that type's roster is exhausted, fall back to any type with stock left (so a line
   never stalls the build). A "line placed" increments only when ≥1 cohort was placed in
   that row pass.
5. Stop at `waveCohorts`, roster empty, or cells exhausted. Return ordered `Placement[]`,
   all tagged `groupId`.

Reuse the existing `claim`/`used`-Set + `place()` helpers' pattern from
`planCombinedArmsWave` (which this function supersedes — delete `planCombinedArmsWave`,
`CombinedArmsInput`, and its composition constants).

### 2. Controller (`src/battle/ai/controller.ts`)

- Add `const frontLines = diff.frontLines ?? false;` Remove the `combinedArms` flag usage.
- **Attack group = `GROUP_IDS[0]` (group 1).** When `frontLines`:
  - It is the only amassing attack group. Its amass plan source is `planFrontLines(...)`
    over the whole roster, with `waveCohorts = ceil(attackCap / COHORT_SIZE)`.
  - `attackCap` = the bulk of `targetUnits` (the standing-force cap) routed to this one
    group instead of `bandShare`. Concretely: `bandCap(group1) = targetUnits − bandShare`
    (reserve keeps one `bandShare` for defense); other groups' cap = 0 so they stay dormant.
  - It marches forward continuously (the existing fallback `march` action, loose formation).
- **Reserve group `GROUP_IDS[doc.front.length]` (group 4)** keeps the existing reactive
  `defend` deploy block (lines ~183–207) and `defend` action — unchanged.
- Groups 2 & 3 dormant: `bandCap` 0 ⇒ never amass; `bandReady` true (size 0) ⇒ don't block
  the attack march.
- The `activeFillGid` / `rosterTotal`-vs-per-type eligibility used by `combinedArms` is
  reused for `frontLines` (the attack group draws from the whole roster).
- Keep `typeOfGroup` for the reserve type and the combat-rule slot (inert: test has only
  `defend`).

### 3. Config (`src/data/ai.json`, `src/data/ai.ts`)

`ai.json` test entry:
```json
"test": { "reactionTicks": 10, "cpBudgetFrac": 1.0, "forceScale": 0.7,
          "capabilities": ["defend"], "frontLines": true, "fastDeploy": true }
```
`ai.ts` `DifficultyConfig`: remove `combinedArms?`, add `frontLines?: boolean` with a
doc-comment. (Keep `serialWaves?`/`horizontalFront?` fields — other difficulties/harness may
still set them — but `test` no longer uses them.)

### 4. Validation

- New `scripts/test-ai-frontlines.ts` asserting on `planFrontLines` output:
  - rows fill front→back (max `fwd` cohorts placed before deeper ones);
  - centre-out within a line (a placed cohort's `|lat−midX|` ≤ the next-placed in the same
    row pass);
  - type cycles per line in `[infantry, skirmisher, cavalry]` order;
  - all placements share the one attack `groupId`;
  - falls back gracefully when a type is exhausted.
- `npx tsx scripts/sim-ai-vs-ai.ts --study` — confirm `test` stays strong in the
  **side-bias-cancelled matrix** (the meaningful metric).
- `tsc` (build) clean; existing harness suite unaffected.

## Caveat (carried over from the 2026-06-06 side-bias diagnosis)

Symmetric centre-out lines are mirror-symmetric, so the harness **pure self-play** side-bias
will keep reading ~0/100 for `test` — a deterministic-mirror artifact, **not** a regression.
The side-bias-cancelled matrix is the metric that matters and is unaffected. The live AI
plays `blue` vs a human (never a mirror), so it is a non-issue in actual gameplay.

## Out of scope

- Fixing the harness mirror-determinism (per-match RNG order / deploy jitter) — separate task.
- Predictive/anticipatory defense — explicitly chose reactive.
- Multi-group pulsed line-sends — explicitly chose one continuous rolling group.
