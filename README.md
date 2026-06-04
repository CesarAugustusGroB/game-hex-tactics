# Hex Tactics

A browser-based real-time tactical battle game played on a procedurally generated hex grid. Two armies (red and blue) of infantry, cavalry, and skirmisher units maneuver across noise-generated terrain — grass, forest, hills, mountains, rivers, sea, sand and snow — fighting under a tick-based simulation. The game runs as a single PixiJS canvas with a thin React HUD; terrain, units, decorations and combat are all drawn and simulated in pure modules separated from the rendering layer.

## Features

- Procedural world generation (Simplex-noise terrain with cohesion passes and rivers).
- Tick-based battle simulation with three unit roles — infantry, cavalry, and skirmishers — each with their own speed, HP, charge and missile behavior.
- Formation system (hex, line, wedge, column) and per-group tactical commands.
- Terrain modifiers affecting defense, movement cost, attrition, and vision, plus a downhill (height) damage bonus.
- Command-points mechanic and an enemy AI hook driven per tick.
- Order-mode drag interaction and a paint mode for placing/assigning units.
- Keyboard controls: per-group commands and global shortcuts (formation cycling, capture/win flow, etc.).
- Capture-zone and win-condition detection with an in-HUD win banner and capture progress.
- Animated water rendered with a custom GLSL filter; three-layer decoration scatter (flowers, rocks, foliage, ripples).
- Headless simulation harness for regression-checking battle behavior, plus a unit-sprite normalization script.

## Tech Stack

- **React 19** + **TypeScript** (Vite-bundled SPA).
- **PixiJS 8** for canvas rendering.
- **GSAP** for animation.
- **simplex-noise** for procedural terrain.
- **Vite 8** dev server / bundler, **ESLint** (flat config).
- **tsx** for running Node-side scripts; **Python** for the unit-normalization tool.

## Getting Started

### Prerequisites

- Node.js (v20+ recommended for Vite 8).
- Python 3 (only needed for the `units:normalize` script).

### Install & run

```bash
npm install
npm run dev        # Vite dev server (default http://localhost:5173)
```

### Other scripts

```bash
npm run build      # tsc -b (project references) then vite build
npm run preview    # serve the production build
npm run lint       # ESLint over the repo
npm run sim        # headless battle harness (scripted scenarios)
npm run test:cp    # command-points test harness
npm run units:normalize   # normalize unit sprites (Python)
```

## Project Structure

```
.
├── index.html
├── package.json
├── vite.config.ts
├── eslint.config.js
├── public/
│   ├── terrain/            # terrain tile textures
│   ├── details/            # decoration sprites (forest, river, rock, grass, ...)
│   └── units/              # unit sprites (+ normalized/)
├── scripts/
│   ├── sim-formations.ts   # headless battle regression harness
│   ├── test-command-points.ts
│   ├── snapshot-worldgen.ts
│   └── normalize-units.py
└── src/
    ├── App.tsx / main.tsx  # React bootstrap
    ├── components/
    │   └── GameCanvas.tsx  # composition root: state, hooks, render wiring
    ├── canvas/
    │   ├── PixiApp.ts       # PIXI Application lifecycle hook
    │   ├── useBattleTick.ts # tick loop driving the simulation
    │   ├── world-gen.ts     # procedural world generation
    │   ├── HUD.tsx          # React HUD panel
    │   ├── constants.ts / terrain-defs.ts / detail-rules.ts
    │   ├── water-filter.ts  # animated water GLSL filter
    │   ├── render/          # drawTerrain / drawDetails / drawUnits
    │   └── input/           # keyboard + drag/paint handlers
    ├── battle/
    │   ├── simulate.ts      # pure battle simulator (simulateTick)
    │   ├── terrain.ts       # terrain modifier table
    │   ├── ai.ts            # enemy AI hook
    │   └── command-points.ts
    ├── hex-engine/
    │   └── HexUtils.ts      # axial hex math (flat-top)
    └── data/                # JSON-backed config (units, combat, terrain, world-gen, details)
```
