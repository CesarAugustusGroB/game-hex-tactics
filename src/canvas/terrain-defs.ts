// All terrain data lives in src/data/terrain.json with two wrappers:
//   src/data/terrain.ts       — canvas-side (parses hex colors)
//   src/data/terrain-mods.ts  — sim-side (no PIXI dependency)
// This file is kept as a re-export shim so existing canvas imports (HUD.tsx, etc.)
// don't need to migrate paths.
export type { TerrainDef } from '../data/terrain';
export { TERRAINS } from '../data/terrain';
