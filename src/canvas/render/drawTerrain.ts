import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { TERRAINS } from '../terrain-defs';
import { type WaterFilterHandle, WATER_FILTER_CONFIGS, createWaterFilter } from '../water-filter';
import { deployZoneFor, captureZoneKeys, CAPTURE_CENTER } from '../constants';
import { grassChunkPatch } from '../detail-rules';

// Flat-top hex corner unit vectors (vertex i at angle 60·i), precomputed once.
const HEX_CORNERS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i);
  return { cos: Math.cos(a), sin: Math.sin(a) };
});
/** The 6 hex-top vertices at pixel centre `pos`, lifted by `height`. */
const hexTopVerts = (pos: { x: number; y: number }, height: number): { x: number; y: number }[] =>
  HEX_CORNERS.map(c => ({ x: pos.x + HexUtils.size * c.cos, y: pos.y + HexUtils.size * c.sin - height }));
const flatVerts = (vs: { x: number; y: number }[]): number[] => vs.flatMap(v => [v.x, v.y]);
/** Cliff/zone face quad: the shared top edge (v1→v2) dropped straight down by `dh`. */
const faceQuad = (topV: { x: number; y: number }[], v1: number, v2: number, dh: number): number[] =>
  [topV[v1].x, topV[v1].y, topV[v2].x, topV[v2].y, topV[v2].x, topV[v2].y + dh, topV[v1].x, topV[v1].y + dh];

// Edge → [vertex a, vertex b, neighbour axial-dir index] (flat-top, vertex i at 60·i).
const HEX_EDGES: [number, number, number][] = [
  [5, 0, 1], [0, 1, 0], [1, 2, 5], [2, 3, 4], [3, 4, 3], [4, 5, 2],
];
// The 3 downhill-visible faces (S / SE / SW); the other 3 sit inside the hex top in 2.5D.
const CLIFF_EDGES: [number, number, number][] = [[1, 2, 5], [0, 1, 0], [2, 3, 4]];
// Per-CLIFF_EDGES shade for prism-side fills (S darker than SE / SW).
const CLIFF_EDGE_SHADES = [0.70, 0.55, 0.55];

export interface TerrainRenderContext {
  terrainGfx: PIXI.Graphics;
  terrainOverlay: PIXI.Container;
  deployZoneGfx: PIXI.Graphics;
  captureZoneGfx: PIXI.Graphics;
  captureFlagSprite: PIXI.Sprite | null;
  // Textures
  grassTex: PIXI.Texture | null;
  grassMacroNoiseTex: PIXI.Texture | null;
  grassPatchDryTex: PIXI.Texture | null;
  grassPatchDenseTex: PIXI.Texture | null;
  grassFlowerSpeckTex: PIXI.Texture | null;
  forestTex: PIXI.Texture | null;
  forestMacroVariationTex: PIXI.Texture | null;
  forestDensePatchTex: PIXI.Texture | null;
  forestMossPatchTex: PIXI.Texture | null;
  riverTex: PIXI.Texture | null;
  riverFlowVariationTex: PIXI.Texture | null;
  riverDepthPatchTex: PIXI.Texture | null;
  riverEdgeSoftnessTex: PIXI.Texture | null;
  riverShimmerHighlightTex: PIXI.Texture | null;
  hillTex: PIXI.Texture | null;
  hillMacroNoiseTex: PIXI.Texture | null;
  hillPatchDryTex: PIXI.Texture | null;
  hillPatchDenseTex: PIXI.Texture | null;
  mountainTex: PIXI.Texture | null;
  snowTex: PIXI.Texture | null;
  sandTex: PIXI.Texture | null;
  seaTex: PIXI.Texture | null;
  seaMacroNoiseTex: PIXI.Texture | null;
  seaShallowPatchTex: PIXI.Texture | null;
  seaDepthPatchTex: PIXI.Texture | null;
  seaMicroNoiseTex: PIXI.Texture | null;
  deepSeaTex: PIXI.Texture | null;
  // Mutable output: caller owns this array; drawTerrain resets and repopulates it.
  waterFilters: WaterFilterHandle[];
  // Data
  gridData: { hex: Hex; type: string }[];
  viewMode: 'STRATEGIC' | 'TACTICAL';
}

export function drawTerrain(ctx: TerrainRenderContext): void {
  const {
    terrainGfx: tGfx,
    terrainOverlay: overlay,
    deployZoneGfx: dzGfx,
    captureZoneGfx: czGfx,
    captureFlagSprite: flagSprite,
    gridData,
    viewMode,
  } = ctx;

  tGfx.clear();
  dzGfx.clear();
  czGfx.clear();

  const terrainUvMatrix = new PIXI.Matrix().scale(14, 14);
  const terrainAt = new Map<string, string>(gridData.map(d => [HexUtils.key(d.hex), d.type]));
  const isTexturedBiome = (t: string): boolean =>
    t === 'DEEP_SEA' || t === 'SEA' || t === 'RIVER' || t === 'GRASSLAND' || t === 'FOREST' || t === 'HILL' || t === 'MOUNTAIN' || t === 'SNOW';
  // Shorter terrain first so taller hexes draw on top of their shorter neighbours.
  const renderOrder = [...gridData].sort((a, b) => {
    const ha = TERRAINS[a.type]?.height ?? 0;
    const hb = TERRAINS[b.type]?.height ?? 0;
    if (ha !== hb) return ha - hb;
    return a.hex.r - b.hex.r;
  });
  renderOrder.forEach((item) => {
    const pos = HexUtils.hexToPixel(item.hex);
    const tDef = TERRAINS[item.type] || TERRAINS.SEA;
    const h = tDef.height;
    const top = hexTopVerts(pos, h);
    const base = hexTopVerts(pos, 0);
    // PIXI v8 gotcha: `Color.multiply(number)` treats the number as a hex int via
    // bit-shifts (0.7 | 0 = 0 → black), so pass an RGB array.
    const drawSide = (v1: number, v2: number, shade: number, bottomH = 0, color = tDef.color) => {
      tGfx.poly([
        top[v1].x, top[v1].y,
        top[v2].x, top[v2].y,
        base[v2].x, base[v2].y - bottomH,
        base[v1].x, base[v1].y - bottomH,
      ]).fill(PIXI.Color.shared.setValue(color).multiply([shade, shade, shade, 1]).toNumber());
    };
    // S / SE / SW only — N / NE / NW are hidden inside the hex top from top-down view.
    const sType  = terrainAt.get(HexUtils.key({ q: item.hex.q,     r: item.hex.r + 1 }));
    const seType = terrainAt.get(HexUtils.key({ q: item.hex.q + 1, r: item.hex.r     }));
    const swType = terrainAt.get(HexUtils.key({ q: item.hex.q - 1, r: item.hex.r + 1 }));
    const sH  = sType  ? (TERRAINS[sType]?.height  ?? 0) : 0;
    const seH = seType ? (TERRAINS[seType]?.height ?? 0) : 0;
    const swH = swType ? (TERRAINS[swType]?.height ?? 0) : 0;
    const isCoastalWater = (type: string | undefined): boolean => type === 'SEA' || type === 'DEEP_SEA';
    const drawWall = (v1: number, v2: number, shade: number, nType: string | undefined, nH: number) => {
      if (h <= nH) return;
      if (item.type === 'SAND' && isCoastalWater(nType)) {
        drawSide(v1, v2, 1, nH, 0xc8b98f);
        return;
      }
      drawSide(v1, v2, shade);
    };
    const drawWalls = () => {
      drawWall(2, 1, 0.7, sType, sH);
      drawWall(1, 0, 0.55, seType, seH);
      drawWall(2, 3, 0.55, swType, swH);
    };
    let fillStyle: { texture?: PIXI.Texture; matrix?: PIXI.Matrix; color: number };
    if (item.type === 'SAND' && ctx.sandTex) {
      fillStyle = { texture: ctx.sandTex, matrix: terrainUvMatrix, color: 0xC8C8C8 };
    } else {
      fillStyle = { color: tDef.color };
    }
    tGfx.poly(flatVerts(top)).fill(fillStyle);
    if (!isTexturedBiome(item.type)) drawWalls();
  });

  // Global-UV overlays: one TilingSprite per terrain type, masked to the union of that
  // biome's hex tops. The sprite tiles in its own local space (not per-polygon bbox),
  // so neighbouring hexes see different continuous patches of the texture.
  for (const child of overlay.children.slice()) {
    if ('mask' in child) (child as PIXI.Container).mask = null;
    // Water parents carry the shared, cached water filter — detach it before destroy so
    // the reusable filter (and its GL program) outlives this container.
    (child as PIXI.Container).filters = [];
    // Water layer containers live one level down inside the filtered deepSea/coastal
    // parents now — null their masks too before the recursive destroy.
    for (const grandchild of (child as PIXI.Container).children ?? []) {
      if ('mask' in grandchild) (grandchild as PIXI.Container).mask = null;
    }
    overlay.removeChild(child);
    child.destroy({ children: true, texture: false });
  }
  interface OverlayLayer {
    type: string;
    texture: PIXI.Texture | null;
    tint: number;
    /** World px per tile. Default 110px. */
    tilePx?: number;
    alpha?: number;
    blendMode?: PIXI.BLEND_MODES;
    /** Override whether this layer paints cliff faces. Defaults to base layers only. */
    includeCliffs?: boolean;
    /** Paint this terrain's shaded prism sides immediately before this layer. */
    paintCliffsBefore?: string;
    /** Splits hexes of the same `type` across multiple layers (e.g. chunked patches). */
    hexFilter?: (hex: Hex) => boolean;
    /** Optional animated water filter for tiled water layers. */
    waterFilter?: 'deepSea' | 'coastal';
    /** Emitted to `overlay` immediately after this layer (in height order) — used for
     *  height-specific cliff/blend faces so they don't over-paint taller biomes. */
    afterLayer?: () => PIXI.Graphics;
  }
  const grassWorldSeed = 1;
  const isSeaNextToSand = (hex: Hex): boolean =>
    HexUtils.directions.some(dir =>
      terrainAt.get(HexUtils.key({ q: hex.q + dir.q, r: hex.r + dir.r })) === 'SAND',
    );
  const isSeaNotNextToSand = (hex: Hex): boolean => !isSeaNextToSand(hex);
  // SEA <-> DEEP_SEA depth transition. The terrain types stay mechanically distinct,
  // but a broad low-alpha stroke softens the colour step between adjacent water hexes.
  const buildSeaDepthBlend = (): PIXI.Graphics => {
    const g = new PIXI.Graphics();
    const seaH = TERRAINS.SEA.height;
    for (const item of gridData) {
      if (item.type !== 'SEA') continue;
      const topV = hexTopVerts(HexUtils.hexToPixel(item.hex), seaH);
      for (const [v1, v2, dirIdx] of HEX_EDGES) {
        const dir = HexUtils.directions[dirIdx];
        const nType = terrainAt.get(HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r }));
        if (nType !== 'DEEP_SEA') continue;
        g.moveTo(topV[v1].x, topV[v1].y).lineTo(topV[v2].x, topV[v2].y).stroke({ width: 28, color: 0x4f7f8c, alpha: 0.10 });
        g.moveTo(topV[v1].x, topV[v1].y).lineTo(topV[v2].x, topV[v2].y).stroke({ width: 13, color: 0x6fa5ad, alpha: 0.08 });
      }
    }
    return g;
  };
  // Cliff faces for a biome: a quad down each S/SE/SW edge that faces a shorter neighbour.
  // `neighbourTypes` (if set) limits which neighbours trigger a face (e.g. RIVER only spills
  // into SEA/DEEP_SEA); otherwise any shorter neighbour (or the map edge) does.
  interface BiomeCliffStyle {
    fill: { color: number; alpha: number };
    stroke?: { width: number; color: number; alpha: number };
    neighbourTypes?: Set<string>;
  }
  const buildBiomeCliffs = (type: string, style: BiomeCliffStyle): PIXI.Graphics => {
    const g = new PIXI.Graphics();
    const baseH = TERRAINS[type].height;
    for (const item of gridData) {
      if (item.type !== type) continue;
      const topV = hexTopVerts(HexUtils.hexToPixel(item.hex), baseH);
      for (const [v1, v2, dirIdx] of CLIFF_EDGES) {
        const dir = HexUtils.directions[dirIdx];
        const nType = terrainAt.get(HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r }));
        if (style.neighbourTypes && (!nType || !style.neighbourTypes.has(nType))) continue;
        const nH = nType ? (TERRAINS[nType]?.height ?? 0) : 0;
        if (baseH <= nH) continue;
        const q = g.poly(faceQuad(topV, v1, v2, baseH - nH)).fill(style.fill);
        if (style.stroke) q.stroke(style.stroke);
      }
    }
    return g;
  };
  // Array order = z-order. Sorted by ascending TERRAINS height so taller biomes paint
  // over shorter ones at the shared edges.
  const globalUvOverlays: OverlayLayer[] = [
    {
      type: 'DEEP_SEA',
      texture: ctx.deepSeaTex,
      tint: 0xFFFFFF,
      tilePx: 420,
      includeCliffs: false,
      waterFilter: 'deepSea',
    },
    {
      type: 'SEA',
      texture: ctx.seaTex,
      tint: 0xFFFFFF,
      tilePx: 360,
      includeCliffs: false,
      waterFilter: 'coastal',
      afterLayer: buildSeaDepthBlend,
    },
    {
      type: 'SEA',
      texture: ctx.seaMacroNoiseTex,
      tint: 0xFFFFFF,
      tilePx: 1800,
      alpha: 0.11,
      blendMode: 'soft-light',
      includeCliffs: false,
      waterFilter: 'coastal',
    },
    {
      type: 'SEA',
      texture: ctx.seaShallowPatchTex,
      tint: 0xFFFFFF,
      tilePx: 900,
      alpha: 0.12,
      blendMode: 'soft-light',
      includeCliffs: false,
      hexFilter: isSeaNextToSand,
      waterFilter: 'coastal',
    },
    {
      type: 'SEA',
      texture: ctx.seaDepthPatchTex,
      tint: 0xFFFFFF,
      tilePx: 1300,
      alpha: 0.09,
      blendMode: 'multiply',
      includeCliffs: false,
      hexFilter: isSeaNotNextToSand,
      waterFilter: 'coastal',
    },
    {
      type: 'SEA',
      texture: ctx.seaMicroNoiseTex,
      tint: 0xFFFFFF,
      tilePx: 260,
      alpha: 0.06,
      blendMode: 'soft-light',
      includeCliffs: false,
      waterFilter: 'coastal',
    },
    {
      type: 'RIVER', texture: ctx.riverTex, tint: 0xFFFFFF, tilePx: 120,
      afterLayer: () => buildBiomeCliffs('RIVER', {
        fill: { color: 0xeafcff, alpha: 0.78 },
        stroke: { width: 1, color: 0xffffff, alpha: 0.85 },
        neighbourTypes: new Set(['SEA', 'DEEP_SEA']),
      }),
    },
    {
      type: 'RIVER',
      texture: ctx.riverFlowVariationTex,
      tint: 0xFFFFFF,
      tilePx: 216,
      alpha: 0.35,
      blendMode: 'soft-light',
    },
    {
      type: 'RIVER',
      texture: ctx.riverDepthPatchTex,
      tint: 0xFFFFFF,
      tilePx: 264,
      alpha: 0.18,
      blendMode: 'multiply',
    },
    {
      type: 'RIVER',
      texture: ctx.riverEdgeSoftnessTex,
      tint: 0xFFFFFF,
      tilePx: 168,
      alpha: 0.16,
      blendMode: 'soft-light',
    },
    {
      type: 'RIVER',
      texture: ctx.riverShimmerHighlightTex,
      tint: 0xFFFFFF,
      tilePx: 192,
      alpha: 0.45,
      blendMode: 'screen',
    },
    {
      type: 'GRASSLAND', texture: ctx.grassTex, tint: 0xFFFFFF, tilePx: 200,
      afterLayer: () => buildBiomeCliffs('GRASSLAND', { fill: { color: 0x8a6a3f, alpha: 0.82 } }),
    },
    {
      type: 'GRASSLAND',
      texture: ctx.grassMacroNoiseTex,
      tint: 0xFFFFFF,
      tilePx: 5000,
      alpha: 0.24,
      blendMode: 'multiply',
    },
    {
      type: 'GRASSLAND',
      texture: ctx.grassPatchDryTex,
      tint: 0xFFFFFF,
      tilePx: 700,
      alpha: 0.65,
      blendMode: 'normal',
      hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed) === 'DRY',
    },
    {
      type: 'GRASSLAND',
      texture: ctx.grassPatchDenseTex,
      tint: 0xFFFFFF,
      tilePx: 700,
      alpha: 0.22,
      blendMode: 'multiply',
      hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed) === 'DENSE',
    },
    {
      type: 'GRASSLAND',
      texture: ctx.grassFlowerSpeckTex,
      tint: 0xFFFFFF,
      tilePx: 700,
      alpha: 0.50,
      // `multiply` would mud pink flowers into brown against grass green; `normal`
      // preserves the speck colour.
      blendMode: 'normal',
      hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed) === 'FLOWERY',
    },
    {
      type: 'FOREST', texture: ctx.forestTex, tint: 0xFFFFFF, tilePx: 100,
      afterLayer: () => buildBiomeCliffs('FOREST', { fill: { color: 0x4f3824, alpha: 0.86 } }),
    },
    {
      type: 'FOREST',
      texture: ctx.forestMacroVariationTex,
      tint: 0xFFFFFF,
      tilePx: 300,
      alpha: 0.20,
      blendMode: 'overlay',
    },
    {
      type: 'FOREST',
      texture: ctx.forestDensePatchTex,
      tint: 0xFFFFFF,
      tilePx: 250,
      alpha: 0.14,
      blendMode: 'multiply',
      hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed + 200) === 'DENSE',
    },
    {
      type: 'FOREST',
      texture: ctx.forestMossPatchTex,
      tint: 0xFFFFFF,
      tilePx: 280,
      alpha: 0.40,
      blendMode: 'soft-light',
      hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed + 300) === 'DENSE',
    },
    {
      type: 'HILL',
      texture: ctx.hillTex,
      tint: 0xE0E0E0,
      tilePx: 900,
      includeCliffs: false,
      paintCliffsBefore: 'HILL',
    },
    {
      type: 'HILL',
      texture: ctx.hillMacroNoiseTex,
      tint: 0xFFFFFF,
      tilePx: 5000,
      alpha: 0.14,
      blendMode: 'multiply',
    },
    {
      type: 'HILL',
      texture: ctx.hillPatchDryTex,
      tint: 0xFFFFFF,
      tilePx: 400,
      alpha: 0.30,
      blendMode: 'multiply',
      hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed + 100) === 'DRY',
    },
    {
      type: 'HILL',
      texture: ctx.hillPatchDenseTex,
      tint: 0xFFFFFF,
      tilePx: 400,
      alpha: 0.30,
      blendMode: 'multiply',
      includeCliffs: false,
      hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed + 100) === 'DENSE',
    },
    {
      type: 'MOUNTAIN',
      texture: ctx.mountainTex,
      tint: 0xC8C8C8,
      tilePx: viewMode === 'TACTICAL' ? 2100 : 700,
      includeCliffs: false,
      paintCliffsBefore: 'MOUNTAIN',
    },
    {
      type: 'SNOW',
      texture: ctx.snowTex,
      tint: 0xFFFFFF,
      tilePx: viewMode === 'TACTICAL' ? 2100 : 700,
      includeCliffs: false,
      paintCliffsBefore: 'SNOW',
    },
  ];
  // Shaded prism sides for the textured land biomes (HILL / MOUNTAIN / SNOW) — fills each
  // S/SE/SW face with the biome colour darkened per CLIFF_EDGE_SHADES, into a caller-owned
  // Graphics so it can be inserted at the right z (just under the biome's tiled overlay).
  const drawTerrainCliffs = (target: PIXI.Graphics, terrainType: string) => {
    const terrain = TERRAINS[terrainType];
    if (!terrain) return;
    const terrainH = terrain.height;
    for (const item of gridData) {
      if (item.type !== terrainType) continue;
      const topV = hexTopVerts(HexUtils.hexToPixel(item.hex), terrainH);
      CLIFF_EDGES.forEach(([v1, v2, dirIdx], ei) => {
        const dir = HexUtils.directions[dirIdx];
        const nType = terrainAt.get(HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r }));
        const nH = nType ? (TERRAINS[nType]?.height ?? 0) : 0;
        if (terrainH <= nH) return;
        const shade = CLIFF_EDGE_SHADES[ei];
        target.poly(faceQuad(topV, v1, v2, terrainH - nH)).fill({
          color: PIXI.Color.shared.setValue(terrain.color).multiply([shade, shade, shade, 1]).toNumber(),
        });
      });
    }
  };
  // One filtered parent per water config → a single render-to-texture pass for all layers
  // sharing that filter, instead of one pass per layer. Water layers are contiguous at the
  // start of globalUvOverlays, so these parents are added first = lowest z (correct).
  const waterParents: Partial<Record<'deepSea' | 'coastal', PIXI.Container>> = {};
  // Cache one handle per kind for the app's lifetime. Recreating the filter each redraw
  // recompiles a GL program and leaks the previous one; the ticker reads ctx.waterFilters
  // for uTime, so the cache lives there.
  const handleFor = (kind: 'deepSea' | 'coastal'): WaterFilterHandle => {
    let handle = ctx.waterFilters.find(h => h.kind === kind);
    if (!handle) {
      handle = createWaterFilter(WATER_FILTER_CONFIGS[kind]);
      handle.kind = kind;
      ctx.waterFilters.push(handle);
    }
    return handle;
  };
  const ensureWaterParent = (kind: 'deepSea' | 'coastal'): PIXI.Container => {
    let p = waterParents[kind];
    if (!p) {
      p = new PIXI.Container();
      p.filters = [handleFor(kind).filter];
      overlay.addChild(p);
      waterParents[kind] = p;
    }
    return p;
  };

  for (const layer of globalUvOverlays) {
    if (layer.paintCliffsBefore) {
      const terrainCliffs = new PIXI.Graphics();
      drawTerrainCliffs(terrainCliffs, layer.paintCliffsBefore);
      overlay.addChild(terrainCliffs);
    }
    if (!layer.texture) continue;
    const hexes = gridData.filter(d =>
      d.type === layer.type && (!layer.hexFilter || layer.hexFilter(d.hex)),
    );
    if (hexes.length === 0) continue;
    const hexH = (TERRAINS[layer.type] ?? TERRAINS.SEA).height;
    // Base layers (no hexFilter) extend the mask to the visible cliff faces against
    // shorter neighbours — biome texture continues down the cliff instead of leaving a
    // dark shaded wall. Decoration layers (dry/dense/flowery patches) stay top-only.
    const includeCliffs = layer.includeCliffs ?? !layer.hexFilter;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const d of hexes) {
      const p = HexUtils.hexToPixel(d.hex);
      for (const v of hexTopVerts(p, hexH)) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      if (includeCliffs && p.y > maxY) maxY = p.y; // cliffs drop down by at most hexH (= p.y).
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const tile = new PIXI.TilingSprite({ texture: layer.texture, width: w, height: h });
    const tilePx = layer.tilePx ?? 110;
    const tileScale = tilePx / layer.texture.width;
    tile.tileScale.set(tileScale, tileScale);
    tile.tint = layer.tint;
    if (layer.alpha !== undefined) tile.alpha = layer.alpha;
    if (layer.blendMode !== undefined) tile.blendMode = layer.blendMode;
    const layerContainer = new PIXI.Container();
    layerContainer.x = minX;
    layerContainer.y = minY;
    layerContainer.addChild(tile);
    const mask = new PIXI.Graphics();
    for (const d of hexes) {
      const topV = hexTopVerts(HexUtils.hexToPixel(d.hex), hexH);
      mask.poly(flatVerts(topV)).fill({ color: 0xffffff });
      if (!includeCliffs) continue;
      for (const [v1, v2, dirIdx] of CLIFF_EDGES) {
        const dir = HexUtils.directions[dirIdx];
        const nType = terrainAt.get(HexUtils.key({ q: d.hex.q + dir.q, r: d.hex.r + dir.r }));
        const nH = nType ? (TERRAINS[nType]?.height ?? 0) : 0;
        if (hexH <= nH) continue;
        mask.poly(faceQuad(topV, v1, v2, hexH - nH)).fill({ color: 0xffffff });
      }
    }
    const parent = layer.waterFilter ? ensureWaterParent(layer.waterFilter) : overlay;
    parent.addChild(layerContainer);
    parent.addChild(mask);
    layerContainer.mask = mask;
    if (layer.afterLayer) overlay.addChild(layer.afterLayer());
  }

  // Deploy zone frontier — for each zone hex, stroke only the edges that face a
  // non-zone neighbour (or the map edge). Produces one bold line along each side's
  // front, no fill clutter inside the zones. Vertex pair → axial dir mapping is the
  // same as `gridEdges` below (flat-top, vertex i at angle 60·i). TACTICAL-only —
  // the strategic overview shows world terrain, not battle overlays.
  if (viewMode === 'TACTICAL') {
    const redZone = deployZoneFor('red', gridData);
    const blueZone = deployZoneFor('blue', gridData);
    for (const item of gridData) {
      const k = HexUtils.key(item.hex);
      const zone = redZone.has(k) ? redZone : blueZone.has(k) ? blueZone : null;
      if (!zone) continue;
      const color = zone === redZone ? 0xff3344 : 0x3b82f6;
      const hh = (TERRAINS[item.type] || TERRAINS.SEA).height;
      const topV = hexTopVerts(HexUtils.hexToPixel(item.hex), hh);
      for (const [v1, v2, dirIdx] of HEX_EDGES) {
        const dir = HexUtils.directions[dirIdx];
        const nKey = HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r });
        if (zone.has(nKey)) continue;
        dzGfx.moveTo(topV[v1].x, topV[v1].y)
             .lineTo(topV[v2].x, topV[v2].y)
             .stroke({ width: 3, color, alpha: 0.9 });
      }
    }
  }

  // Capture zone — the central 7-hex flower. Soft gold fill on each hex top + a bold
  // gold frontier stroke on the outer edges. Also reposition the flag sprite atop the
  // centre hex now that terrain height is known. TACTICAL-only — strategic overview
  // hides the flag (it's a battle objective, not a world feature).
  if (flagSprite) flagSprite.visible = viewMode === 'TACTICAL';
  if (viewMode === 'TACTICAL') {
    const zone = captureZoneKeys();
    for (const item of gridData) {
      const k = HexUtils.key(item.hex);
      if (!zone.has(k)) continue;
      const hh = (TERRAINS[item.type] || TERRAINS.SEA).height;
      const topV = hexTopVerts(HexUtils.hexToPixel(item.hex), hh);
      czGfx.poly(flatVerts(topV)).fill({ color: 0xfacc15, alpha: 0.28 });
      for (const [v1, v2, dirIdx] of HEX_EDGES) {
        const dir = HexUtils.directions[dirIdx];
        const nKey = HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r });
        if (zone.has(nKey)) continue;
        czGfx.moveTo(topV[v1].x, topV[v1].y)
             .lineTo(topV[v2].x, topV[v2].y)
             .stroke({ width: 10, color: 0xfde047, alpha: 0.55 });
        czGfx.moveTo(topV[v1].x, topV[v1].y)
             .lineTo(topV[v2].x, topV[v2].y)
             .stroke({ width: 5, color: 0xfacc15, alpha: 1.0 });
      }
    }
    // Flag sprite sits on the centre hex top — y offset by that hex's terrain height.
    const flag = flagSprite;
    if (flag) {
      const centerType = terrainAt.get(HexUtils.key(CAPTURE_CENTER));
      const hh = centerType ? (TERRAINS[centerType]?.height ?? 0) : 0;
      const pos = HexUtils.hexToPixel(CAPTURE_CENTER);
      flag.x = pos.x;
      flag.y = pos.y - hh;
    }
  }

}

export interface GridRenderContext {
  gridGfx: PIXI.Graphics;
  gridData: { hex: Hex; type: string }[];
  showGrid: boolean;
}

// Drawn into its own `gridGfx` so toggling the grid never rebuilds the terrain pipeline.
// Each shared edge is stroked ONCE — by the taller hex (tiebreak: axial-key compare).
// Stops double-line artefacts at elevation boundaries where each side would otherwise
// draw its own outline at its own height.
export function drawGrid({ gridGfx: gGfx, gridData, showGrid }: GridRenderContext): void {
  gGfx.clear();
  if (!showGrid) return;
  const terrainAt = new Map<string, string>(gridData.map(d => [HexUtils.key(d.hex), d.type]));
  // The two neighbour dirs whose hexes also share each vertex (flat-top, vertex i at
  // 60·i). A vertex is lifted to the tallest of the (up to 3) hexes touching it, so a
  // shorter hex's grid edge climbs to meet a taller neighbour's raised corner instead
  // of being drawn at its own height and poking a stub across the taller hex's top.
  const vertexDirs: [number, number][] = [[0, 1], [0, 5], [5, 4], [4, 3], [3, 2], [2, 1]];
  const sz = HexUtils.size;
  const heightAt = (q: number, r: number): number => {
    const t = terrainAt.get(HexUtils.key({ q, r }));
    return t ? (TERRAINS[t]?.height ?? 0) : 0;
  };
  for (const item of gridData) {
    const hh = (TERRAINS[item.type] || TERRAINS.SEA).height;
    const pos = HexUtils.hexToPixel(item.hex);
    const myKey = HexUtils.key(item.hex);
    const topV = HEX_CORNERS.map((c, i) => {
      let vh = hh;
      for (const d of vertexDirs[i]) {
        const nb = HexUtils.directions[d];
        const nbh = heightAt(item.hex.q + nb.q, item.hex.r + nb.r);
        if (nbh > vh) vh = nbh;
      }
      return { x: pos.x + sz * c.cos, y: pos.y + sz * c.sin - vh };
    });
    for (const [v1, v2, dirIdx] of HEX_EDGES) {
      const dir = HexUtils.directions[dirIdx];
      const nKey = HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r });
      const nType = terrainAt.get(nKey);
      const nH = nType ? (TERRAINS[nType]?.height ?? 0) : -Infinity;
      const iOwn = !nType || hh > nH || (hh === nH && myKey < nKey);
      if (!iOwn) continue;
      gGfx.moveTo(topV[v1].x, topV[v1].y)
          .lineTo(topV[v2].x, topV[v2].y)
          .stroke({ width: 1, color: 0x141414, alpha: 1 });
    }
  }
}
