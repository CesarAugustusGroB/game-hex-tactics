# AI rule engine — design (slice 1: amass → march)

**Date:** 2026-05-30
**Status:** approved (slice 1)

## Why

The current AI picks each group's order with a weighted utility scorer (`chooseAction`) plus
role assignment (`commander`). The author wants the opposite: **explicit, deterministic,
authored behavior** — "I tell it what to do." Weights are a later, opt-in layer for rules that
offer a *choice* between alternatives, not the primary mechanism.

## Model

Replace the scorer + roles with an **ordered rule list**, authored in `ai.json`:

```
rules: [ { when?: Condition, do: Action }, ... ]
```

A pure `evaluateRules(rules, ctx) → Action` walks the list and returns the **first** rule whose
`when` matches (a rule with no `when` always matches — the default/fallback). No scoring, no
noise. Per group, per reaction tick.

### Condition vocabulary (initial)

`when` is an AND of the present keys (all must hold; absent keys are ignored):

- `massed: boolean` — group size ≥ `perGroupTarget`.
- `inZone: boolean` — every living unit still inside the deploy zone.
- `cpSpentAmassingLt: number` — cumulative CP this group has spent amassing is below N.
- `canAmass: boolean` — the group is the active fill group AND roster + free zone space remain.

Grows by adding a key + one check in the evaluator. No other change.

### Action vocabulary (initial)

- `amass` — place cohorts into this group (the existing group-discipline deploy mechanic);
  costs CP, tracked per group as `cpSpentAmassing`.
- `march` — issue an advance order toward the front (heading = team-forward, target =
  `CAPTURE_CENTER`). Seals the group, freeing the next to fill.

`charge` / `hold` / `unleash` / `retreat` are added later, as the author writes rules for them.
Until then the AI only amasses and marches — an intentional, approved simplification.

## First ruleset (shared by all groups)

```json
"rules": [
  { "when": { "canAmass": true, "cpSpentAmassingLt": 100 }, "do": "amass" },
  { "do": "march" }
]
```

`amassCpBudget: 100` is the tunable that the rule references (the `100` above is sourced from
it, not hard-coded in the rule). A group amasses until it has spent the budget OR can no longer
place units (roster/space exhausted) OR is already massed — then it marches. `canAmass` guards
against the deadlock where a full/blocked group keeps "amassing" nothing and never marches.

## Integration

- **Replaces:** `chooseAction` (utility scorer) and `assignRoles` (`commander`) usage in
  `controller.ts`. The role abstraction is gone — rules name objectives directly.
- **Keeps:** the deploy *discipline* (`activeFillGroup` / one active group / never refill a
  sealed group) as the mechanism `amass` drives; the difficulty knobs (`reactionTicks`,
  `cpBudgetFrac`, `commanderCadence` is dropped, `forceScale` still sizes the force,
  `decisionNoise` unused for now).
- **`controller.ts` per group, per reaction tick:** build the rule context, `evaluateRules`,
  dispatch the action (`amass` → place cohorts; `march` → issue order).

## Files

- `src/battle/ai/rules.ts` — new: `Condition`, `Action`, `RuleCtx` types + pure
  `evaluateRules`.
- `src/data/ai.json` + `ai.ts` — `rules` list + `amassCpBudget`. (Doctrines collapse to one
  shared ruleset for now; the named-ruleset slot stays for later.)
- `src/battle/ai/controller.ts` — drive groups by `evaluateRules` instead of scorer + roles.
- `src/battle/ai/utility.ts`, `commander.ts` — no longer used by the controller (left in place;
  `forwardHeading` reused by `march`).

## Out of scope (YAGNI)

- Weighted multi-action rules (added when a rule first needs a real choice).
- `charge` / `hold` / `unleash` / `retreat` actions and their conditions.
- Per-group distinct rulesets; named doctrines; reaction to enemy (flanking, focus fire).

## Test plan

`scripts/test-ai-rules.ts` (tsx harness):
- `evaluateRules` returns the first matching rule's action; falls through to the default;
  AND-composes multiple condition keys.
- A fresh group amasses (places cohorts) while under the CP budget, then marches.
- A group that can't place (roster empty) marches instead of stalling.
- `test:ai` group-discipline + battle harnesses still pass (deploy discipline preserved).
