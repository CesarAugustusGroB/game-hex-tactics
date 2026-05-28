import { createNoise2D } from 'simplex-noise';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { WORLD_GEN, DIVE_ZOOM, MAP_TYPES, MAP_TYPE_IDS, type MapTypeId, type ShapePrimitive } from '../data/world-gen';
import { mulberry32 } from '../utils/rng';

export interface ShapeCtx {
  gridRadius: number;
  intercept: number;
  exponent: number;
  coastAngle: number; // radians; seed-derived, used by the 'linear' primitive
}

// Elevation-shaping multiplier per macro-shape archetype. Multiplies the
// normalized [0,1] noise elevation before bucketing. `radial` is identical
// to the original island falloff.
export function shapeMult(shape: ShapePrimitive, q: number, r: number, ctx: ShapeCtx): number {
  if (shape === 'flat') return 1;
  if (shape === 'linear') {
    const proj = q * Math.cos(ctx.coastAngle) + r * Math.sin(ctx.coastAngle);
    const tNorm = Math.min(1, Math.max(0, (proj / ctx.gridRadius + 1) / 2));
    return Math.max(0, ctx.intercept - Math.pow(1 - tNorm, ctx.exponent));
  }
  const d = Math.sqrt(q * q + r * r + q * r) / ctx.gridRadius;
  if (shape === 'invertedRadial') {
    return Math.max(0, ctx.intercept - Math.pow(1 - Math.min(1, d), ctx.exponent));
  }
  // radial
  return Math.max(0, ctx.intercept - Math.pow(d, ctx.exponent));
}

export interface GenSettings {
  mapType: MapTypeId;
  seed: number;
  noiseOffset: { q: number; r: number };
  resolution: number;
}

export interface WorldGenInput {
  settings: GenSettings;
  gridRadius: number;
  viewMode: 'STRATEGIC' | 'TACTICAL';
}

export type MapTypeChoice = MapTypeId | 'random';

const SHAPE_SALT = 0x9e3779b9;
const RIVER_SALT = 0x85ebca6b;
const TYPE_SALT  = 0xc2b2ae35;

// Tactical river thickening must never convert water or beach into RIVER. Flooding
// SEA/DEEP_SEA creates walkable "bridges" across open water (the sim consults
// isWalkable per hex); flooding SAND eats the coastline. RIVER only spreads onto land.
export const canThickenToRiver = (type: string): boolean =>
  type !== 'SEA' && type !== 'DEEP_SEA' && type !== 'SAND';

export function resolveMapType(choice: MapTypeChoice, seed: number): MapTypeId {
  if (choice !== 'random') return choice;
  const idx = Math.floor(mulberry32((seed ^ TYPE_SALT) >>> 0)() * MAP_TYPE_IDS.length);
  return MAP_TYPE_IDS[idx];
}

export interface WorldGenOutput {
  gridData: { hex: Hex; type: string }[];
}

// Tactical battlefield is a wide rectangle (N-S battle axis preserved).
// Pixel half-extents centred at (0,0); iteration filters by HexUtils.hexToPixel
// because a pure axial-rectangle is sheared into a parallelogram by the flat-top
// q→x,y skew. The axial bounding box is intentionally generous to cover the
// half-extents after the skew.
const TACTICAL_HALF_W = 2000;
const TACTICAL_HALF_H = 1000;
const TACTICAL_BBOX_Q = 50;
const TACTICAL_BBOX_R = 30;

export function generateWorldData(input: WorldGenInput): WorldGenOutput {
  const { settings, gridRadius, viewMode } = input;
  const newMap = new Map<string, string>();
  const elevationCache = new Map<string, number>();

  const noise = createNoise2D(mulberry32(settings.seed));
  const shapeRng = mulberry32((settings.seed ^ SHAPE_SALT) >>> 0);
  const riverRng = mulberry32((settings.seed ^ RIVER_SALT) >>> 0);

  const cfg = MAP_TYPES[settings.mapType];
  const w = cfg.waterLevel;
  const m = cfg.mountainLevel;
  const b = { ...WORLD_GEN.bucket, ...cfg.bucket };
  const ctx: ShapeCtx = {
    gridRadius,
    intercept: WORLD_GEN.falloff.intercept,
    exponent: WORLD_GEN.falloff.exponent,
    coastAngle: shapeRng() * Math.PI * 2,
  };

  // Note: bucketing never emits ROCKY — it exists only as a paint-mode terrain.
  const bucket = (e: number): string => {
    if (e < w * b.deepSeaMult)    return 'DEEP_SEA';
    if (e < w)                    return 'SEA';
    if (e < w + b.sandOffset)     return 'SAND';
    if (e < m * b.forestMult)     return 'GRASSLAND';
    if (e < m * b.hillMult)       return 'FOREST';
    if (e < m)                    return 'HILL';
    if (e < m + b.mountainOffset) return 'MOUNTAIN';
    return 'SNOW';
  };

  // Tactical applies the SAME shaping multiplier the strategic view used at the
  // clicked hex, uniformly across every tactical hex (so the dive matches the
  // strategic patch). For 'flat' this is 1 (tactical == strategic); for the
  // falloff shapes it is the active primitive evaluated once at the dive point.
  const tacticalElevationMult = (() => {
    if (viewMode === 'STRATEGIC') return 1; // unused
    const diveStrategicQ = settings.noiseOffset.q / DIVE_ZOOM;
    const diveStrategicR = settings.noiseOffset.r / DIVE_ZOOM;
    return shapeMult(cfg.shape, diveStrategicQ, diveStrategicR, ctx);
  })();

  const sampleElevation = (q: number, r: number): number => {
    const nx = (q + settings.noiseOffset.q) / settings.resolution;
    const ny = (r + settings.noiseOffset.r) / settings.resolution;
    let e = (noise(nx, ny) + 0.4 * noise(nx * 2.2, ny * 2.2)) / 1.4;
    e = (e + 1) / 2;
    e *= viewMode === 'STRATEGIC' ? shapeMult(cfg.shape, q, r, ctx) : tacticalElevationMult;
    return e;
  };

  // 1. Smooth Elevation Sampling
  if (viewMode === 'STRATEGIC') {
    for (let q = -gridRadius; q <= gridRadius; q++) {
      for (let r = Math.max(-gridRadius, -q - gridRadius); r <= Math.min(gridRadius, -q + gridRadius); r++) {
        const e = sampleElevation(q, r);
        const key = HexUtils.key({ q, r });
        newMap.set(key, bucket(e));
        elevationCache.set(key, e);
      }
    }
  } else {
    for (let q = -TACTICAL_BBOX_Q; q <= TACTICAL_BBOX_Q; q++) {
      for (let r = -TACTICAL_BBOX_R; r <= TACTICAL_BBOX_R; r++) {
        const p = HexUtils.hexToPixel({ q, r });
        if (Math.abs(p.x) > TACTICAL_HALF_W || Math.abs(p.y) > TACTICAL_HALF_H) continue;
        const e = sampleElevation(q, r);
        const key = HexUtils.key({ q, r });
        newMap.set(key, bucket(e));
        elevationCache.set(key, e);
      }
    }
  }

  // 2. Cohesion Pass: snap a hex to its neighbours' majority type when >3 of 6 agree.
  //    Smooths isolated specks and ragged biome edges (not only single-hex islands).
  const smoothedMap = new Map<string, string>();
  newMap.forEach((type, key) => {
    const hex = HexUtils.fromKey(key);
    const neighbors = HexUtils.getNeighbors(hex).filter(n => newMap.has(HexUtils.key(n)));
    const neighborTypes = neighbors.map(n => newMap.get(HexUtils.key(n)));

    const counts = neighborTypes.reduce<Record<string, number>>((acc, t) => { acc[t!] = (acc[t!] || 0) + 1; return acc; }, {});
    const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

    if (majority && majority[1] > 3) smoothedMap.set(key, majority[0] as string);
    else smoothedMap.set(key, type);
  });

  // 3. Flowing River Pass
  const riverCount = viewMode === 'TACTICAL' ? 4 : 12;
  const starts = Array.from(smoothedMap.entries())
    .filter(([, t]) => t === 'MOUNTAIN' || t === 'SNOW' || t === 'HILL')
    .map(([k]) => HexUtils.fromKey(k));

  for (let i = 0; i < riverCount; i++) {
    if (starts.length === 0) break;
    const startIdx = Math.floor(riverRng() * starts.length);
    let curr = starts.splice(startIdx, 1)[0]; // without replacement: distinct sources
    const visited = new Set<string>();

    for (let s = 0; s < 300; s++) {
      const k = HexUtils.key(curr);
      if (visited.has(k)) break;
      visited.add(k);

      const type = smoothedMap.get(k);
      if (type === 'SEA' || type === 'DEEP_SEA') break;

      smoothedMap.set(k, 'RIVER');

      // Rivers thicken in TACTICAL view so they're walkable but visually substantial.
      if (viewMode === 'TACTICAL') {
        HexUtils.getNeighbors(curr).forEach(n => {
          const nk = HexUtils.key(n);
          if (!smoothedMap.has(nk)) return;
          const roll = riverRng() > 0.3; // drawn unconditionally to preserve RNG order
          if (roll && canThickenToRiver(smoothedMap.get(nk)!)) smoothedMap.set(nk, 'RIVER');
        });
      }

      const neighbors = HexUtils.getNeighbors(curr).filter(n => smoothedMap.has(HexUtils.key(n)));
      if (neighbors.length === 0) break;
      const next = neighbors.sort((a, b) => (elevationCache.get(HexUtils.key(a))||0) - (elevationCache.get(HexUtils.key(b))||0))[0];
      // Rivers flow downhill: stop pooling in a basin rather than climbing the lowest ridge.
      const currElev = elevationCache.get(k) ?? Infinity;
      const nextElev = elevationCache.get(HexUtils.key(next)) ?? Infinity;
      if (nextElev >= currElev) break;
      curr = next;
    }
  }

  const gridData = Array.from(smoothedMap.entries())
    .map(([k, t]) => ({ hex: HexUtils.fromKey(k), type: t }))
    .sort((a, b) => a.hex.r - b.hex.r);

  return { gridData };
}
