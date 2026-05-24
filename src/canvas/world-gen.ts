import { createNoise2D } from 'simplex-noise';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { STRATEGIC_RESOLUTION } from './constants';

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
  const bucket = (e: number): string => {
    if (e < w * 0.7) return 'DEEP_SEA';
    if (e < w) return 'SEA';
    if (e < w + 0.03) return 'SAND';
    if (e < m * 0.7) return 'GRASSLAND';
    if (e < m * 0.9) return 'FOREST';
    if (e < m) return 'HILL';
    if (e < m + 0.1) return 'MOUNTAIN';
    return 'SNOW';
  };
  const sampleElevation = (q: number, r: number): number => {
    const nx = (q + settings.noiseOffset.q) / settings.resolution;
    const ny = (r + settings.noiseOffset.r) / settings.resolution;
    let e = (noise(nx, ny) + 0.4 * noise(nx * 2.2, ny * 2.2)) / 1.4;
    e = (e + 1) / 2;
    if (viewMode === 'STRATEGIC') {
      const d = Math.sqrt(q*q + r*r + q*r) / gridRadius;
      e *= Math.max(0, 1.1 - Math.pow(d, 2.5));
    } else {
      // Anchor tactical elevation to the strategic-island position the dive came
      // from, so mountain stays mountain-ish at the centre.
      const scaleBack = STRATEGIC_RESOLUTION / settings.resolution;
      const qe = (q + settings.noiseOffset.q) * scaleBack;
      const re = (r + settings.noiseOffset.r) * scaleBack;
      const d = Math.sqrt(qe*qe + re*re + qe*re) / gridRadius;
      e *= Math.max(0, 1.1 - Math.pow(d, 4));
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
