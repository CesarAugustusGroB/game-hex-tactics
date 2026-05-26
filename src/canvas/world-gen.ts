import { createNoise2D } from 'simplex-noise';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { WORLD_GEN, DIVE_ZOOM, MAP_TYPES, MAP_TYPE_IDS, DEFAULT_MAP_TYPE, type MapTypeId, type ShapePrimitive } from '../data/world-gen';
import { mulberry32 } from '../utils/rng';

export interface ShapeCtx {
  gridRadius: number;
  intercept: number;
  exponent: number;
  coastAngle: number; // radians; seed-derived, used by the 'linear' primitive
}

// Elevation-shaping multiplier per macro-shape archetype. Multiplies the
// normalized [0,1] noise elevation before bucketing. `radial` is byte-identical
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
  waterLevel: number;
  mountainLevel: number;
  noiseOffset: { q: number; r: number };
  resolution: number;
}

export interface WorldGenInput {
  settings: GenSettings;
  gridRadius: number;
  viewMode: 'STRATEGIC' | 'TACTICAL';
  noise: ReturnType<typeof createNoise2D>;
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
  const { settings, gridRadius, viewMode, noise } = input;
  const newMap = new Map<string, string>();
  const elevationCache = new Map<string, number>();

  const w = settings.waterLevel;
  const m = settings.mountainLevel;
  const b = WORLD_GEN.bucket;
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
  // Tactical applies the SAME radial falloff multiplier the strategic island used at
  // the clicked hex, uniformly across every tactical hex. Per-hex variation inside a
  // dive comes purely from the fine-resolution noise — the island-shape falloff is a
  // strategic-scale concept and re-evaluating it per tactical hex made the same noise
  // point bucket higher in tactical than in strategic (because the formerly-used
  // exponent 4 decays slower than the strategic exponent 2.5 for d ∈ (0,1), so the
  // mult was always larger). Result: a FOREST in strategic could show up as HILL/
  // MOUNTAIN in tactical, and the river pass would then spawn rivers from those hills.
  const tacticalElevationMult = (() => {
    if (viewMode === 'STRATEGIC') return 1; // unused
    const diveStrategicQ = settings.noiseOffset.q / DIVE_ZOOM;
    const diveStrategicR = settings.noiseOffset.r / DIVE_ZOOM;
    const d = Math.sqrt(
      diveStrategicQ * diveStrategicQ +
      diveStrategicR * diveStrategicR +
      diveStrategicQ * diveStrategicR,
    ) / gridRadius;
    return Math.max(0, WORLD_GEN.falloff.intercept - Math.pow(d, WORLD_GEN.falloff.exponent));
  })();
  const sampleElevation = (q: number, r: number): number => {
    const nx = (q + settings.noiseOffset.q) / settings.resolution;
    const ny = (r + settings.noiseOffset.r) / settings.resolution;
    let e = (noise(nx, ny) + 0.4 * noise(nx * 2.2, ny * 2.2)) / 1.4;
    e = (e + 1) / 2;
    if (viewMode === 'STRATEGIC') {
      const d = Math.sqrt(q*q + r*r + q*r) / gridRadius;
      e *= Math.max(0, WORLD_GEN.falloff.intercept - Math.pow(d, WORLD_GEN.falloff.exponent));
    } else {
      e *= tacticalElevationMult;
    }
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

  // 2. Cohesion Pass: Remove single-hex noise
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
    let curr = starts[Math.floor(Math.random() * starts.length)];
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
          if (smoothedMap.has(HexUtils.key(n)) && Math.random() > 0.3) smoothedMap.set(HexUtils.key(n), 'RIVER');
        });
      }

      const neighbors = HexUtils.getNeighbors(curr).filter(n => smoothedMap.has(HexUtils.key(n)));
      if (neighbors.length === 0) break;
      const next = neighbors.sort((a, b) => (elevationCache.get(HexUtils.key(a))||0) - (elevationCache.get(HexUtils.key(b))||0))[0];
      curr = next;
    }
  }

  const gridData = Array.from(smoothedMap.entries())
    .map(([k, t]) => ({ hex: HexUtils.fromKey(k), type: t }))
    .sort((a, b) => a.hex.r - b.hex.r);

  return { gridData };
}
