import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import gsap from 'gsap';
import { createNoise2D } from 'simplex-noise';
import { simulateTick, cycleConeHeading, CHARGE_DURATION_TICKS } from '../battle/simulate';
import type { OrderMode, Team, GroupId, UnitType } from '../battle/simulate';
import { getTerrainMods } from '../battle/terrain';
import { getAiController, type OrderChange } from '../battle/ai';
import {
  STRATEGIC_RESOLUTION, DIVE_ZOOM,
  type InputMode, type Armies, type GroupOrders, type GroupFormations, type GroupDepths,
  type Rosters,
  INITIAL_ROSTER, RETREAT_REFUND_FRAC,
  CAPTURE_TICKS_TO_WIN, CAPTURE_CENTER, captureZoneKeys, CAPTURE_ZONE_HEXES, makeInitialRosters,
  FORMATION_CYCLE,
  DAMAGE_PER_TICK, TICK_MS, LOD_THRESHOLD,
  groupOrderKey, deployZoneFor,
} from '../canvas/constants';
import { TERRAINS } from '../canvas/terrain-defs';
import { ALL_DETAIL_KEYS, detailAssetPath } from '../canvas/detail-rules';
import { type WaterFilterHandle } from '../canvas/water-filter';
import { HUD } from '../canvas/HUD';
import { generateWorldData as generateWorldDataPure, type GenSettings } from '../canvas/world-gen';
import { drawTerrain } from '../canvas/render/drawTerrain';
import { drawDetails as drawDetailsRender } from '../canvas/render/drawDetails';
import { drawUnits as drawUnitsRender } from '../canvas/render/drawUnits';
import { useTacticalKeyboard } from '../canvas/input/useTacticalKeyboard';
import { useGlobalShortcuts } from '../canvas/input/useGlobalShortcuts';
import {
  type OrderDrag,
  type OrderDragCtx,
  beginOrderDrag, updateOrderDrag, commitOrderDrag, cancelOrderDrag,
} from '../canvas/input/orderDrag';
import { type PaintModeCtx, paintAt } from '../canvas/input/paintMode';

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
    if (!terrainTexturesLoaded) return;
    drawTerrain({
      terrainGfx: terrainGfx.current,
      terrainOverlay: terrainOverlayRef.current,
      gridGfx: gridGfx.current,
      deployZoneGfx: deployZoneGfx.current,
      captureZoneGfx: captureZoneGfx.current,
      captureFlagSprite: captureFlagSpriteRef.current,
      grassTex: grassTextureRef.current,
      grassMacroNoiseTex: grassMacroNoiseTextureRef.current,
      grassPatchDryTex: grassPatchDryTextureRef.current,
      grassPatchDenseTex: grassPatchDenseTextureRef.current,
      grassFlowerSpeckTex: grassFlowerSpeckTextureRef.current,
      forestTex: forestTextureRef.current,
      forestMacroVariationTex: forestMacroVariationTextureRef.current,
      forestDensePatchTex: forestDensePatchTextureRef.current,
      forestMossPatchTex: forestMossPatchTextureRef.current,
      riverTex: riverTextureRef.current,
      riverFlowVariationTex: riverFlowVariationTextureRef.current,
      riverDepthPatchTex: riverDepthPatchTextureRef.current,
      riverEdgeSoftnessTex: riverEdgeSoftnessTextureRef.current,
      riverShimmerHighlightTex: riverShimmerHighlightTextureRef.current,
      hillTex: hillTextureRef.current,
      hillMacroNoiseTex: hillMacroNoiseTextureRef.current,
      hillPatchDryTex: hillPatchDryTextureRef.current,
      hillPatchDenseTex: hillPatchDenseTextureRef.current,
      mountainTex: mountainTextureRef.current,
      snowTex: snowTextureRef.current,
      sandTex: sandTextureRef.current,
      seaTex: seaTextureRef.current,
      seaMacroNoiseTex: seaMacroNoiseTextureRef.current,
      seaShallowPatchTex: seaShallowPatchTextureRef.current,
      seaDepthPatchTex: seaDepthPatchTextureRef.current,
      seaMicroNoiseTex: seaMicroNoiseTextureRef.current,
      deepSeaTex: deepSeaTextureRef.current,
      waterFilters: waterFilterHandlesRef.current,
      gridData,
      showGrid,
      viewMode,
    });
  }, [gridData, showGrid, terrainTexturesLoaded, viewMode]);

  const drawDetails = useCallback(() => {
    if (!detailDensityNoiseRef.current) detailDensityNoiseRef.current = createNoise2D();
    drawDetailsRender({
      detailsGfx: detailsGfx.current,
      detailTextures: detailTexturesRef.current,
      gridData,
      detailDensityNoise: detailDensityNoiseRef.current,
    });
  }, [gridData]);

  useEffect(() => { drawDetails(); }, [gridData, terrainTexturesLoaded, drawDetails]);

  const drawUnits = useCallback(() => {
    const armyTex = armyTextureRef.current;
    const unitTex = unitTextureRef.current;
    const unitTexBlue = unitTextureBlueRef.current;
    const unitTexRedCav = unitTextureRedCavalryRef.current;
    const unitTexBlueCav = unitTextureBlueCavalryRef.current;
    const unitTexRedSkir = unitTextureRedSkirmisherRef.current;
    const unitTexBlueSkir = unitTextureBlueSkirmisherRef.current;
    if (!armyTex || !unitTex || !unitTexBlue || !unitTexRedCav || !unitTexBlueCav || !unitTexRedSkir || !unitTexBlueSkir) return;
    drawUnitsRender({
      unitsGfx: unitsGfx.current,
      unitContainers: unitContainersRef.current,
      unitTextureRed: unitTex,
      unitTextureBlue: unitTexBlue,
      unitTextureRedCavalry: unitTexRedCav,
      unitTextureBlueCavalry: unitTexBlueCav,
      unitTextureRedSkirmisher: unitTexRedSkir,
      unitTextureBlueSkirmisher: unitTexBlueSkir,
      armyTexture: armyTex,
      armies,
      groupOrders,
      gridData,
      currentStrategicHex,
      viewMode,
      selectedTeam,
      fogOfWar,
      worldScale: worldRef.current.scale.x,
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

      const paintCtx: PaintModeCtx = {
        currentStrategicHexRef, lastPaintedKeyRef, selectedTeamRef, selectedGroupRef,
        selectedUnitTypeRef, armiesRef, rostersRef, gridDataRef, inputModeRef,
        setArmies, setRosters,
      };

      const odCtx: OrderDragCtx = {
        previewGfx, zoom, orderDragRef, selectedTeamRef, selectedGroupRef,
        currentStrategicHexRef, armiesRef, groupOrdersRef, groupFormationsRef,
        groupDepthsRef, gridDataRef, setArmies, setInputMode, issueOrder,
      };

      app.stage.on('pointerdown', (e) => {
        const mode = inputModeRef.current;
        if ((mode === 'place' || mode === 'assign') && currentStrategicHexRef.current) {
          isPaintingRef.current = true;
          lastPaintedKeyRef.current = null;
          const local = world.toLocal(e.global);
          paintAt(HexUtils.pixelToHex({ x: local.x, y: local.y }), paintCtx);
          return;
        }
        if (mode === 'order' && currentStrategicHexRef.current) {
          beginOrderDrag(e, world, odCtx);
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
        if (isPaintingRef.current) paintAt(hex, paintCtx);
        if (orderDragRef.current) updateOrderDrag(local.x, local.y, odCtx);
      });
      app.stage.on('pointerup', () => {
        if (orderDragRef.current) commitOrderDrag(odCtx);
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
        cancelOrderDrag(odCtx);
        setInputMode(null);
      });

      // Read world.scale.x (not zoom.current) — GSAP mutates scale directly during the
      // dive animation. Iterate children only on threshold crossings.
      let lastLodFar: boolean | null = null;
      let waterFilterTime = 0;
      app.ticker.add((ticker) => {
        updateHighlights(); // eslint-disable-line react-hooks/immutability
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

  useTacticalKeyboard({
    viewMode, selectedGroupRef, selectedTeamRef, currentStrategicHexRef, armiesRef,
    setInputMode, setIsScanning, toggleMode, marchForward, cycleFormation,
  });

  useGlobalShortcuts({
    viewMode, selectedTeamRef, selectedGroupRef, selectedUnitTypeRef,
    currentStrategicHexRef, inputModeRef, rostersRef,
    setIsBattleRunning, setSelectedTeam, setSelectedGroup, setSelectedUnitType,
    setInputMode, setIsScanning, setArmies, clearOrder,
  });

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
