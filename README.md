# hex-tactics

A browser-based hex tactics game. Generate a procedural island on a strategic
overview, **dive** into any patch of it to a zoomed-in tactical battlefield, deploy
Roman-style cohorts, and fight a rigid-block formation battle for the central flag.

Single-canvas [PIXI.js](https://pixijs.com/) v8 renderer with a thin React 19 HUD.
The battle simulator is a pure, deterministic function — no React, no PIXI — so it can
be driven headless by the scenario harness.

## Tech stack

- **React 19** + **Vite 8** (TypeScript, strict mode)
- **PIXI.js 8** — all world rendering on one canvas
- **simplex-noise** — procedural terrain
- **gsap** — inter-tick unit movement tweening

## Getting started

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (HMR). Pass `-- --port 5174` if 5173 is taken. |
| `npm run build` | `tsc -b` (project references) then `vite build`. Type errors fail the build. |
| `npm run preview` | Serve the production build. |
| `npm run lint` | ESLint over the repo (flat config in `eslint.config.js`). |
| `npm run sim` | Headless battle harness — runs ~21 formation scenarios against the pure sim and prints results. Run after any change to `src/battle/*`. |
| `npm run test:cp` | Assertion-based test for the Command Points module. |

> On Windows, `npm run sim` may fail to resolve `tsx` from PATH — run `npx tsx scripts/sim-formations.ts` directly.

## How to play

**Strategic view.** You start looking at a procedural island. Toggle **SCAN**, then click
a hex to *dive* — the renderer re-samples that exact patch of the noise field at higher
resolution and drops you into the tactical battlefield. **REGENERATE** rolls a new island.

**Tactical view.** Deploy units into your team's deployment strip (red = bottom, blue =
top), give your groups orders, then press **SPACE** to run the battle. Win by holding the
central 7-hex flag flower uncontested for 20 ticks, or by annihilating the enemy.

Each team starts with a roster of 50 infantry / 50 cavalry / 50 skirmishers and deploys
them as cohorts of 4. Orders cost **Command Points** (regenerating pool, cap 20); the HUD
shows each action's cost and disables it when you can't afford it.

### Units

| Type | HP | Speed | Notes |
| --- | --- | --- | --- |
| Infantry | 100 | slow | Line-holding backbone. |
| Cavalry | 60 | fast | High charge impact, fragile. |
| Skirmisher | 40 | medium | Ranged missiles (range 3), kites when threatened. |

### Controls (tactical view)

| Key | Action |
| --- | --- |
| `SPACE` | Start / pause the battle |
| `<` or `,` | Swap the team you control (red ↔ blue) |
| `1` `2` `3` | Select group |
| `Z` `X` `C` | Place infantry / cavalry / skirmisher (toggles place mode) |
| `T` | Assign mode (reassign units to the selected group) |
| `Q` | Order mode — drag to set a group's destination & facing |
| `A` | March forward / cycle heading within the forward cone |
| `W` | Hold (defensive stance, builds damage reduction) |
| `E` | Charge |
| `R` | Unleash (commit — one-way, only retreat escapes it) |
| `F` | Retreat (disengaged groups only; refunds 80% to roster) |
| `S` | Stop / idle |
| `D` | Cycle formation (line → wedge → column → hex) |
| `Backspace` | Remove the selected group from the field |

Pan with click-drag, zoom with the mouse wheel (anchored to the cursor).

## Project layout

```
src/
  main.tsx, App.tsx          React bootstrap
  components/GameCanvas.tsx   composition root — owns state, wires hooks + HUD
  canvas/                     PIXI layer, decomposed by responsibility
    PixiApp.ts                Application lifecycle, textures, pointer/wheel/ticker
    useBattleTick.ts          tick driver (simulateTick + projectiles + win check)
    HUD.tsx                   React HUD panel
    world-gen.ts              pure generateWorldData()
    render/                   pure draw fns (drawTerrain, drawDetails, drawUnits)
    input/                    input handlers (keyboard, order-drag, paint)
  battle/                     pure sim — no React/PIXI
    simulate.ts               simulateTick + unit/order types + tunables
    terrain.ts                terrain modifier table
    ai.ts                     per-team AI controller registry
    command-points.ts         pure CP cost/debit/regen helpers
  hex-engine/HexUtils.ts      pure flat-top axial hex math (size = 40)
  data/                       *.json values + *.ts typed wrappers (single source of truth)
scripts/                      headless harnesses (sim-formations, snapshot-worldgen, test-command-points)
public/                       sprite + texture assets
```

## Documentation

- **`CLAUDE.md`** / **`AGENTS.md`** — architecture guide for AI coding agents (deep + concise).
- **`LEARNINGS.md`** — accumulated gotchas and design decisions worth remembering.
- **`ARCHITECTURAL_REVIEW.md`** — periodic architecture health check.
- **`docs/superpowers/`** — design specs and implementation plans per feature.
