import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import gsap from 'gsap';
import { createNoise2D } from 'simplex-noise';
import { simulateTick, groupHeading, snapHeading, computeFormationPreview, computeLineDragSlots, computeWedgeDragSlots, computeHexDragSlots, computeOrderedSlotAssignments, computeLineSlotAssignmentsByType, snapToForwardCone, cycleConeHeading, CHARGE_DURATION_TICKS, MAX_HP_BY_TYPE } from '../battle/simulate';
import type { Unit, OrderMode, Team, GroupId, FormationType, UnitType } from '../battle/simulate';
import { getTerrainMods } from '../battle/terrain';
import { getAiController, type OrderChange } from '../battle/ai';
import {
  DRAG_THRESHOLD_PX, HEADING_ARROWS, STRATEGIC_RESOLUTION, DIVE_ZOOM,
  type InputMode, type Armies, type GroupOrders, type GroupFormations, type GroupDepths,
  type Rosters,
  INITIAL_ROSTER, COHORT_SIZE, RETREAT_REFUND_FRAC,
  CAPTURE_TICKS_TO_WIN, CAPTURE_CENTER, captureZoneKeys, CAPTURE_ZONE_HEXES, makeInitialRosters,
  FORMATION_CYCLE, TEAM_TINTS,
  DAMAGE_PER_TICK, TICK_MS, LOD_THRESHOLD,
  groupOrderKey, deployZoneFor,
} from '../canvas/constants';
import { TERRAINS } from '../canvas/terrain-defs';
import {
  ALL_DETAIL_KEYS, detailAssetPath, DETAIL_RULES,
  spriteCategory, pickWeighted, seededRandom, getHexSeed,
  grassChunkPatch,
} from '../canvas/detail-rules';
import {
  type WaterFilterHandle,
  WATER_FILTER_CONFIGS, createWaterFilter,
} from '../canvas/water-filter';
import { HUD } from '../canvas/HUD';
import { generateWorldData as generateWorldDataPure, type GenSettings } from '../canvas/world-gen';

interface OrderDrag {
  team: Team;
  groupId: GroupId;
  formation: FormationType;
  depth: number;
  unitCount: number;
  targetHex: Hex;
  startWorld: { x: number; y: number };
  currentWorld: { x: number; y: number };
}

export const GameCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const worldRef = useRef<PIXI.Container>(new PIXI.Container());
  const terrainGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  // Hex-grid lines extracted into their own Graphics so the ticker can dim them on
  // zoom-out without re-running the (expensive) drawMap. Strokes are baked at alpha 1.0;
  // the layer's `alpha` property is set by the ticker each frame from world.scale.x.
  const gridGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  // Tinted deploy-zone strips. Repainted by `drawMap` alongside the grid; no separate
  // visibility toggle for now (always on in TACTICAL view).
  const deployZoneGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  // Capture zone (central 7-hex flower) — gold outline + soft fill. Sprite for the flag
  // sits inside the same container so it tweens with the world pan/zoom.
  const captureZoneGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  const captureFlagSpriteRef = useRef<PIXI.Sprite | null>(null);
  const captureFlagTextureRef = useRef<PIXI.Texture | null>(null);
  const highlightGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  const unitsGfx = useRef<PIXI.Container>(new PIXI.Container());
  // Per-unit containers keyed by unit.id. Persist across drawUnits calls so we can
  // GSAP-tween their position between hexes (smooth movement between ticks instead
  // of teleporting). Children inside each container use offsets relative to the
  // container origin (= unit's hex top-center pixel), so children move with the tween.
  const unitContainersRef = useRef<Map<string, PIXI.Container>>(new Map());
  const previewGfx = useRef<PIXI.Container>(new PIXI.Container());
  
  const noiseRef = useRef<ReturnType<typeof createNoise2D> | null>(null);
  // Separate noise instance for scatter-detail density so its zones don't align with
  // terrain features.
  const detailDensityNoiseRef = useRef<ReturnType<typeof createNoise2D> | null>(null);
  const armyTextureRef = useRef<PIXI.Texture | null>(null);
  const unitTextureRef = useRef<PIXI.Texture | null>(null);
  const unitTextureBlueRef = useRef<PIXI.Texture | null>(null);
  const unitTextureRedCavalryRef = useRef<PIXI.Texture | null>(null);
  const unitTextureBlueCavalryRef = useRef<PIXI.Texture | null>(null);
  const unitTextureRedSkirmisherRef = useRef<PIXI.Texture | null>(null);
  const unitTextureBlueSkirmisherRef = useRef<PIXI.Texture | null>(null);
  const javelinTextureRef = useRef<PIXI.Texture | null>(null);
  const grassTextureRef = useRef<PIXI.Texture | null>(null);
  const grassNoiseTextureRef = useRef<PIXI.Texture | null>(null);
  const grassMacroNoiseTextureRef = useRef<PIXI.Texture | null>(null);
  const grassPatchDryTextureRef = useRef<PIXI.Texture | null>(null);
  const grassPatchDenseTextureRef = useRef<PIXI.Texture | null>(null);
  const grassFlowerSpeckTextureRef = useRef<PIXI.Texture | null>(null);
  const forestTextureRef = useRef<PIXI.Texture | null>(null);
  const forestMacroVariationTextureRef = useRef<PIXI.Texture | null>(null);
  const forestDensePatchTextureRef = useRef<PIXI.Texture | null>(null);
  const forestMossPatchTextureRef = useRef<PIXI.Texture | null>(null);
  const riverTextureRef = useRef<PIXI.Texture | null>(null);
  const riverFlowVariationTextureRef = useRef<PIXI.Texture | null>(null);
  const riverDepthPatchTextureRef = useRef<PIXI.Texture | null>(null);
  const riverEdgeSoftnessTextureRef = useRef<PIXI.Texture | null>(null);
  const riverShimmerHighlightTextureRef = useRef<PIXI.Texture | null>(null);
  const hillTextureRef = useRef<PIXI.Texture | null>(null);
  const hillMacroNoiseTextureRef = useRef<PIXI.Texture | null>(null);
  const hillPatchDryTextureRef = useRef<PIXI.Texture | null>(null);
  const hillPatchDenseTextureRef = useRef<PIXI.Texture | null>(null);
  const mountainTextureRef = useRef<PIXI.Texture | null>(null);
  const snowTextureRef = useRef<PIXI.Texture | null>(null);
  const sandTextureRef = useRef<PIXI.Texture | null>(null);
  const seaTextureRef = useRef<PIXI.Texture | null>(null);
  const seaMacroNoiseTextureRef = useRef<PIXI.Texture | null>(null);
  const seaShallowPatchTextureRef = useRef<PIXI.Texture | null>(null);
  const seaDepthPatchTextureRef = useRef<PIXI.Texture | null>(null);
  const seaMicroNoiseTextureRef = useRef<PIXI.Texture | null>(null);
  const deepSeaTextureRef = useRef<PIXI.Texture | null>(null);
  const projectilesGfx = useRef<PIXI.Container>(new PIXI.Container());
  // Tiled-texture overlay container. Uses world-space UV tiling (TilingSprite + hex mask)
  // because PIXI's Graphics fill normalises UVs per polygon bbox, which produces visible
  // per-hex repetition.
  const terrainOverlayRef = useRef<PIXI.Container>(new PIXI.Container());
  const detailsGfx = useRef<PIXI.Container>(new PIXI.Container());
  const detailTexturesRef = useRef<Map<string, PIXI.Texture>>(new Map());
  const waterFilterHandlesRef = useRef<WaterFilterHandle[]>([]);

  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const zoom = useRef(0.5);
  const isPaintingRef = useRef(false);
  const lastPaintedKeyRef = useRef<string | null>(null);

  const [gridData, setGridData] = useState<{ hex: Hex; type: string }[]>([]);
  const [hoveredHex, setHoveredHex] = useState<Hex | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [viewMode, setViewMode] = useState<'STRATEGIC' | 'TACTICAL'>('STRATEGIC');
  const [armies, setArmies] = useState<Armies>(new Map());
  const [currentStrategicHex, setCurrentStrategicHex] = useState<Hex | null>(null);
  const [inputMode, setInputMode] = useState<InputMode | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team>('red');
  const [selectedGroup, setSelectedGroup] = useState<GroupId>(1);
  const [selectedUnitType, setSelectedUnitType] = useState<UnitType>('infantry');
  const [groupOrders, setGroupOrders] = useState<GroupOrders>(new Map());
  const [groupFormations, setGroupFormations] = useState<GroupFormations>(new Map());
  const [groupDepths, setGroupDepths] = useState<GroupDepths>(new Map());
  const [rosters, setRosters] = useState<Rosters>(makeInitialRosters);
  const [isBattleRunning, setIsBattleRunning] = useState(false);
  // Set true once terrain-related textures (currently just grass) finish loading.
  // drawMap reads it via deps so the map redraws once textures are ready.
  const [terrainTexturesLoaded, setTerrainTexturesLoaded] = useState(false);
  const [fogOfWar, setFogOfWar] = useState(false);
  const [genSettings, setSettings] = useState<GenSettings>({
    waterLevel: 0.4,
    mountainLevel: 0.85,
    noiseOffset: { q: 0, r: 0 },
    resolution: STRATEGIC_RESOLUTION // Much higher base resolution for smoothness
  });

  const gridRadius = 35;

  // --- Smooth Tactical Generator ---
  const generateWorldData = useCallback(() => {
    if (!noiseRef.current) noiseRef.current = createNoise2D();
    if (!detailDensityNoiseRef.current) detailDensityNoiseRef.current = createNoise2D();
    const { gridData } = generateWorldDataPure({
      settings: genSettings,
      gridRadius,
      viewMode,
      noise: noiseRef.current,
    });
    setGridData(gridData);
  }, [genSettings, gridRadius, viewMode]);

  const drawMap = useCallback(() => {
    const tGfx = terrainGfx.current;
    const gGfx = gridGfx.current;
    tGfx.clear();
    gGfx.clear();
    const dzGfx = deployZoneGfx.current;
    dzGfx.clear();
    const czGfx = captureZoneGfx.current;
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
        tGfx.beginFill(PIXI.Color.shared.setValue(color).multiply([shade, shade, shade, 1]).toNumber());
        tGfx.moveTo(top[v1].x, top[v1].y)
            .lineTo(top[v2].x, top[v2].y)
            .lineTo(base[v2].x, base[v2].y - bottomH)
            .lineTo(base[v1].x, base[v1].y - bottomH)
            .closePath().endFill();
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
      const sandTex = sandTextureRef.current;
      let fillStyle: { texture?: PIXI.Texture; matrix?: PIXI.Matrix; color: number };
      if (item.type === 'SAND' && sandTex) {
        fillStyle = { texture: sandTex, matrix: terrainUvMatrix, color: 0xC8C8C8 };
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
    const overlay = terrainOverlayRef.current;
    waterFilterHandlesRef.current = [];
    for (const child of overlay.children.slice()) {
      if ('mask' in child) (child as PIXI.Container).mask = null;
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
        texture: deepSeaTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 420,
        includeCliffs: false,
        waterFilter: 'deepSea',
      },
      {
        type: 'SEA',
        texture: seaTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 360,
        includeCliffs: false,
        waterFilter: 'coastal',
      },
      {
        type: 'SEA',
        texture: seaMacroNoiseTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 1800,
        alpha: 0.18,
        blendMode: 'soft-light',
        includeCliffs: false,
        waterFilter: 'coastal',
      },
      {
        type: 'SEA',
        texture: seaShallowPatchTextureRef.current,
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
        texture: seaDepthPatchTextureRef.current,
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
        texture: seaMicroNoiseTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 260,
        alpha: 0.10,
        blendMode: 'soft-light',
        includeCliffs: false,
        waterFilter: 'coastal',
      },
      { type: 'RIVER', texture: riverTextureRef.current, tint: 0xFFFFFF, tilePx: 120 },
      {
        type: 'RIVER',
        texture: riverFlowVariationTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 216,
        alpha: 0.35,
        blendMode: 'soft-light',
      },
      {
        type: 'RIVER',
        texture: riverDepthPatchTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 264,
        alpha: 0.18,
        blendMode: 'multiply',
      },
      {
        type: 'RIVER',
        texture: riverEdgeSoftnessTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 168,
        alpha: 0.16,
        blendMode: 'soft-light',
      },
      {
        type: 'RIVER',
        texture: riverShimmerHighlightTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 192,
        alpha: 0.45,
        blendMode: 'screen',
      },
      { type: 'GRASSLAND', texture: grassTextureRef.current, tint: 0xFFFFFF, tilePx: 200 },
      {
        type: 'GRASSLAND',
        texture: grassMacroNoiseTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 5000,
        alpha: 0.24,
        blendMode: 'multiply',
      },
      {
        type: 'GRASSLAND',
        texture: grassPatchDryTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 700,
        alpha: 0.65,
        blendMode: 'normal',
        hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed) === 'DRY',
      },
      {
        type: 'GRASSLAND',
        texture: grassPatchDenseTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 700,
        alpha: 0.22,
        blendMode: 'multiply',
        hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed) === 'DENSE',
      },
      {
        type: 'GRASSLAND',
        texture: grassFlowerSpeckTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 700,
        alpha: 0.50,
        // `multiply` would mud pink flowers into brown against grass green; `normal`
        // preserves the speck colour.
        blendMode: 'normal',
        hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed) === 'FLOWERY',
      },
      { type: 'FOREST', texture: forestTextureRef.current, tint: 0xFFFFFF, tilePx: 100 },
      {
        type: 'FOREST',
        texture: forestMacroVariationTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 300,
        alpha: 0.20,
        blendMode: 'overlay',
      },
      {
        type: 'FOREST',
        texture: forestDensePatchTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 250,
        alpha: 0.14,
        blendMode: 'multiply',
        hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed + 200) === 'DENSE',
      },
      {
        type: 'FOREST',
        texture: forestMossPatchTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 280,
        alpha: 0.40,
        blendMode: 'soft-light',
        hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed + 300) === 'DENSE',
      },
      {
        type: 'HILL',
        texture: hillTextureRef.current,
        tint: 0xE0E0E0,
        tilePx: 900,
        includeCliffs: false,
        paintCliffsBefore: 'HILL',
      },
      {
        type: 'HILL',
        texture: hillMacroNoiseTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 5000,
        alpha: 0.14,
        blendMode: 'multiply',
      },
      {
        type: 'HILL',
        texture: hillPatchDryTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 400,
        alpha: 0.30,
        blendMode: 'multiply',
        hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed + 100) === 'DRY',
      },
      {
        type: 'HILL',
        texture: hillPatchDenseTextureRef.current,
        tint: 0xFFFFFF,
        tilePx: 400,
        alpha: 0.30,
        blendMode: 'multiply',
        includeCliffs: false,
        hexFilter: (h) => grassChunkPatch(h.q, h.r, grassWorldSeed + 100) === 'DENSE',
      },
      {
        type: 'MOUNTAIN',
        texture: mountainTextureRef.current,
        tint: 0xC8C8C8,
        tilePx: viewMode === 'TACTICAL' ? 2100 : 700,
        includeCliffs: false,
        paintCliffsBefore: 'MOUNTAIN',
      },
      {
        type: 'SNOW',
        texture: snowTextureRef.current,
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
      const filteredContent = new PIXI.Container();
      layerContainer.x = minX;
      layerContainer.y = minY;
      filteredContent.addChild(tile);
      layerContainer.addChild(filteredContent);
      if (layer.waterFilter) {
        const handle = createWaterFilter(WATER_FILTER_CONFIGS[layer.waterFilter]);
        filteredContent.filters = [handle.filter];
        waterFilterHandlesRef.current.push(handle);
      }
      const mask = new PIXI.Graphics();
      for (const d of hexes) {
        const p = HexUtils.hexToPixel(d.hex);
        const topY = p.y - hexH;
        const topV: { x: number; y: number }[] = [];
        const pts: number[] = [];
        for (let i = 0; i < 6; i++) {
          const r = Math.PI / 180 * (60 * i);
          const vx = p.x + sz * Math.cos(r) - minX;
          const vy = topY + sz * Math.sin(r) - minY;
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
      overlay.addChild(layerContainer);
      layerContainer.addChild(mask);
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
    const flagSprite = captureFlagSpriteRef.current;
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
      const flag = captureFlagSpriteRef.current;
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
  }, [gridData, showGrid, terrainTexturesLoaded, viewMode]);

  // Three-layer scatter (embedded / small / landmark), deterministic per hex via seeded
  // RNG, with density modulated by a 2D simplex noise.
  const drawDetails = useCallback(() => {
    const dg = detailsGfx.current;
    for (const child of dg.children.slice()) {
      dg.removeChild(child);
      child.destroy();
    }
    if (detailTexturesRef.current.size === 0 || gridData.length === 0) return;
    const worldSeed = 1;
    const hexR = HexUtils.size;
    const densityNoise = detailDensityNoiseRef.current;
    // Maps simplex's [-1,1] to a density multiplier in [0.3, 1.7] over ~10-hex-wide zones.
    const densityMultAt = (q: number, r: number): number => {
      if (!densityNoise) return 1;
      return 1 + densityNoise(q * 0.08, r * 0.08) * 0.7;
    };
    // Per-layer seed offsets so the three layers' RNGs don't correlate.
    const LAYER_ORDER: Array<'embedded' | 'small' | 'landmark'> = ['embedded', 'small', 'landmark'];
    const LAYER_SEED_OFFSET: Record<string, number> = { embedded: 11, small: 23, landmark: 41 };

    for (const item of gridData) {
      const rules = DETAIL_RULES[item.type];
      if (!rules) continue;
      const pos = HexUtils.hexToPixel(item.hex);
      const hexH = (TERRAINS[item.type] ?? TERRAINS.SEA).height;
      const topY = pos.y - hexH;
      const densityMult = densityMultAt(item.hex.q, item.hex.r);

      for (const layerName of LAYER_ORDER) {
        const layer = rules[layerName];
        if (!layer) continue;
        const hexSeed = getHexSeed(item.hex.q, item.hex.r, worldSeed + LAYER_SEED_OFFSET[layerName]);
        const effDensity = Math.min(1, layer.density * densityMult);
        if (seededRandom(hexSeed) > effDensity) continue;

        const countRng = seededRandom(hexSeed + 1);
        const count = 1 + Math.floor(countRng * layer.maxPerHex); // 1..maxPerHex

        for (let i = 0; i < count; i++) {
          const spriteKey = pickWeighted(layer.sprites, seededRandom(hexSeed + i * 10 + 2));
          const tex = detailTexturesRef.current.get(spriteKey);
          if (!tex) continue;

          const angle = seededRandom(hexSeed + i * 20 + 3) * Math.PI * 2;
          const radius = layer.centered ? 0 : seededRandom(hexSeed + i * 30 + 4) * hexR * 0.35;
          const xOff = Math.cos(angle) * radius;
          const yOff = Math.sin(angle) * radius;

          const [scaleLo, scaleHi] = layer.scaleRange;
          const scale = scaleLo + seededRandom(hexSeed + i * 40 + 5) * (scaleHi - scaleLo);
          const [alphaLo, alphaHi] = layer.alphaRange;
          const alpha = alphaLo + seededRandom(hexSeed + i * 60 + 7) * (alphaHi - alphaLo);

          const category = spriteCategory(spriteKey);
          const tint = rules.categoryStyle[category]?.tint ?? 0xFFFFFF;
          const isWaterDetail = item.type === 'RIVER' || item.type === 'SEA';
          const rotation = 0;

          const sprite = new PIXI.Sprite(tex);
          sprite.anchor.set(0.5, isWaterDetail ? 0.5 : 0.85);
          sprite.x = pos.x + xOff;
          sprite.y = topY + yOff;
          sprite.scale.set(scale, scale);
          sprite.rotation = rotation;
          sprite.alpha = category === 'rock' ? 1.0 : alpha;
          sprite.tint = tint;
          dg.addChild(sprite);
        }
      }
    }
  }, [gridData]);

  useEffect(() => { drawDetails(); }, [gridData, terrainTexturesLoaded, drawDetails]);

  const drawUnits = useCallback(() => {
    const c = unitsGfx.current;
    const armyTex = armyTextureRef.current;
    const unitTex = unitTextureRef.current;
    const unitTexBlue = unitTextureBlueRef.current;
    const unitTexRedCav = unitTextureRedCavalryRef.current;
    const unitTexBlueCav = unitTextureBlueCavalryRef.current;
    const unitTexRedSkir = unitTextureRedSkirmisherRef.current;
    const unitTexBlueSkir = unitTextureBlueSkirmisherRef.current;
    if (!armyTex || !unitTex || !unitTexBlue || !unitTexRedCav || !unitTexBlueCav || !unitTexRedSkir || !unitTexBlueSkir) return;

    // Kill GSAP tweens before destroy so they don't touch a freed object next frame.
    const destroyAllUnitContainers = () => {
      unitContainersRef.current.forEach(cont => {
        gsap.killTweensOf(cont);
        gsap.killTweensOf(cont.position);
        cont.destroy({ children: true });
      });
      unitContainersRef.current.clear();
    };

    if (viewMode === 'STRATEGIC') {
      destroyAllUnitContainers();
      c.removeChildren();
      armies.forEach((_units, key) => {
        const strategicHex = HexUtils.fromKey(key);
        const tile = gridData.find(d => d.hex.q === strategicHex.q && d.hex.r === strategicHex.r);
        if (!tile) return;
        const pos = HexUtils.hexToPixel(strategicHex);
        const sprite = new PIXI.Sprite(armyTex);
        sprite.anchor.set(0.5, 1);
        sprite.x = pos.x;
        sprite.y = pos.y - TERRAINS[tile.type].height - 6;
        sprite.width = 40;
        sprite.height = 40;
        c.addChild(sprite);
      });
      return;
    }

    // TACTICAL
    if (!currentStrategicHex) {
      destroyAllUnitContainers();
      c.removeChildren();
      return;
    }
    const units = armies.get(HexUtils.key(currentStrategicHex)) ?? [];

    // Destroy containers for units that no longer exist so GSAP can't tween ghosts.
    const wantedIds = new Set(units.map(u => u.id));
    unitContainersRef.current.forEach((cont, id) => {
      if (!wantedIds.has(id)) {
        gsap.killTweensOf(cont);
        gsap.killTweensOf(cont.position);
        cont.destroy({ children: true });
        unitContainersRef.current.delete(id);
      }
    });
    for (let i = c.children.length - 1; i >= 0; i--) {
      if (c.children[i].label !== 'unit-container') c.removeChildAt(i);
    }

    // Lieutenant per (team, groupId): the unit at the attack target if an order is
    // active, else the lowest-id live unit so a marker still appears between orders.
    const lieutenantIds = new Set<string>();
    const lowestByGroup = new Map<string, Unit>();
    for (const u of units) {
      const k = `${u.team}:${u.groupId}`;
      const cur = lowestByGroup.get(k);
      if (!cur || u.id < cur.id) lowestByGroup.set(k, u);
    }
    lowestByGroup.forEach((lo, key) => {
      const order = groupOrders.get(key);
      if (order?.attackTarget) {
        const at = order.attackTarget;
        const onTarget = units.find(u =>
          `${u.team}:${u.groupId}` === key
          && u.tacticalHex.q === at.q && u.tacticalHex.r === at.r
        );
        lieutenantIds.add((onTarget ?? lo).id);
      } else {
        lieutenantIds.add(lo.id);
      }
    });

    // teamByKey is used by the team-outline edge filter below to skip edges shared with
    // a same-team neighbour (so a cluster shows only its outer perimeter). Mapping:
    // edge k ↔ neighbour at HexUtils.directions[(6 - k) % 6].
    const teamByKey = new Map<string, Team>();
    for (const u of units) teamByKey.set(HexUtils.key(u.tacticalHex), u.team);

    // Read scale directly — zoom.current is stale during a GSAP dive tween.
    const isFar = worldRef.current.scale.x < LOD_THRESHOLD;

    const visibleHexes = new Set<string>();
    if (fogOfWar) {
      for (const u of units) {
        if (u.team !== selectedTeam) continue;
        const r = u.visionRadius;
        for (let dq = -r; dq <= r; dq++) {
          for (let dr = -r; dr <= r; dr++) {
            const h = { q: u.tacticalHex.q + dq, r: u.tacticalHex.r + dr };
            if (HexUtils.distance(u.tacticalHex, h) <= r) {
              visibleHexes.add(HexUtils.key(h));
            }
          }
        }
      }
    }

    units.forEach(u => {
      const tile = gridData.find(d => d.hex.q === u.tacticalHex.q && d.hex.r === u.tacticalHex.r);
      if (!tile) return;
      const pos = HexUtils.hexToPixel(u.tacticalHex);
      const topY = pos.y - TERRAINS[tile.type].height;
      const hexKey = HexUtils.key(u.tacticalHex);
      // Includes topY so world regeneration (same hex, new terrain type) re-targets
      // the container instead of leaving the unit floating at the old elevation.
      const targetKey = `${hexKey}|${Math.round(topY)}`;

      // Compare against the last TARGET key (not container.position, which is mid-tween)
      // so non-movement re-renders (fog toggle, hover) don't restart the animation.
      let container = unitContainersRef.current.get(u.id);
      if (!container) {
        container = new PIXI.Container();
        container.label = 'unit-container';
        container.position.set(pos.x, topY);
        (container as unknown as { _targetKey: string })._targetKey = targetKey;
        unitContainersRef.current.set(u.id, container);
        c.addChild(container);
      } else if ((container as unknown as { _targetKey?: string })._targetKey !== targetKey) {
        (container as unknown as { _targetKey: string })._targetKey = targetKey;
        // Stretch the tween over the destination terrain's cooldown so the unit GLIDES
        // across rough hexes instead of teleporting in TICK_MS and then sitting idle for
        // the moveCost cooldown ticks. The sim's discrete steps remain — only the
        // visual interpolation changes. By the time the tween finishes the cooldown is
        // also up, so the next step engages immediately → smooth and slow.
        const moveCost = getTerrainMods(tile.type).moveCost;
        gsap.to(container.position, {
          x: pos.x,
          y: topY,
          duration: (TICK_MS * (1 + moveCost)) / 1000,
          ease: 'linear',
          overwrite: true,
        });
      }

      // Position keeps tweening while hidden so a fog reveal shows the unit at its
      // current location, not the last-seen one. Children rebuild every frame so HP
      // bars / lieutenant markers stay current.
      const isHidden = fogOfWar && u.team !== selectedTeam && !visibleHexes.has(hexKey);
      container.visible = !isHidden;

      container.removeChildren();

      const teamColor = TEAM_TINTS[u.team];
      const s = HexUtils.size;
      const verts: { x: number; y: number }[] = [];
      for (let k = 0; k < 6; k++) {
        const ang = Math.PI / 180 * (60 * k);
        verts.push({ x: s * Math.cos(ang), y: s * Math.sin(ang) });
      }

      // Strategic-view team marker; drawn before the outline so strokes sit on top.
      const marker = new PIXI.Graphics();
      marker.poly(verts.flatMap(v => [v.x, v.y])).fill({ color: teamColor, alpha: 0.7 });
      marker.label = 'unit-marker';
      marker.visible = isFar;
      container.addChild(marker);

      const outline = new PIXI.Graphics();
      for (let k = 0; k < 6; k++) {
        const dir = HexUtils.directions[(6 - k) % 6];
        const nKey = HexUtils.key({ q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r });
        if (teamByKey.get(nKey) === u.team) continue;
        const a = verts[k];
        const b = verts[(k + 1) % 6];
        outline.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      outline.stroke({ color: teamColor, width: 3, alpha: 0.95 });
      container.addChild(outline);

      const unitType = u.unitType ?? 'infantry';
      const tex = u.team === 'red'
        ? (unitType === 'skirmisher' ? unitTexRedSkir : unitType === 'cavalry' ? unitTexRedCav : unitTex)
        : (unitType === 'skirmisher' ? unitTexBlueSkir : unitType === 'cavalry' ? unitTexBlueCav : unitTexBlue);
      const sprite = new PIXI.Sprite(tex);
      sprite.anchor.set(0.5, 1);
      sprite.x = 0;
      sprite.y = 32;
      // Red cavalry/skirmisher art has more empty bbox margin than the infantry sprite,
      // so render bigger to match the visible silhouette.
      const isOversizedRedSprite = u.team === 'red' && (unitType === 'cavalry' || unitType === 'skirmisher');
      const spriteSize = isOversizedRedSprite ? 100 : 72;
      sprite.width = spriteSize;
      sprite.height = spriteSize;
      sprite.label = 'unit-sprite';
      sprite.visible = !isFar;
      container.addChild(sprite);

      // Per-type denominator so cavalry's 30/60 fills 50% (not the 30% an infantry would).
      const maxHp = MAX_HP_BY_TYPE[unitType];
      if (u.hp < maxHp) {
        const barW = 26;
        const barH = 4;
        const barX = -barW / 2;
        const barY = -40;
        const ratio = Math.max(0, u.hp / maxHp);
        const bg = new PIXI.Graphics();
        bg.rect(barX, barY, barW, barH).fill({ color: 0x000000, alpha: 0.6 });
        bg.label = 'unit-detail';
        bg.visible = !isFar;
        container.addChild(bg);
        const fg = new PIXI.Graphics();
        const r = Math.round(0xef * (1 - ratio) + 0x10 * ratio);
        const g = Math.round(0x44 * (1 - ratio) + 0xb9 * ratio);
        const b = Math.round(0x44 * (1 - ratio) + 0x81 * ratio);
        const color = (r << 16) | (g << 8) | b;
        fg.rect(barX, barY, barW * ratio, barH).fill({ color });
        fg.label = 'unit-detail';
        fg.visible = !isFar;
        container.addChild(fg);
      }

      if (lieutenantIds.has(u.id)) {
        const star = new PIXI.Text({
          text: '★',
          style: { fontSize: 14, fontWeight: '900', fill: 0xfacc15, stroke: { color: 0x000000, width: 2 } },
        });
        star.anchor.set(0.5);
        star.x = 0;
        star.y = -44;
        star.label = 'unit-detail';
        star.visible = !isFar;
        container.addChild(star);

        const order = groupOrders.get(`${u.team}:${u.groupId}`);
        if (order?.attackTarget) {
          const arrow = new PIXI.Text({
            text: HEADING_ARROWS[order.heading] ?? '→',
            style: { fontSize: 14, fontWeight: '900', fill: 0xfacc15, stroke: { color: 0x000000, width: 2 } },
          });
          arrow.anchor.set(0.5);
          arrow.x = 14;
          arrow.y = -44;
          arrow.label = 'unit-detail';
          arrow.visible = !isFar;
          container.addChild(arrow);
        }
      }
    });

    // Attack target indicators per group. Tagged 'unit-detail' for LOD hiding.
    // Fog of war: skip rings owned by the OTHER team — they would otherwise leak
    // enemy intent through fog (you'd see where they're charging without seeing them).
    groupOrders.forEach(order => {
      if (!order.attackTarget) return;
      if (fogOfWar && order.team !== selectedTeam) return;
      const tile = gridData.find(d => d.hex.q === order.attackTarget!.q && d.hex.r === order.attackTarget!.r);
      if (!tile) return;
      const pos = HexUtils.hexToPixel(order.attackTarget);
      const topY = pos.y - TERRAINS[tile.type].height;
      const ring = new PIXI.Graphics();
      ring.circle(pos.x, topY, 22).stroke({ width: 3, color: TEAM_TINTS[order.team], alpha: 0.85 });
      ring.label = 'unit-detail';
      ring.visible = !isFar;
      c.addChild(ring);
    });
  }, [armies, viewMode, gridData, currentStrategicHex, groupOrders, fogOfWar, selectedTeam]);

  // Order mutation helpers declared up here (before the mount useEffect / interval useEffect
  // that capture them) so the closures inside those long-lived handlers can resolve the
  // identifiers in source order without lint complaints. `groupOrdersRef` is hoisted here for
  // the same reason; its mirror useEffect stays with the other ref mirrors below.
  const groupOrdersRef = useRef<GroupOrders>(new Map());

  // Single-entry order mutation. Both the UI handlers and the AI controllers go through
  // here. Mutates `groupOrdersRef.current` synchronously AND calls `setGroupOrders`, so
  // - back-to-back calls in the same handler each see the prior call's write,
  // - the very next `simulateTick` in the tick loop sees AI-issued orders (no 1-tick
  //   delay waiting for React to flush),
  // - React still gets a new Map reference and re-renders the HUD as before.
  // When the order doesn't exist yet, a default skeleton is created — `change` only
  // needs to specify the fields it cares about.
  const issueOrder = useCallback((team: Team, groupId: GroupId, change: OrderChange) => {
    const key = groupOrderKey(team, groupId);
    const next = new Map(groupOrdersRef.current);
    const existing = next.get(key);
    // Lifecycle lock: once `committed` is true (set when the player chose `unleash`), the
    // only further intent change accepted is `mode: 'retreat'`. The sim's own writes
    // (chargeTicksRemaining ticks, sim-clear-on-redeploy-zone) skip this guard by going
    // through the writeOrder code path, not through issueOrder.
    if (existing?.committed) {
      const isRetreatRequest = change.mode === 'retreat';
      const touchesIntent = 'mode' in change || 'heading' in change || 'attackTarget' in change;
      if (touchesIntent && !isRetreatRequest) return;
    }
    next.set(key, {
      team, groupId, attackTarget: null, heading: 0,
      ...existing,
      ...change,
    });
    groupOrdersRef.current = next;
    setGroupOrders(next);
  }, []);

  const clearOrder = useCallback((team: Team, groupId: GroupId) => {
    const key = groupOrderKey(team, groupId);
    if (!groupOrdersRef.current.has(key)) return;
    const next = new Map(groupOrdersRef.current);
    next.delete(key);
    groupOrdersRef.current = next;
    setGroupOrders(next);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const app = new PIXI.Application();
    const start = async () => {
      await app.init({ resizeTo: window, backgroundColor: 0x050a14, antialias: true });
      // The army SVG is natively 40×40 — too low for high-DPI. Pre-rasterise to a
      // higher-res canvas so PIXI downsamples instead of upsampling.
      const loadHighResSvgTexture = async (url: string, pixelSize: number): Promise<PIXI.Texture> => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = pixelSize;
        canvas.height = pixelSize;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, pixelSize, pixelSize);
        return PIXI.Texture.from(canvas);
      };

      const [armyTex, romanSoldierTex, hopliteTex, mountedKnightTex, cavalryHopliteTex, romanSkirmisherTex, skirmisherTex, javelinTex, grassTex, grassNoiseTex, grassMacroNoiseTex, grassPatchDryTex, grassPatchDenseTex, grassFlowerSpeckTex, forestTex, forestMacroVariationTex, forestDensePatchTex, forestMossPatchTex, riverTex, riverFlowVariationTex, riverDepthPatchTex, riverEdgeSoftnessTex, riverShimmerHighlightTex, hillTex, hillMacroNoiseTex, hillPatchDryTex, hillPatchDenseTex, mountainTex, snowTex, sandTex, seaTex, seaMacroNoiseTex, seaShallowPatchTex, seaDepthPatchTex, seaMicroNoiseTex, deepSeaTex] = await Promise.all([
        loadHighResSvgTexture('/units/army.svg', 160),
        PIXI.Assets.load<PIXI.Texture>('/units/roman_soldier.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/hoplite.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/mounted-knight.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/cavalry-hoplite.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/roman_skirmisher.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/skirmisher.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/javelin.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/grass.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/grass-noise.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/grass-macro-noise.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/grass-patch-dry.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/grass-patch-dense.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/grass-flower-speck.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/forest.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/forest-macro-variation.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/forest-dense-patch.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/forest-moss-patch.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/river.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/river-flow-variation.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/river-depth-patch.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/river-edge-softness.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/river-shimmer-highlight.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/hill.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/hill-macro-noise.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/hill-patch-dry.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/hill-patch-dense.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/mountain.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/snow.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/sand.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/sea.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/sea-macro-noise.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/sea-shallow-patch.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/sea-depth-patch.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/sea-micro-noise.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/deep-sea.png'),
      ]);
      if (!isMounted) return;
      // LINEAR + auto-mipmaps so heavy minification at strategic zoom doesn't alias.
      for (const tex of [romanSoldierTex, hopliteTex, mountedKnightTex, cavalryHopliteTex, romanSkirmisherTex, skirmisherTex, javelinTex, grassTex, grassNoiseTex, grassMacroNoiseTex, grassPatchDryTex, grassPatchDenseTex, grassFlowerSpeckTex, forestTex, forestMacroVariationTex, forestDensePatchTex, forestMossPatchTex, riverTex, riverFlowVariationTex, riverDepthPatchTex, riverEdgeSoftnessTex, riverShimmerHighlightTex, hillTex, hillMacroNoiseTex, hillPatchDryTex, hillPatchDenseTex, mountainTex, snowTex, sandTex, seaTex, seaMacroNoiseTex, seaShallowPatchTex, seaDepthPatchTex, seaMicroNoiseTex, deepSeaTex]) {
        tex.source.scaleMode = 'linear';
        tex.source.autoGenerateMipmaps = true;
        tex.source.updateMipmaps();
      }
      // 'repeat' wrap so the TilingSprite overlays tile continuously across each biome.
      grassTex.source.addressMode = 'repeat';
      grassNoiseTex.source.addressMode = 'repeat';
      grassMacroNoiseTex.source.addressMode = 'repeat';
      grassPatchDryTex.source.addressMode = 'repeat';
      grassPatchDenseTex.source.addressMode = 'repeat';
      grassFlowerSpeckTex.source.addressMode = 'repeat';
      forestTex.source.addressMode = 'repeat';
      forestMacroVariationTex.source.addressMode = 'repeat';
      forestDensePatchTex.source.addressMode = 'repeat';
      forestMossPatchTex.source.addressMode = 'repeat';
      riverTex.source.addressMode = 'repeat';
      riverFlowVariationTex.source.addressMode = 'repeat';
      riverDepthPatchTex.source.addressMode = 'repeat';
      riverEdgeSoftnessTex.source.addressMode = 'repeat';
      riverShimmerHighlightTex.source.addressMode = 'repeat';
      hillTex.source.addressMode = 'repeat';
      hillMacroNoiseTex.source.addressMode = 'repeat';
      hillPatchDryTex.source.addressMode = 'repeat';
      hillPatchDenseTex.source.addressMode = 'repeat';
      mountainTex.source.addressMode = 'repeat';
      snowTex.source.addressMode = 'repeat';
      sandTex.source.addressMode = 'repeat';
      seaTex.source.addressMode = 'repeat';
      seaMacroNoiseTex.source.addressMode = 'repeat';
      seaShallowPatchTex.source.addressMode = 'repeat';
      seaDepthPatchTex.source.addressMode = 'repeat';
      seaMicroNoiseTex.source.addressMode = 'repeat';
      deepSeaTex.source.addressMode = 'repeat';
      armyTextureRef.current = armyTex;
      unitTextureRef.current = romanSoldierTex;
      unitTextureBlueRef.current = hopliteTex;
      unitTextureRedCavalryRef.current = mountedKnightTex;
      unitTextureBlueCavalryRef.current = cavalryHopliteTex;
      unitTextureRedSkirmisherRef.current = romanSkirmisherTex;
      unitTextureBlueSkirmisherRef.current = skirmisherTex;
      javelinTextureRef.current = javelinTex;
      // Capture-the-flag marker — loaded once at mount, positioned at hex (0,0).
      const winFlagTex = await PIXI.Assets.load<PIXI.Texture>('/assets/win-flag.png');
      if (!isMounted) return;
      winFlagTex.source.scaleMode = 'linear';
      winFlagTex.source.autoGenerateMipmaps = true;
      winFlagTex.source.updateMipmaps();
      captureFlagTextureRef.current = winFlagTex;
      const flagSprite = new PIXI.Sprite(winFlagTex);
      flagSprite.anchor.set(0.5, 1.0); // bottom-centre so the pole base sits on the hex top
      const flagPos = HexUtils.hexToPixel(CAPTURE_CENTER);
      const flagScale = (HexUtils.size * 1.4) / winFlagTex.width;
      flagSprite.scale.set(flagScale);
      flagSprite.x = flagPos.x;
      flagSprite.y = flagPos.y - 8; // sit on the hex top (terrain height applied in drawMap, this is OK as a default)
      captureFlagSpriteRef.current = flagSprite;
      // Note: world tree is built below — flag is added to `world` there alongside its
      // graphics layer so it ends up at a deterministic z-order (above the zone outline
      // but below grid/units).
      const detailTexs = await Promise.all(
        ALL_DETAIL_KEYS.map(k => PIXI.Assets.load<PIXI.Texture>(detailAssetPath(k))),
      );
      if (!isMounted) return;
      for (let i = 0; i < ALL_DETAIL_KEYS.length; i++) {
        const tex = detailTexs[i];
        tex.source.scaleMode = 'linear';
        tex.source.autoGenerateMipmaps = true;
        tex.source.updateMipmaps();
        detailTexturesRef.current.set(ALL_DETAIL_KEYS[i], tex);
      }
      grassTextureRef.current = grassTex;
      grassNoiseTextureRef.current = grassNoiseTex;
      grassMacroNoiseTextureRef.current = grassMacroNoiseTex;
      grassPatchDryTextureRef.current = grassPatchDryTex;
      grassPatchDenseTextureRef.current = grassPatchDenseTex;
      grassFlowerSpeckTextureRef.current = grassFlowerSpeckTex;
      forestTextureRef.current = forestTex;
      forestMacroVariationTextureRef.current = forestMacroVariationTex;
      forestDensePatchTextureRef.current = forestDensePatchTex;
      forestMossPatchTextureRef.current = forestMossPatchTex;
      riverTextureRef.current = riverTex;
      riverFlowVariationTextureRef.current = riverFlowVariationTex;
      riverDepthPatchTextureRef.current = riverDepthPatchTex;
      riverEdgeSoftnessTextureRef.current = riverEdgeSoftnessTex;
      riverShimmerHighlightTextureRef.current = riverShimmerHighlightTex;
      hillTextureRef.current = hillTex;
      hillMacroNoiseTextureRef.current = hillMacroNoiseTex;
      hillPatchDryTextureRef.current = hillPatchDryTex;
      hillPatchDenseTextureRef.current = hillPatchDenseTex;
      mountainTextureRef.current = mountainTex;
      snowTextureRef.current = snowTex;
      sandTextureRef.current = sandTex;
      seaTextureRef.current = seaTex;
      seaMacroNoiseTextureRef.current = seaMacroNoiseTex;
      seaShallowPatchTextureRef.current = seaShallowPatchTex;
      seaDepthPatchTextureRef.current = seaDepthPatchTex;
      seaMicroNoiseTextureRef.current = seaMicroNoiseTex;
      deepSeaTextureRef.current = deepSeaTex;
      setTerrainTexturesLoaded(true);
      if (!containerRef.current) return;
      containerRef.current.appendChild(app.canvas);
      appRef.current = app;
      const world = worldRef.current;
      world.x = app.screen.width / 2; world.y = app.screen.height / 2; world.scale.set(zoom.current);
      app.stage.addChild(world);
      // World z-order: terrain → painted overlay → scatter details → grid → units →
      // projectiles → drag previews → hover highlights.
      world.addChild(terrainGfx.current);
      world.addChild(terrainOverlayRef.current);
      world.addChild(detailsGfx.current);
      world.addChild(deployZoneGfx.current);
      world.addChild(captureZoneGfx.current);
      if (captureFlagSpriteRef.current) world.addChild(captureFlagSpriteRef.current);
      world.addChild(gridGfx.current);
      world.addChild(unitsGfx.current);
      world.addChild(projectilesGfx.current);
      world.addChild(previewGfx.current);
      world.addChild(highlightGfx.current);
      
      app.stage.eventMode = 'static'; app.stage.hitArea = app.screen;

      // Drop a cohort centered on `hex`: the clicked hex plus its in-zone unoccupied
      // neighbours, up to `COHORT_SIZE` units (capped by roster remaining). Refused
      // outright if the clicked hex is outside the active team's deploy zone or its
      // roster is empty for this type. Each click = at most one cohort (the paint loop's
      // hex-dedupe guard at the top prevents the same drag re-firing on the same hex).
      const paintPlace = (hex: Hex) => {
        const strategicHex = currentStrategicHexRef.current;
        if (!strategicHex) return;
        const hexKey = HexUtils.key(hex);
        if (lastPaintedKeyRef.current === hexKey) return;
        lastPaintedKeyRef.current = hexKey;
        const team = selectedTeamRef.current;
        const zone = deployZoneFor(team, gridDataRef.current);
        if (!zone.has(hexKey)) return;
        const unitType = selectedUnitTypeRef.current;
        const remaining = rostersRef.current.get(team)?.[unitType] ?? 0;
        if (remaining <= 0) return;
        const strategicKey = HexUtils.key(strategicHex);
        const existing = armiesRef.current.get(strategicKey) ?? [];
        const occupied = new Set(existing.map(u => HexUtils.key(u.tacticalHex)));
        const target: Hex[] = [];
        const candidates: Hex[] = [hex, ...HexUtils.getNeighbors(hex)];
        const cap = Math.min(COHORT_SIZE, remaining);
        for (const c of candidates) {
          if (target.length >= cap) break;
          const k = HexUtils.key(c);
          if (!zone.has(k) || occupied.has(k)) continue;
          target.push(c);
          occupied.add(k);
        }
        if (target.length === 0) return;
        const groupId = selectedGroupRef.current;
        const newUnits: Unit[] = target.map(h => {
          const placementType = gridDataRef.current.find(d => d.hex.q === h.q && d.hex.r === h.r)?.type;
          return {
            id: crypto.randomUUID(),
            team,
            unitType,
            tacticalHex: h,
            homeHex: h,
            groupId,
            hp: MAX_HP_BY_TYPE[unitType],
            state: 'idle',
            nextMoveTick: 0,
            visionRadius: getTerrainMods(placementType).visionRadius,
          };
        });
        setArmies(prev => {
          const next = new Map(prev);
          const cur = next.get(strategicKey) ?? [];
          next.set(strategicKey, [...cur, ...newUnits]);
          return next;
        });
        setRosters(prev => {
          const next = new Map(prev);
          const r = next.get(team) ?? { ...INITIAL_ROSTER };
          next.set(team, { ...r, [unitType]: r[unitType] - newUnits.length });
          return next;
        });
      };

      const paintAssign = (hex: Hex) => {
        const strategicHex = currentStrategicHexRef.current;
        if (!strategicHex) return;
        const hexKey = HexUtils.key(hex);
        if (lastPaintedKeyRef.current === hexKey) return;
        lastPaintedKeyRef.current = hexKey;
        const strategicKey = HexUtils.key(strategicHex);
        const team = selectedTeamRef.current;
        const groupId = selectedGroupRef.current;
        setArmies(prev => {
          const existing = prev.get(strategicKey) ?? [];
          let mutated = false;
          const updated = existing.map(u => {
            if (u.team === team && u.tacticalHex.q === hex.q && u.tacticalHex.r === hex.r && u.groupId !== groupId) {
              mutated = true;
              return { ...u, groupId };
            }
            return u;
          });
          if (!mutated) return prev;
          const next = new Map(prev);
          next.set(strategicKey, updated);
          return next;
        });
      };

      const paintAt = (hex: Hex) => {
        if (inputModeRef.current === 'place') paintPlace(hex);
        else if (inputModeRef.current === 'assign') paintAssign(hex);
      };

      const renderOrderPreview = () => {
        const gfx = previewGfx.current;
        gfx.removeChildren();
        const drag = orderDragRef.current;
        if (!drag) return;

        const dx = drag.currentWorld.x - drag.startWorld.x;
        const dy = drag.currentWorld.y - drag.startWorld.y;
        const screenDist = Math.hypot(dx, dy) * zoom.current;
        const dragEndHex = HexUtils.pixelToHex({ x: drag.currentWorld.x, y: drag.currentWorld.y });
        const dragHexDist = HexUtils.distance(drag.targetHex, dragEndHex);

        let slots: Hex[];
        let heading: number;
        // Continuous-angle drag for LINE / WEDGE; other formations use 6-snap.
        if (drag.formation === 'line' && dragHexDist >= 1) {
          const r = computeLineDragSlots(drag.unitCount, drag.targetHex, dragEndHex);
          slots = r.slots;
          heading = r.headingForward;
        } else if (drag.formation === 'wedge' && dragHexDist >= 1) {
          const r = computeWedgeDragSlots(drag.unitCount, drag.targetHex, dragEndHex);
          slots = r.slots;
          heading = r.headingForward;
        } else if (drag.formation === 'hex' && dragHexDist >= 1) {
          const r = computeHexDragSlots(drag.unitCount, drag.targetHex, dragEndHex);
          slots = r.slots;
          heading = r.headingForward;
        } else {
          if (screenDist >= DRAG_THRESHOLD_PX) {
            heading = snapHeading(dx, dy);
          } else {
            const strategic = currentStrategicHexRef.current;
            const groupUnits = strategic
              ? (armiesRef.current.get(HexUtils.key(strategic)) ?? []).filter(
                  u => u.team === drag.team && u.groupId === drag.groupId,
                )
              : [];
            heading = groupHeading(groupUnits, drag.targetHex);
          }
          slots = computeFormationPreview(drag.unitCount, drag.targetHex, heading, drag.formation, drag.depth);
        }
        const teamColor = TEAM_TINTS[drag.team];

        slots.forEach((slot, i) => {
          const pos = HexUtils.hexToPixel(slot);
          const tile = gridDataRef.current.find(d => d.hex.q === slot.q && d.hex.r === slot.r);
          const topY = pos.y - (tile ? TERRAINS[tile.type].height : 0);

          const isLieutenant = i === 0;
          const hex = new PIXI.Graphics();
          hex.lineStyle(isLieutenant ? 3 : 2, isLieutenant ? 0xfacc15 : teamColor, isLieutenant ? 0.95 : 0.75);
          hex.beginFill(isLieutenant ? 0xfacc15 : teamColor, 0.18);
          const s = HexUtils.size;
          for (let k = 0; k < 6; k++) {
            const r = Math.PI / 180 * (60 * k);
            if (k === 0) hex.moveTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
            else hex.lineTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
          }
          hex.closePath().endFill();
          gfx.addChild(hex);

          if (isLieutenant) {
            const star = new PIXI.Text({
              text: '★',
              style: { fontSize: 14, fontWeight: '900', fill: 0xfacc15, stroke: { color: 0x000000, width: 2 } },
            });
            star.anchor.set(0.5);
            star.x = pos.x;
            star.y = topY - 44;
            gfx.addChild(star);

            const arrow = new PIXI.Text({
              text: HEADING_ARROWS[heading] ?? '→',
              style: { fontSize: 14, fontWeight: '900', fill: 0xfacc15, stroke: { color: 0x000000, width: 2 } },
            });
            arrow.anchor.set(0.5);
            arrow.x = pos.x + 14;
            arrow.y = topY - 44;
            gfx.addChild(arrow);
          }
        });
      };

      const cancelOrderDrag = () => {
        orderDragRef.current = null;
        previewGfx.current.removeChildren();
      };

      app.stage.on('pointerdown', (e) => {
        const mode = inputModeRef.current;
        if ((mode === 'place' || mode === 'assign') && currentStrategicHexRef.current) {
          isPaintingRef.current = true;
          lastPaintedKeyRef.current = null;
          const local = world.toLocal(e.global);
          paintAt(HexUtils.pixelToHex({ x: local.x, y: local.y }));
          return;
        }
        if (mode === 'order' && currentStrategicHexRef.current) {
          const team = selectedTeamRef.current;
          const groupId = selectedGroupRef.current;
          const strategicKey = HexUtils.key(currentStrategicHexRef.current);
          const groupUnits = (armiesRef.current.get(strategicKey) ?? []).filter(
            u => u.team === team && u.groupId === groupId,
          );
          if (groupUnits.length === 0) return;
          const local = world.toLocal(e.global);
          const targetHex = HexUtils.pixelToHex({ x: local.x, y: local.y });
          const formation = groupFormationsRef.current.get(groupOrderKey(team, groupId)) ?? 'line';
          const depth = groupDepthsRef.current.get(groupOrderKey(team, groupId)) ?? 1;
          orderDragRef.current = {
            team,
            groupId,
            formation,
            depth,
            unitCount: groupUnits.length,
            targetHex,
            startWorld: { x: local.x, y: local.y },
            currentWorld: { x: local.x, y: local.y },
          };
          renderOrderPreview();
          return;
        }
        isDragging.current = true;
        lastMousePos.current = { x: e.global.x, y: e.global.y };
      });
      app.stage.on('globalpointermove', (e) => {
        if (isDragging.current) { world.x += e.global.x - lastMousePos.current.x; world.y += e.global.y - lastMousePos.current.y; lastMousePos.current = { x: e.global.x, y: e.global.y }; }
        const local = world.toLocal(e.global);
        const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        setHoveredHex(hex);
        if (isPaintingRef.current) paintAt(hex);
        if (orderDragRef.current) {
          orderDragRef.current.currentWorld = { x: local.x, y: local.y };
          renderOrderPreview();
        }
      });
      app.stage.on('pointerup', () => {
        const drag = orderDragRef.current;
        if (drag) {
          const dx = drag.currentWorld.x - drag.startWorld.x;
          const dy = drag.currentWorld.y - drag.startWorld.y;
          const screenDist = Math.hypot(dx, dy) * zoom.current;
          const strategic = currentStrategicHexRef.current;
          const groupUnits = strategic
            ? (armiesRef.current.get(HexUtils.key(strategic)) ?? []).filter(
                u => u.team === drag.team && u.groupId === drag.groupId,
              )
            : [];
          const dragEndHex = HexUtils.pixelToHex({ x: drag.currentWorld.x, y: drag.currentWorld.y });
          const dragHexDist = HexUtils.distance(drag.targetHex, dragEndHex);

          let heading: number;
          let slots: Hex[];
          let lineFrontWidth = 0;
          if (drag.formation === 'line' && dragHexDist >= 1) {
            const r = computeLineDragSlots(drag.unitCount, drag.targetHex, dragEndHex);
            heading = r.headingForward;
            slots = r.slots;
            lineFrontWidth = r.frontWidth;
          } else if (drag.formation === 'wedge' && dragHexDist >= 1) {
            const r = computeWedgeDragSlots(drag.unitCount, drag.targetHex, dragEndHex);
            heading = r.headingForward;
            slots = r.slots;
          } else if (drag.formation === 'hex' && dragHexDist >= 1) {
            const r = computeHexDragSlots(drag.unitCount, drag.targetHex, dragEndHex);
            heading = r.headingForward;
            slots = r.slots;
          } else {
            heading = screenDist >= DRAG_THRESHOLD_PX
              ? snapHeading(dx, dy)
              : groupHeading(groupUnits, drag.targetHex);
            slots = computeFormationPreview(
              groupUnits.length, drag.targetHex, heading, drag.formation, drag.depth,
            );
          }

          // LINE pairs by role (cav→flanks, skir→front-center, inf→back); other
          // formations keep the march-projection pairing.
          const pairing = lineFrontWidth > 0
            ? computeLineSlotAssignmentsByType(groupUnits, slots, drag.targetHex, lineFrontWidth)
            : computeOrderedSlotAssignments(groupUnits, slots, drag.targetHex);

          // Deploy validation: every slot must be in-bounds, walkable, and not occupied by a
          // unit outside this group. All-or-nothing.
          const gridSet = new Set(gridDataRef.current.map(d => HexUtils.key(d.hex)));
          const terrainAt = new Map(gridDataRef.current.map(d => [HexUtils.key(d.hex), d.type]));
          const allUnits = strategic ? armiesRef.current.get(HexUtils.key(strategic)) ?? [] : [];
          const groupIds = new Set(groupUnits.map(u => u.id));
          const occupantByHex = new Map<string, Unit>();
          for (const u of allUnits) {
            if (!groupIds.has(u.id)) occupantByHex.set(HexUtils.key(u.tacticalHex), u);
          }
          let deployValid = pairing.size === groupUnits.length;
          if (deployValid) {
            for (const slot of pairing.values()) {
              const k = HexUtils.key(slot);
              if (!gridSet.has(k)) { deployValid = false; break; }
              const tType = terrainAt.get(k);
              if (!tType || !TERRAINS[tType].walkable) { deployValid = false; break; }
              if (occupantByHex.has(k)) { deployValid = false; break; }
            }
          }

          if (deployValid && strategic) {
            // Snap units to their paired slots, then write the order with attackTarget = press.
            setArmies(prev => {
              const updated = new Map(prev);
              const arr = (updated.get(HexUtils.key(strategic)) ?? []).map(u => {
                const slot = pairing.get(u.id);
                if (slot) return { ...u, tacticalHex: slot };
                return u;
              });
              updated.set(HexUtils.key(strategic), arr);
              return updated;
            });
            // New orders default to 'idle' (units stand at the deploy with heading set but
            // don't auto-march); re-drag while marching/holding/etc. preserves the mode so
            // the player can redirect mid-flight. Press A to start (or cycle) the march.
            {
              const prior = groupOrdersRef.current.get(groupOrderKey(drag.team, drag.groupId));
              const change: OrderChange = { attackTarget: drag.targetHex, heading: snapToForwardCone(drag.team, heading) };
              if (!prior?.mode) change.mode = 'idle';
              issueOrder(drag.team, drag.groupId, change);
            }
          }
          setInputMode(null);
          cancelOrderDrag();
        }
        isDragging.current = false;
        isPaintingRef.current = false;
        lastPaintedKeyRef.current = null;
      });
      app.stage.on('pointertap', (e) => {
        if (isDragging.current) return;
        // Order commits in pointerup (captures drag direction); pointertap is a no-op.
        if (inputModeRef.current === 'order') return;
        const local = world.toLocal(e.global); const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        if (isScanningRef.current) {
          // CAPTURE GLOBAL NOISE COORDS
          // Tactical center hex (0,0) must sample the same noise point as the clicked strategic hex.
          // Since (newOffset / newRes) = (clickedHex + currentOffset) / currentRes and newRes = currentRes * DIVE_ZOOM,
          // the offset must be scaled by DIVE_ZOOM.
          const targetOffsetQ = (hex.q + noiseOffsetRef.current.q) * DIVE_ZOOM;
          const targetOffsetR = (hex.r + noiseOffsetRef.current.r) * DIVE_ZOOM;

          gsap.to(world.scale, { x: 3, y: 3, duration: 0.6, ease: 'power2.in' });
          gsap.to(world, { x: app.screen.width/2 - (hex.q * 20), y: app.screen.height/2 - (hex.r * 20), duration: 0.6, ease: 'power2.in', onComplete: () => {
            setSettings(s => ({ ...s, noiseOffset: { q: targetOffsetQ, r: targetOffsetR }, resolution: s.resolution * DIVE_ZOOM }));
            setViewMode('TACTICAL');
            setIsScanning(false);
            setCurrentStrategicHex(hex);
            gsap.fromTo(world.scale, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8, duration: 0.8, ease: 'power2.out' });
          }});
        }
      });

      containerRef.current?.addEventListener('wheel', (e) => {
        e.preventDefault(); const factor = 1.15; const delta = e.deltaY > 0 ? 1/factor : factor; const oldScale = zoom.current;
        const newScale = Math.min(Math.max(oldScale * delta, 0.05), 6); const mouseLocal = world.toLocal(new PIXI.Point(e.clientX, e.clientY));
        world.scale.set(newScale); world.x -= (mouseLocal.x * newScale - mouseLocal.x * oldScale); world.y -= (mouseLocal.y * newScale - mouseLocal.y * oldScale); zoom.current = newScale;
      }, { passive: false });

      containerRef.current?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cancelOrderDrag();
        setInputMode(null);
      });

      // Read world.scale.x (not zoom.current) — GSAP mutates scale directly during the
      // dive animation. Iterate children only on threshold crossings.
      let lastLodFar: boolean | null = null;
      let waterFilterTime = 0;
      // eslint-disable-next-line react-hooks/immutability
      app.ticker.add((ticker) => {
        updateHighlights();
        waterFilterTime += ticker.deltaMS / 1000;
        for (const handle of waterFilterHandlesRef.current) {
          handle.uniforms.uTime = waterFilterTime;
        }
        gridGfx.current.alpha = world.scale.x < 0.6 ? 0.15 : 0.30;
        const isFar = world.scale.x < LOD_THRESHOLD;
        if (isFar === lastLodFar) return;
        lastLodFar = isFar;
        // Per-unit containers (tactical) and flat sprites (strategic) coexist; descend
        // into 'unit-container' children and apply LOD directly to top-level labels.
        const applyLod = (child: PIXI.Container) => {
          if (child.label === 'unit-sprite') child.visible = !isFar;
          else if (child.label === 'unit-marker') child.visible = isFar;
          else if (child.label === 'unit-detail') child.visible = !isFar;
        };
        for (const child of unitsGfx.current.children) {
          if (child.label === 'unit-container') {
            for (const inner of (child as PIXI.Container).children) applyLod(inner as PIXI.Container);
          } else {
            applyLod(child as PIXI.Container);
          }
        }
      });
      generateWorldData();
    };
    // Capture the unit-containers map for the unmount cleanup. The ref's `.current`
    // object is created once and never reassigned — only mutated by drawUnits via
    // `.set`/`.delete` — so this reference stays valid through the lifetime of the
    // component and points to the same Map at unmount.
    const containers = unitContainersRef.current;
    start();
    return () => {
      isMounted = false;
      // Kill GSAP tweens before PIXI destroys their targets — otherwise GSAP keeps
      // updating freed objects for up to TICK_MS after unmount.
      containers.forEach(cont => {
        gsap.killTweensOf(cont);
        gsap.killTweensOf(cont.position);
      });
      containers.clear();
      for (const child of projectilesGfx.current.children) {
        gsap.killTweensOf(child);
      }
      for (const child of terrainOverlayRef.current.children) {
        if ('mask' in child) (child as PIXI.Sprite).mask = null;
      }
      app.destroy(true, { children: true });
    };
  }, []);

  const lastTickHadBothTeamsRef = useRef(false);
  const [winBanner, setWinBanner] = useState<Team | null>(null);
  const [captureProgress, setCaptureProgress] = useState<{ red: number; blue: number }>({ red: 0, blue: 0 });
  const captureProgressRef = useRef<{ red: number; blue: number }>({ red: 0, blue: 0 });
  useEffect(() => { captureProgressRef.current = captureProgress; }, [captureProgress]);
  // MUST stay monotonic across battle pauses/restarts — units carry absolute
  // `nextMoveTick` values; resetting strands them on multi-hundred-tick cooldowns.
  // Only reset on regenerate / return-to-strategic (where armies are also wiped).
  const tickCounterRef = useRef(0);

  useEffect(() => {
    if (!isBattleRunning) return;
    const id = window.setInterval(() => {
      const strategic = currentStrategicHexRef.current;
      if (!strategic) return;
      const strategicKey = HexUtils.key(strategic);
      const units = armiesRef.current.get(strategicKey) ?? [];
      if (units.length === 0) return;
      // simulateTick BEFORE the setters — reading a closure variable written inside a
      // setX(prev => ...) on the next line is undefined (the updater hasn't run yet).
      const teamsBefore = new Set(units.map(u => u.team));
      if (teamsBefore.size >= 2) lastTickHadBothTeamsRef.current = true;
      const grid = gridDataRef.current;
      const gridSet = new Set(grid.map(d => HexUtils.key(d.hex)));
      const terrainAt = new Map(grid.map(d => [HexUtils.key(d.hex), d.type]));
      // Precompute deploy zone hex sets — the retreat-clear logic queries this per tick.
      const deployZones: Record<Team, Set<string>> = {
        red:  deployZoneFor('red',  grid),
        blue: deployZoneFor('blue', grid),
      };
      tickCounterRef.current += 1;
      // AI phase. Each registered controller writes its team's orders via `issueOrder`,
      // which mutates the orders ref synchronously — so the `simulateTick` call below
      // reads the post-AI order map, no one-tick lag.
      for (const team of (['red', 'blue'] as const)) {
        const fn = getAiController(team);
        if (!fn) continue;
        const myUnits = units.filter(u => u.team === team);
        const enemyUnits = units.filter(u => u.team !== team);
        const myOrders = Array.from(groupOrdersRef.current.values()).filter(o => o.team === team);
        try {
          fn({
            team,
            tick: tickCounterRef.current,
            myUnits,
            enemyUnits,
            myOrders,
            allOrders: groupOrdersRef.current,
            gridData: grid,
            issueOrder: (gid, change) => issueOrder(team, gid, change),
            clearOrder: (gid) => clearOrder(team, gid),
          });
        } catch (err) {
          console.error(`[ai] controller for team ${team} threw:`, err);
        }
      }
      const result = simulateTick(units, groupOrdersRef.current, {
        damagePerTick: DAMAGE_PER_TICK,
        currentTick: tickCounterRef.current,
        captureZone: CAPTURE_ZONE_HEXES,
        mapApi: {
          isInside: (h: Hex) => gridSet.has(HexUtils.key(h)),
          isWalkable: (h: Hex) => {
            const t = terrainAt.get(HexUtils.key(h));
            return t ? TERRAINS[t].walkable : false;
          },
          getTerrainType: (h: Hex) => terrainAt.get(HexUtils.key(h)),
          getTerrainMods: (h: Hex) => getTerrainMods(terrainAt.get(HexUtils.key(h))),
          getTerrainHeight: (h: Hex) => {
            const t = terrainAt.get(HexUtils.key(h));
            return t ? TERRAINS[t].height : 0;
          },
          isInDeployZone: (t: Team, h: Hex) => deployZones[t].has(HexUtils.key(h)),
        },
      });
      const javelinTex = javelinTextureRef.current;
      if (javelinTex && result.projectiles.length > 0) {
        // Asset's natural tip points up-left (1813×822 diagonal). atan2(-670, -1610) is
        // the from-butt-to-tip angle; subtract to rotate the throw to face the target.
        const assetTipAngle = Math.atan2(-670, -1610);
        const container = projectilesGfx.current;
        for (const p of result.projectiles) {
          const fromPx = HexUtils.hexToPixel(p.fromHex);
          const toPx = HexUtils.hexToPixel(p.toHex);
          const dxp = toPx.x - fromPx.x;
          const dyp = toPx.y - fromPx.y;
          const sprite = new PIXI.Sprite(javelinTex);
          sprite.anchor.set(0.5, 0.5);
          const targetLengthPx = 50;
          const intrinsicLen = Math.max(javelinTex.width, 1);
          const s = targetLengthPx / intrinsicLen;
          sprite.scale.set(s, s);
          sprite.rotation = Math.atan2(dyp, dxp) - assetTipAngle;
          sprite.x = fromPx.x;
          sprite.y = fromPx.y;
          container.addChild(sprite);
          gsap.to(sprite, {
            x: toPx.x,
            y: toPx.y,
            duration: 0.25,
            ease: 'none',
            onComplete: () => {
              gsap.killTweensOf(sprite);
              if (sprite.parent) sprite.parent.removeChild(sprite);
              sprite.destroy();
            },
          });
        }
      }

      const next = result.units;

      // Capture-the-flag tick. Count living units per team in the central 7-hex flower;
      // apply uncontested-progress / contested-decay; trigger win at threshold. Annihilation
      // check below still applies as a fallback.
      {
        const zone = captureZoneKeys();
        let redInZone = 0, blueInZone = 0;
        for (const u of next) {
          if (u.hp <= 0) continue;
          if (!zone.has(HexUtils.key(u.tacticalHex))) continue;
          if (u.team === 'red') redInZone++;
          else blueInZone++;
        }
        const cur = captureProgressRef.current;
        const redUncontested  = redInZone  > 0 && blueInZone === 0;
        const blueUncontested = blueInZone > 0 && redInZone  === 0;
        const contested = redInZone > 0 && blueInZone > 0;
        let nextRed = cur.red, nextBlue = cur.blue;
        if (redUncontested) {
          nextRed  = Math.min(CAPTURE_TICKS_TO_WIN, cur.red + 1);
          nextBlue = Math.max(0, cur.blue - 1);
        } else if (blueUncontested) {
          nextBlue = Math.min(CAPTURE_TICKS_TO_WIN, cur.blue + 1);
          nextRed  = Math.max(0, cur.red - 1);
        } else if (contested) {
          nextRed  = Math.max(0, cur.red - 1);
          nextBlue = Math.max(0, cur.blue - 1);
        }
        if (nextRed !== cur.red || nextBlue !== cur.blue) {
          captureProgressRef.current = { red: nextRed, blue: nextBlue };
          setCaptureProgress({ red: nextRed, blue: nextBlue });
        }
        if (nextRed >= CAPTURE_TICKS_TO_WIN) {
          setWinBanner('red');
          setIsBattleRunning(false);
          window.setTimeout(() => setWinBanner(null), 3000);
        } else if (nextBlue >= CAPTURE_TICKS_TO_WIN) {
          setWinBanner('blue');
          setIsBattleRunning(false);
          window.setTimeout(() => setWinBanner(null), 3000);
        }
      }

      const teamsAfter = new Set(next.map(u => u.team));
      if (teamsAfter.size === 1 && lastTickHadBothTeamsRef.current) {
        const winner = next[0]?.team ?? null;
        if (winner) {
          setWinBanner(winner);
          setIsBattleRunning(false);
          lastTickHadBothTeamsRef.current = false;
          window.setTimeout(() => setWinBanner(null), 3000);
        }
      }
      setArmies(prev => {
        const updated = new Map(prev);
        updated.set(strategicKey, next);
        return updated;
      });
      if (result.orders !== groupOrdersRef.current) setGroupOrders(result.orders);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isBattleRunning, issueOrder, clearOrder]);

  // Mirror state into refs so the long-lived PIXI handlers (registered once at mount) read current values without re-registration.
  /* eslint-disable react-hooks/immutability */
  const isScanningRef = useRef(false);
  const noiseOffsetRef = useRef({ q: 0, r: 0 });
  useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);
  useEffect(() => { noiseOffsetRef.current = genSettings.noiseOffset; }, [genSettings.noiseOffset]);
  const inputModeRef = useRef<InputMode | null>(null);
  const currentStrategicHexRef = useRef<Hex | null>(null);
  const selectedTeamRef = useRef<Team>('red');
  const selectedGroupRef = useRef<GroupId>(1);
  const selectedUnitTypeRef = useRef<UnitType>('infantry');
  // groupOrdersRef is declared above (near the mount useEffect) so issueOrder/clearOrder
  // can be defined before the long-lived handlers that capture them.
  const groupFormationsRef = useRef<GroupFormations>(new Map());
  const groupDepthsRef = useRef<GroupDepths>(new Map());
  const rostersRef = useRef<Rosters>(makeInitialRosters());
  const armiesRef = useRef<Armies>(new Map());
  const orderDragRef = useRef<OrderDrag | null>(null);
  const gridDataRef = useRef<{ hex: Hex; type: string }[]>([]);
  const isBattleRunningRef = useRef(false);
  const fogOfWarRef = useRef(false);
  useEffect(() => {
    inputModeRef.current = inputMode;
    if (inputMode !== 'order') {
      orderDragRef.current = null;
      previewGfx.current?.removeChildren();
    }
  }, [inputMode]);
  useEffect(() => { currentStrategicHexRef.current = currentStrategicHex; }, [currentStrategicHex]);
  useEffect(() => { selectedTeamRef.current = selectedTeam; }, [selectedTeam]);
  useEffect(() => { selectedGroupRef.current = selectedGroup; }, [selectedGroup]);
  useEffect(() => { selectedUnitTypeRef.current = selectedUnitType; }, [selectedUnitType]);
  useEffect(() => { groupOrdersRef.current = groupOrders; }, [groupOrders]);
  useEffect(() => { groupFormationsRef.current = groupFormations; }, [groupFormations]);
  useEffect(() => { groupDepthsRef.current = groupDepths; }, [groupDepths]);
  useEffect(() => { rostersRef.current = rosters; }, [rosters]);
  useEffect(() => { armiesRef.current = armies; }, [armies]);
  useEffect(() => { gridDataRef.current = gridData; }, [gridData]);
  useEffect(() => { isBattleRunningRef.current = isBattleRunning; }, [isBattleRunning]);
  useEffect(() => { fogOfWarRef.current = fogOfWar; }, [fogOfWar]);
  /* eslint-enable react-hooks/immutability */

  // Shared toggle for CHARGE / RETREAT / UNLEASH shortcuts and HUD buttons. Toggling the
  // active mode reverts the group to 'idle' (the rest default); CHARGE additionally arms
  // / clears the duration counter so re-entering charge starts a fresh window.
  // RETREAT is a special case: it vanishes a disengaged group from the field and
  // refunds RETREAT_REFUND_FRAC of each unit type to the team's roster. If any unit in
  // the group has an enemy adjacent, the press is a no-op.
  const toggleMode = useCallback((mode: Exclude<OrderMode, 'march'>) => {
    const gid = selectedGroupRef.current;
    const team = selectedTeamRef.current;
    const cur = groupOrdersRef.current.get(groupOrderKey(team, gid));
    if (mode === 'retreat') {
      const strategic = currentStrategicHexRef.current;
      if (!strategic) return;
      const sKey = HexUtils.key(strategic);
      const all = armiesRef.current.get(sKey) ?? [];
      const groupUnits = all.filter(u => u.team === team && u.groupId === gid && u.hp > 0);
      if (groupUnits.length === 0) return;
      const enemyHexes = new Set(
        all.filter(u => u.team !== team && u.hp > 0).map(u => HexUtils.key(u.tacticalHex)),
      );
      const engaged = groupUnits.some(u =>
        HexUtils.getNeighbors(u.tacticalHex).some(n => enemyHexes.has(HexUtils.key(n))),
      );
      if (engaged) return; // melee locks the retreat — no-op
      const refund: Record<UnitType, number> = { infantry: 0, cavalry: 0, skirmisher: 0 };
      for (const u of groupUnits) {
        refund[u.unitType ?? 'infantry']++;
      }
      setArmies(prev => {
        const next = new Map(prev);
        const arr = next.get(sKey) ?? [];
        next.set(sKey, arr.filter(u => !(u.team === team && u.groupId === gid)));
        return next;
      });
      setRosters(prev => {
        const next = new Map(prev);
        const r = next.get(team) ?? { ...INITIAL_ROSTER };
        next.set(team, {
          infantry: r.infantry + Math.floor(refund.infantry * RETREAT_REFUND_FRAC),
          cavalry: r.cavalry + Math.floor(refund.cavalry * RETREAT_REFUND_FRAC),
          skirmisher: r.skirmisher + Math.floor(refund.skirmisher * RETREAT_REFUND_FRAC),
        });
        return next;
      });
      clearOrder(team, gid);
      return;
    }
    if (!cur?.attackTarget) return;
    // Once committed (post-unleash), no further mode changes — RETREAT was handled
    // above and is the only escape. The HUD button is also disabled but the keyboard
    // could still fire — short-circuit here for symmetry.
    if (cur.committed) return;
    const isActive = (cur.mode ?? 'idle') === mode;
    if (isActive) {
      // Toggle off → idle. Unleash never reaches here (one-way commit). Idle→idle is a
      // visual no-op but harmless. Clear all mode-specific scratch fields so prior
      // state doesn't bleed in if the player later re-enables a mode.
      issueOrder(team, gid, { mode: 'idle', chargeTicksRemaining: undefined, chargeDamagedIds: undefined, holdTicks: undefined });
      return;
    }
    issueOrder(team, gid, {
      mode,
      chargeTicksRemaining: mode === 'charge' ? CHARGE_DURATION_TICKS : undefined,
      chargeDamagedIds: undefined,
      // Hold starts the defensive-reduction counter; idle clears it; anything else
      // leaves it undefined (no bonus).
      holdTicks: mode === 'hold' ? 0 : undefined,
      // Unleash is the only remaining one-way commit (retreat is handled separately above).
      committed: mode === 'unleash' ? true : undefined,
    });
  }, [issueOrder, clearOrder]);

  // A / MARCH: dual-purpose action on the selected group.
  //   - If currently marching: cycle heading within the team's forward cone.
  //   - Otherwise (idle, hold, charge, or no order yet): switch to march. Preserve
  //     existing heading/attackTarget if the player previously dragged one; otherwise
  //     default to the team's straight-forward direction (red→N, blue→S) with an
  //     attackTarget ~15 hexes ahead of the group's centroid.
  const marchForward = useCallback(() => {
    const gid = selectedGroupRef.current;
    const team = selectedTeamRef.current;
    const strategic = currentStrategicHexRef.current;
    if (!strategic) return;
    const units = armiesRef.current.get(HexUtils.key(strategic)) ?? [];
    const groupUnits = units.filter(u => u.team === team && u.groupId === gid);
    if (groupUnits.length === 0) return;
    const cur = groupOrdersRef.current.get(groupOrderKey(team, gid));
    if (cur?.committed) return;
    const isMarching = cur?.mode === 'march' && !!cur.attackTarget;
    if (isMarching) {
      issueOrder(team, gid, { heading: cycleConeHeading(team, cur!.heading) });
      return;
    }
    const heading = cur?.heading ?? (team === 'red' ? 2 : 5);
    let attackTarget = cur?.attackTarget ?? null;
    if (!attackTarget) {
      const dir = HexUtils.directions[heading];
      const avgQ = groupUnits.reduce((s, u) => s + u.tacticalHex.q, 0) / groupUnits.length;
      const avgR = groupUnits.reduce((s, u) => s + u.tacticalHex.r, 0) / groupUnits.length;
      attackTarget = HexUtils.hexRound({
        q: avgQ + dir.q * 15,
        r: avgR + dir.r * 15,
      });
    }
    issueOrder(team, gid, {
      mode: 'march',
      attackTarget,
      heading,
      chargeTicksRemaining: undefined,
      chargeDamagedIds: undefined,
      holdTicks: undefined,
    });
  }, [issueOrder]);

  const toggleScan = useCallback(() => {
    setIsScanning(s => {
      const next = !s;
      if (next) setInputMode(null);
      return next;
    });
  }, []);

  const cycleFormation = useCallback((gid: GroupId) => {
    const team = selectedTeamRef.current;
    const key = groupOrderKey(team, gid);
    setGroupFormations(prev => {
      const next = new Map(prev);
      const cur = next.get(key) ?? 'line';
      const idx = FORMATION_CYCLE.indexOf(cur);
      next.set(key, FORMATION_CYCLE[(idx + 1) % FORMATION_CYCLE.length]);
      return next;
    });
  }, []);

  const resetBattle = useCallback(() => {
    setArmies(new Map());
    setInputMode(null);
    setIsBattleRunning(false);
    setGroupOrders(new Map());
    setGroupFormations(new Map());
    setGroupDepths(new Map());
    setRosters(makeInitialRosters());
    setCaptureProgress({ red: 0, blue: 0 });
    captureProgressRef.current = { red: 0, blue: 0 };
    setWinBanner(null);
    lastTickHadBothTeamsRef.current = false;
    tickCounterRef.current = 0;
  }, []);

  const returnToStrategic = useCallback(() => {
    setSettings(s => ({ ...s, noiseOffset: {q:0, r:0}, resolution: STRATEGIC_RESOLUTION }));
    setViewMode('STRATEGIC');
    setCurrentStrategicHex(null);
    setInputMode(null);
    setIsBattleRunning(false);
    setGroupOrders(new Map());
    setGroupFormations(new Map());
    setGroupDepths(new Map());
    setRosters(makeInitialRosters());
    setCaptureProgress({ red: 0, blue: 0 });
    captureProgressRef.current = { red: 0, blue: 0 };
    setWinBanner(null);
    lastTickHadBothTeamsRef.current = false;
    tickCounterRef.current = 0;
  }, []);

  const regenerateWorld = useCallback(() => {
    noiseRef.current = null;
    setArmies(new Map());
    setCurrentStrategicHex(null);
    setInputMode(null);
    setIsBattleRunning(false);
    setGroupOrders(new Map());
    setGroupFormations(new Map());
    setGroupDepths(new Map());
    setRosters(makeInitialRosters());
    setCaptureProgress({ red: 0, blue: 0 });
    captureProgressRef.current = { red: 0, blue: 0 };
    setWinBanner(null);
    lastTickHadBothTeamsRef.current = false;
    tickCounterRef.current = 0;
    generateWorldData();
  }, [generateWorldData]);

  // Order-related shortcuts for the currently selected group. Layout — top row:
  //   T Q W E R  →  Assign / Deploy / Hold / Charge / Unleash
  // Bottom row:
  //   A S D F    →  March (start / cycle heading) / Idle / Cycle formation / Retreat
  // All TACTICAL-only; ignored while typing in inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!'tqwerasdf'.includes(k)) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (viewMode !== 'TACTICAL') return;
      const gid = selectedGroupRef.current;
      const team = selectedTeamRef.current;

      if (k === 't') {
        setInputMode(prev => (prev === 'assign' ? null : 'assign'));
        setIsScanning(false);
      } else if (k === 'q') {
        const hex = currentStrategicHexRef.current;
        const units = hex ? armiesRef.current.get(HexUtils.key(hex)) ?? [] : [];
        const count = units.filter(u => u.team === team && u.groupId === gid).length;
        if (count === 0) return;
        setInputMode(prev => (prev === 'order' ? null : 'order'));
        setIsScanning(false);
      } else if (k === 'w') {
        toggleMode('hold');
      } else if (k === 'e') {
        toggleMode('charge');
      } else if (k === 'r') {
        toggleMode('unleash');
      } else if (k === 's') {
        toggleMode('idle');
      } else if (k === 'a') {
        // A is the MARCH key. From idle/hold/charge/no-order → start marching (uses
        // existing heading if set by a prior drag, else team-forward). From march →
        // cycle heading within the team's forward cone.
        marchForward();
      } else if (k === 'd') {
        cycleFormation(gid);
      } else if (k === 'f') {
        toggleMode('retreat');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, toggleMode, marchForward, cycleFormation]);

  // Global shortcuts:
  //   SPACE         → start/pause battle (preventDefault to suppress page scroll)
  //   < / ,         → cycle selected team (red ↔ blue)
  //   1 / 2 / 3     → select group
  //   Z / X / C     → place infantry / cavalry / skirmisher (C reserved — skirmisher
  //                   unit type not yet implemented, so C is a no-op for now). Pressing
  //                   the same key again exits place mode; pressing the OTHER key
  //                   switches type without leaving place mode.
  // All TACTICAL-only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (viewMode !== 'TACTICAL') return;
      if (e.key === ' ') {
        e.preventDefault();
        setIsBattleRunning(b => !b);
        return;
      }
      if (e.key === '<' || e.key === ',') {
        setSelectedTeam(prev => (prev === 'red' ? 'blue' : 'red'));
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        setSelectedGroup(Number(e.key) as GroupId);
        return;
      }
      const setPlacementType = (type: UnitType) => {
        // Hotkeys obey the same roster gate as the HUD buttons.
        const team = selectedTeamRef.current;
        if ((rostersRef.current.get(team)?.[type] ?? 0) <= 0) return;
        const samePlacing = inputModeRef.current === 'place' && selectedUnitTypeRef.current === type;
        setSelectedUnitType(type);
        setInputMode(samePlacing ? null : 'place');
        setIsScanning(false);
      };
      if (e.key === 'z' || e.key === 'Z') { setPlacementType('infantry'); return; }
      if (e.key === 'x' || e.key === 'X') { setPlacementType('cavalry'); return; }
      if (e.key === 'c' || e.key === 'C') { setPlacementType('skirmisher'); return; }
      // Backspace: kill every unit in the selected team+group on this hex, and clear
      // the group's order so no phantom lieutenant marker survives.
      if (e.key === 'Backspace') {
        e.preventDefault();
        const strategic = currentStrategicHexRef.current;
        if (!strategic) return;
        const team = selectedTeamRef.current;
        const gid = selectedGroupRef.current;
        const key = HexUtils.key(strategic);
        setArmies(prev => {
          const cur = prev.get(key) ?? [];
          const survivors = cur.filter(u => !(u.team === team && u.groupId === gid));
          if (survivors.length === cur.length) return prev;
          const next = new Map(prev);
          next.set(key, survivors);
          return next;
        });
        clearOrder(team, gid);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, clearOrder]);

  useEffect(() => { drawMap(); }, [gridData, drawMap]);
  useEffect(() => { drawUnits(); }, [drawUnits]);
  useEffect(() => { generateWorldData(); }, [generateWorldData]);

  const updateHighlights = () => {
    const h = highlightGfx.current; h.clear(); if (!hoveredHex) return;
    const hexData = gridData.find(d => d.hex.q === hoveredHex.q && d.hex.r === hoveredHex.r);
    const pos = HexUtils.hexToPixel(hoveredHex); 
    const topY = pos.y - (hexData ? TERRAINS[hexData.type].height : 0);
    if (isScanning) { h.lineStyle(4, 0x00e6ff, 0.9).beginFill(0x00e6ff, 0.1).drawCircle(pos.x, topY, HexUtils.size * 6.5).endFill(); }
    else {
      h.lineStyle(4, 0xffffff, 0.9); const s = HexUtils.size; for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i);
        if (i === 0) h.moveTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r)); else h.lineTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
      }
      h.closePath();
    }
  };

  const curT = hoveredHex ? TERRAINS[gridData.find(d => d.hex.q === hoveredHex.q && d.hex.r === hoveredHex.r)?.type || 'SEA'] : null;

  return (
    <HUD
      containerRef={containerRef}
      viewMode={viewMode}
      isScanning={isScanning}
      showGrid={showGrid}
      fogOfWar={fogOfWar}
      inputMode={inputMode}
      winBanner={winBanner}
      isBattleRunning={isBattleRunning}
      captureProgress={captureProgress}
      currentStrategicHex={currentStrategicHex}
      armies={armies}
      groupOrders={groupOrders}
      groupFormations={groupFormations}
      rosters={rosters}
      selectedTeam={selectedTeam}
      selectedGroup={selectedGroup}
      selectedUnitType={selectedUnitType}
      curT={curT}
      setIsScanning={setIsScanning}
      setShowGrid={setShowGrid}
      setFogOfWar={setFogOfWar}
      setSelectedTeam={setSelectedTeam}
      setSelectedGroup={setSelectedGroup}
      setSelectedUnitType={setSelectedUnitType}
      setInputMode={setInputMode}
      setIsBattleRunning={setIsBattleRunning}
      toggleScan={toggleScan}
      toggleMode={toggleMode}
      marchForward={marchForward}
      cycleFormation={cycleFormation}
      resetBattle={resetBattle}
      returnToStrategic={returnToStrategic}
      regenerateWorld={regenerateWorld}
    />
  );
};
