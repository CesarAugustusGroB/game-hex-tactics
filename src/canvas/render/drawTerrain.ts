import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { TERRAINS } from '../terrain-defs';
import { type WaterFilterHandle, WATER_FILTER_CONFIGS, createWaterFilter } from '../water-filter';
import { deployZoneFor, captureZoneKeys, CAPTURE_CENTER } from '../constants';
import { grassChunkPatch } from '../detail-rules';

export interface TerrainRenderContext {
  terrainGfx: PIXI.Graphics;
  terrainOverlay: PIXI.Container;
  gridGfx: PIXI.Graphics;
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
  showGrid: boolean;
  viewMode: 'STRATEGIC' | 'TACTICAL';
}

export function drawTerrain(ctx: TerrainRenderContext): void {
  const {
    terrainGfx: tGfx,
    terrainOverlay: overlay,
    gridGfx: gGfx,
    deployZoneGfx: dzGfx,
    captureZoneGfx: czGfx,
    captureFlagSprite: flagSprite,
    gridData,
    showGrid,
    viewMode,
  } = ctx;

  tGfx.clear();
  gGfx.clear();
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
    const s = HexUtils.size;
    const top: { x: number; y: number }[] = [];
    const base: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = Math.PI / 180 * (60 * i);
      top.push({ x: pos.x + s * Math.cos(r), y: pos.y + s * Math.sin(r) - h });
      base.push({ x: pos.x + s * Math.cos(r), y: pos.y + s * Math.sin(r) });
    }
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
    const topPoints: number[] = [];
    for (let i = 0; i < 6; i++) { topPoints.push(top[i].x, top[i].y); }
    tGfx.poly(topPoints).fill(fillStyle);
    if (!isTexturedBiome(item.type)) drawWalls();
  });

  // Global-UV overlays: one TilingSprite per terrain type, masked to the union of that
  // biome's hex tops. The sprite tiles in its own local space (not per-polygon bbox),
  // so neighbouring hexes see different continuous patches of the texture.
  ctx.waterFilters.length = 0;
  for (const child of overlay.children.slice()) {
    if ('mask' in child) (child as PIXI.Container).mask = null;
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
  }
  const grassWorldSeed = 1;
  const isSeaNextToSand = (hex: Hex): boolean =>
    HexUtils.directions.some(dir =>
      terrainAt.get(HexUtils.key({ q: hex.q + dir.q, r: hex.r + dir.r })) === 'SAND',
    );
  const isSeaNotNextToSand = (hex: Hex): boolean => !isSeaNextToSand(hex);
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
    },
    {
      type: 'SEA',
      texture: ctx.seaMacroNoiseTex,
      tint: 0xFFFFFF,
      tilePx: 1800,
      alpha: 0.18,
      blendMode: 'soft-light',
      includeCliffs: false,
      waterFilter: 'coastal',
    },
    {
      type: 'SEA',
      texture: ctx.seaShallowPatchTex,
      tint: 0xFFFFFF,
      tilePx: 900,
      alpha: 0.18,
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
      alpha: 0.16,
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
      alpha: 0.10,
      blendMode: 'soft-light',
      includeCliffs: false,
      waterFilter: 'coastal',
    },
    { type: 'RIVER', texture: ctx.riverTex, tint: 0xFFFFFF, tilePx: 120 },
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
    { type: 'GRASSLAND', texture: ctx.grassTex, tint: 0xFFFFFF, tilePx: 200 },
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
    { type: 'FOREST', texture: ctx.forestTex, tint: 0xFFFFFF, tilePx: 100 },
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
  // Cliff edges (taller hex → shorter neighbour). vertex pair + axial direction. Only
  // S / SE / SW — the other three would render inside the hex top in 2.5D.
  const cliffEdges: [number, number, number][] = [
    [1, 2, 5], [0, 1, 0], [2, 3, 4],
  ];
  const drawTerrainCliffs = (target: PIXI.Graphics, terrainType: string) => {
    const terrain = TERRAINS[terrainType];
    if (!terrain) return;
    const terrainH = terrain.height;
    const sz = HexUtils.size;
    const terrainEdges: [number, number, number, number][] = [
      [2, 1, 5, 0.70],
      [1, 0, 0, 0.55],
      [2, 3, 4, 0.55],
    ];

    for (const item of gridData) {
      if (item.type !== terrainType) continue;
      const pos = HexUtils.hexToPixel(item.hex);
      const topV: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        topV.push({ x: pos.x + sz * Math.cos(r), y: pos.y + sz * Math.sin(r) - terrainH });
      }

      for (const [v1, v2, dirIdx, shade] of terrainEdges) {
        const dir = HexUtils.directions[dirIdx];
        const nKey = HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r });
        const nType = terrainAt.get(nKey);
        const nH = nType ? (TERRAINS[nType]?.height ?? 0) : 0;
        if (terrainH <= nH) continue;
        const dh = terrainH - nH;
        target
          .poly([
            topV[v1].x, topV[v1].y,
            topV[v2].x, topV[v2].y,
            topV[v2].x, topV[v2].y + dh,
            topV[v1].x, topV[v1].y + dh,
          ])
          .fill({
            color: PIXI.Color.shared.setValue(terrain.color).multiply([shade, shade, shade, 1]).toNumber(),
          });
      }
    }
  };
  // One filtered parent per water config → a single render-to-texture pass for all layers
  // sharing that filter, instead of one pass per layer. Water layers are contiguous at the
  // start of globalUvOverlays, so these parents are added first = lowest z (correct).
  const waterParents: Partial<Record<'deepSea' | 'coastal', PIXI.Container>> = {};
  const ensureWaterParent = (kind: 'deepSea' | 'coastal'): PIXI.Container => {
    let p = waterParents[kind];
    if (!p) {
      p = new PIXI.Container();
      const handle = createWaterFilter(WATER_FILTER_CONFIGS[kind]);
      p.filters = [handle.filter];
      ctx.waterFilters.push(handle);
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
    const sz = HexUtils.size;
    // Base layers (no hexFilter) extend the mask to the visible cliff faces against
    // shorter neighbours — biome texture continues down the cliff instead of leaving a
    // dark shaded wall. Decoration layers (dry/dense/flowery patches) stay top-only.
    const includeCliffs = layer.includeCliffs ?? !layer.hexFilter;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const d of hexes) {
      const p = HexUtils.hexToPixel(d.hex);
      const topY = p.y - hexH;
      for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        const vx = p.x + sz * Math.cos(r);
        const vy = topY + sz * Math.sin(r);
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
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
      const p = HexUtils.hexToPixel(d.hex);
      const topY = p.y - hexH;
      const topV: { x: number; y: number }[] = [];
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        const vx = p.x + sz * Math.cos(r);
        const vy = topY + sz * Math.sin(r);
        topV.push({ x: vx, y: vy });
        pts.push(vx, vy);
      }
      mask.poly(pts).fill({ color: 0xffffff });
      if (!includeCliffs) continue;
      for (const [v1, v2, dirIdx] of cliffEdges) {
        const dir = HexUtils.directions[dirIdx];
        const nKey = HexUtils.key({ q: d.hex.q + dir.q, r: d.hex.r + dir.r });
        const nType = terrainAt.get(nKey);
        const nH = nType ? (TERRAINS[nType]?.height ?? 0) : 0;
        if (hexH <= nH) continue;
        const dh = hexH - nH;
        mask.poly([
          topV[v1].x, topV[v1].y,
          topV[v2].x, topV[v2].y,
          topV[v2].x, topV[v2].y + dh,
          topV[v1].x, topV[v1].y + dh,
        ]).fill({ color: 0xffffff });
      }
    }
    const parent = layer.waterFilter ? ensureWaterParent(layer.waterFilter) : overlay;
    parent.addChild(layerContainer);
    parent.addChild(mask);
    layerContainer.mask = mask;
  }
  const riverSeaCliffs = new PIXI.Graphics();
  for (const item of gridData) {
    if (item.type !== 'RIVER') continue;
    const riverH = TERRAINS.RIVER.height;
    const pos = HexUtils.hexToPixel(item.hex);
    const topV: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = Math.PI / 180 * (60 * i);
      topV.push({ x: pos.x + HexUtils.size * Math.cos(r), y: pos.y + HexUtils.size * Math.sin(r) - riverH });
    }
    for (const [v1, v2, dirIdx] of cliffEdges) {
      const dir = HexUtils.directions[dirIdx];
      const nType = terrainAt.get(HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r }));
      if (nType !== 'SEA' && nType !== 'DEEP_SEA') continue;
      const nH = TERRAINS[nType]?.height ?? 0;
      if (riverH <= nH) continue;
      const dh = riverH - nH;
      riverSeaCliffs
        .poly([
          topV[v1].x, topV[v1].y,
          topV[v2].x, topV[v2].y,
          topV[v2].x, topV[v2].y + dh,
          topV[v1].x, topV[v1].y + dh,
        ])
        .fill({ color: 0xeafcff, alpha: 0.78 })
        .stroke({ width: 1, color: 0xffffff, alpha: 0.85 });
    }
  }
  overlay.addChild(riverSeaCliffs);
  const grassEarthCliffs = new PIXI.Graphics();
  for (const item of gridData) {
    if (item.type !== 'GRASSLAND') continue;
    const grassH = TERRAINS.GRASSLAND.height;
    const pos = HexUtils.hexToPixel(item.hex);
    const topV: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = Math.PI / 180 * (60 * i);
      topV.push({ x: pos.x + HexUtils.size * Math.cos(r), y: pos.y + HexUtils.size * Math.sin(r) - grassH });
    }
    for (const [v1, v2, dirIdx] of cliffEdges) {
      const dir = HexUtils.directions[dirIdx];
      const nType = terrainAt.get(HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r }));
      const nH = nType ? (TERRAINS[nType]?.height ?? 0) : 0;
      if (grassH <= nH) continue;
      const dh = grassH - nH;
      grassEarthCliffs
        .poly([
          topV[v1].x, topV[v1].y,
          topV[v2].x, topV[v2].y,
          topV[v2].x, topV[v2].y + dh,
          topV[v1].x, topV[v1].y + dh,
        ])
        .fill({ color: 0x8a6a3f, alpha: 0.82 });
    }
  }
  overlay.addChild(grassEarthCliffs);
  const forestEarthCliffs = new PIXI.Graphics();
  for (const item of gridData) {
    if (item.type !== 'FOREST') continue;
    const forestH = TERRAINS.FOREST.height;
    const pos = HexUtils.hexToPixel(item.hex);
    const topV: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = Math.PI / 180 * (60 * i);
      topV.push({ x: pos.x + HexUtils.size * Math.cos(r), y: pos.y + HexUtils.size * Math.sin(r) - forestH });
    }
    for (const [v1, v2, dirIdx] of cliffEdges) {
      const dir = HexUtils.directions[dirIdx];
      const nType = terrainAt.get(HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r }));
      const nH = nType ? (TERRAINS[nType]?.height ?? 0) : 0;
      if (forestH <= nH) continue;
      const dh = forestH - nH;
      forestEarthCliffs
        .poly([
          topV[v1].x, topV[v1].y,
          topV[v2].x, topV[v2].y,
          topV[v2].x, topV[v2].y + dh,
          topV[v1].x, topV[v1].y + dh,
        ])
        .fill({ color: 0x4f3824, alpha: 0.86 });
    }
  }
  overlay.addChild(forestEarthCliffs);

  // Deploy zone frontier — for each zone hex, stroke only the edges that face a
  // non-zone neighbour (or the map edge). Produces one bold line along each side's
  // front, no fill clutter inside the zones. Vertex pair → axial dir mapping is the
  // same as `gridEdges` below (flat-top, vertex i at angle 60·i). TACTICAL-only —
  // the strategic overview shows world terrain, not battle overlays.
  if (viewMode === 'TACTICAL') {
    const redZone = deployZoneFor('red', gridData);
    const blueZone = deployZoneFor('blue', gridData);
    const sz = HexUtils.size;
    const zoneEdges: [number, number, number][] = [
      [5, 0, 1], [0, 1, 0], [1, 2, 5], [2, 3, 4], [3, 4, 3], [4, 5, 2],
    ];
    for (const item of gridData) {
      const k = HexUtils.key(item.hex);
      const zone = redZone.has(k) ? redZone : blueZone.has(k) ? blueZone : null;
      if (!zone) continue;
      const color = zone === redZone ? 0xff3344 : 0x3b82f6;
      const tDef = TERRAINS[item.type] || TERRAINS.SEA;
      const hh = tDef.height;
      const pos = HexUtils.hexToPixel(item.hex);
      const topV: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        topV.push({ x: pos.x + sz * Math.cos(r), y: pos.y + sz * Math.sin(r) - hh });
      }
      for (const [v1, v2, dirIdx] of zoneEdges) {
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
    const sz = HexUtils.size;
    const zoneEdges: [number, number, number][] = [
      [5, 0, 1], [0, 1, 0], [1, 2, 5], [2, 3, 4], [3, 4, 3], [4, 5, 2],
    ];
    for (const item of gridData) {
      const k = HexUtils.key(item.hex);
      if (!zone.has(k)) continue;
      const tDef = TERRAINS[item.type] || TERRAINS.SEA;
      const hh = tDef.height;
      const pos = HexUtils.hexToPixel(item.hex);
      const pts: number[] = [];
      const topV: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        const vx = pos.x + sz * Math.cos(r);
        const vy = pos.y + sz * Math.sin(r) - hh;
        topV.push({ x: vx, y: vy });
        pts.push(vx, vy);
      }
      czGfx.poly(pts).fill({ color: 0xfacc15, alpha: 0.28 });
      for (const [v1, v2, dirIdx] of zoneEdges) {
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
      const centerTile = gridData.find(d => d.hex.q === CAPTURE_CENTER.q && d.hex.r === CAPTURE_CENTER.r);
      const hh = centerTile ? (TERRAINS[centerTile.type]?.height ?? 0) : 0;
      const pos = HexUtils.hexToPixel(CAPTURE_CENTER);
      flag.x = pos.x;
      flag.y = pos.y - hh;
    }
  }

  // Each shared edge is stroked ONCE — by the taller hex (tiebreak: axial-key compare).
  // Stops double-line artefacts at elevation boundaries where each side would otherwise
  // draw its own outline at its own height.
  if (showGrid) {
    // Edge → vertex pair → neighbour axial dir (flat-top, r = 60·i).
    const gridEdges: [number, number, number][] = [
      [5, 0, 1], [0, 1, 0], [1, 2, 5], [2, 3, 4], [3, 4, 3], [4, 5, 2],
    ];
    const sz = HexUtils.size;
    for (const item of gridData) {
      const tDef = TERRAINS[item.type] || TERRAINS.SEA;
      const hh = tDef.height;
      const pos = HexUtils.hexToPixel(item.hex);
      const myKey = HexUtils.key(item.hex);
      const topV: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        topV.push({ x: pos.x + sz * Math.cos(r), y: pos.y + sz * Math.sin(r) - hh });
      }
      for (const [v1, v2, dirIdx] of gridEdges) {
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
}
