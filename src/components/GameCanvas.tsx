import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { createNoise2D } from 'simplex-noise';
import { cycleConeHeading, CHARGE_DURATION_TICKS } from '../battle/simulate';
import type { OrderMode, Team, GroupId, UnitType } from '../battle/simulate';
import type { OrderChange } from '../battle/ai';
import {
  STRATEGIC_RESOLUTION,
  type InputMode, type Armies, type GroupOrders, type GroupFormations, type GroupDepths,
  type Rosters,
  INITIAL_ROSTER, RETREAT_REFUND_FRAC,
  makeInitialRosters,
  FORMATION_CYCLE,
  groupOrderKey,
} from '../canvas/constants';
import {
  CP_COSTS, type CommandPoints, type CpIntent,
  makeInitialCommandPoints, debit,
} from '../battle/command-points';
import { TERRAINS } from '../canvas/terrain-defs';
import { type WaterFilterHandle } from '../canvas/water-filter';
import { HUD } from '../canvas/HUD';
import { generateWorldData as generateWorldDataPure, type GenSettings } from '../canvas/world-gen';
import { drawTerrain } from '../canvas/render/drawTerrain';
import { drawDetails as drawDetailsRender } from '../canvas/render/drawDetails';
import { drawUnits as drawUnitsRender } from '../canvas/render/drawUnits';
import { useTacticalKeyboard } from '../canvas/input/useTacticalKeyboard';
import { useGlobalShortcuts } from '../canvas/input/useGlobalShortcuts';
import { type OrderDrag } from '../canvas/input/orderDrag';
import { usePixiApp, type PixiAppCtx } from '../canvas/PixiApp';
import { useBattleTick, type BattleTickCtx } from '../canvas/useBattleTick';
import { GRID_RADIUS, DEFAULT_GEN_SETTINGS } from '../data/world-gen';

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
    ...DEFAULT_GEN_SETTINGS,
    noiseOffset: { q: 0, r: 0 },
    resolution: STRATEGIC_RESOLUTION,
  });

  const gridRadius = GRID_RADIUS;

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

  // @ts-expect-error TS6133 -- TODO Task 5+: gates paintPlace/orderDrag/toggleMode
  const canAfford = useCallback((team: Team, intent: CpIntent): boolean => {
    return commandPointsRef.current[team] >= CP_COSTS[intent];
  }, []);

  // @ts-expect-error TS6133 -- TODO Task 5+: gates paintPlace/orderDrag/toggleMode
  const chargeCP = useCallback((team: Team, intent: CpIntent): boolean => {
    const next = debit(commandPointsRef.current, team, intent);
    if (next === null) return false;
    commandPointsRef.current = next;
    setCommandPoints(next);
    return true;
  }, []);

  // @ts-expect-error TS6133 -- TODO Task 5+: gates paintPlace/orderDrag/toggleMode
  const triggerBrokeFlash = useCallback((team: Team) => {
    setBrokeFlash(prev => ({ ...prev, [team]: true }));
    window.setTimeout(() => {
      setBrokeFlash(prev => ({ ...prev, [team]: false }));
    }, 200);
  }, []);

  // Mirror state into refs so the long-lived PIXI handlers (registered once at mount) read current values without re-registration.
   
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
   

  const lastTickHadBothTeamsRef = useRef(false);
  const [winBanner, setWinBanner] = useState<Team | null>(null);
  const [captureProgress, setCaptureProgress] = useState<{ red: number; blue: number }>({ red: 0, blue: 0 });
  const captureProgressRef = useRef<{ red: number; blue: number }>({ red: 0, blue: 0 });
  useEffect(() => { captureProgressRef.current = captureProgress; }, [captureProgress]);
  // MUST stay monotonic across battle pauses/restarts — units carry absolute
  // `nextMoveTick` values; resetting strands them on multi-hundred-tick cooldowns.
  // Only reset on regenerate / return-to-strategic (where armies are also wiped).
  const tickCounterRef = useRef(0);
  const commandPointsRef = useRef<CommandPoints>(makeInitialCommandPoints());
  // @ts-expect-error TS6133 -- TODO Task 4: pass to HUD
  const [commandPoints, setCommandPoints] = useState<CommandPoints>(makeInitialCommandPoints());
  // @ts-expect-error TS6133 -- TODO Task 4: consumed by HUD broke-flash
  const [brokeFlash, setBrokeFlash] = useState<{ red: boolean; blue: boolean }>({ red: false, blue: false });

  const updateHighlightsRef = useRef<() => void>(() => {});

  const pixiCtx: PixiAppCtx = {
    containerRef,
    appRef,
    worldRef,
    terrainGfx,
    terrainOverlayRef,
    detailsGfx,
    deployZoneGfx,
    captureZoneGfx,
    captureFlagSpriteRef,
    captureFlagTextureRef,
    gridGfx,
    unitsGfx,
    projectilesGfx,
    previewGfx,
    highlightGfx,
    unitContainersRef,
    armyTextureRef,
    unitTextureRef,
    unitTextureBlueRef,
    unitTextureRedCavalryRef,
    unitTextureBlueCavalryRef,
    unitTextureRedSkirmisherRef,
    unitTextureBlueSkirmisherRef,
    javelinTextureRef,
    grassTextureRef,
    grassNoiseTextureRef,
    grassMacroNoiseTextureRef,
    grassPatchDryTextureRef,
    grassPatchDenseTextureRef,
    grassFlowerSpeckTextureRef,
    forestTextureRef,
    forestMacroVariationTextureRef,
    forestDensePatchTextureRef,
    forestMossPatchTextureRef,
    riverTextureRef,
    riverFlowVariationTextureRef,
    riverDepthPatchTextureRef,
    riverEdgeSoftnessTextureRef,
    riverShimmerHighlightTextureRef,
    hillTextureRef,
    hillMacroNoiseTextureRef,
    hillPatchDryTextureRef,
    hillPatchDenseTextureRef,
    mountainTextureRef,
    snowTextureRef,
    sandTextureRef,
    seaTextureRef,
    seaMacroNoiseTextureRef,
    seaShallowPatchTextureRef,
    seaDepthPatchTextureRef,
    seaMicroNoiseTextureRef,
    deepSeaTextureRef,
    detailTexturesRef,
    waterFilterHandlesRef,
    isDragging,
    lastMousePos,
    zoom,
    isPaintingRef,
    lastPaintedKeyRef,
    inputModeRef,
    isScanningRef,
    noiseOffsetRef,
    currentStrategicHexRef,
    selectedTeamRef,
    selectedGroupRef,
    selectedUnitTypeRef,
    armiesRef,
    groupOrdersRef,
    groupFormationsRef,
    groupDepthsRef,
    rostersRef,
    gridDataRef,
    orderDragRef,
    updateHighlightsRef,
    setTerrainTexturesLoaded,
    setHoveredHex,
    setSettings,
    setViewMode,
    setIsScanning,
    setCurrentStrategicHex,
    setInputMode,
    setArmies,
    setRosters,
    issueOrder,
    generateWorldData,
  };
  usePixiApp(pixiCtx);

  const battleCtx: BattleTickCtx = {
    currentStrategicHexRef,
    armiesRef,
    groupOrdersRef,
    gridDataRef,
    captureProgressRef,
    tickCounterRef,
    lastTickHadBothTeamsRef,
    projectilesGfx,
    javelinTextureRef,
    issueOrder,
    clearOrder,
    setArmies,
    setGroupOrders,
    setCaptureProgress,
    setWinBanner,
    setIsBattleRunning,
  };
  useBattleTick(battleCtx, isBattleRunning);

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
    commandPointsRef.current = makeInitialCommandPoints();
    setCommandPoints(makeInitialCommandPoints());
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
    commandPointsRef.current = makeInitialCommandPoints();
    setCommandPoints(makeInitialCommandPoints());
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
    commandPointsRef.current = makeInitialCommandPoints();
    setCommandPoints(makeInitialCommandPoints());
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
  // No deps: intentionally runs every render to keep updateHighlightsRef pointing at the
  // latest closure so the ticker (registered once at mount) reads current hoveredHex /
  // gridData / isScanning instead of the mount-time stale values. See LEARNINGS.md.
  useEffect(() => { updateHighlightsRef.current = updateHighlights; });

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
