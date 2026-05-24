import { useEffect } from 'react';
import type { MutableRefObject, RefObject, Dispatch, SetStateAction } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { HexUtils } from '../hex-engine/HexUtils';
import { ALL_DETAIL_KEYS, detailAssetPath } from './detail-rules';
import { type WaterFilterHandle } from './water-filter';
import {
  CAPTURE_CENTER, DIVE_ZOOM, LOD_THRESHOLD,
  type InputMode,
} from './constants';
import {
  type OrderDragCtx,
  beginOrderDrag, updateOrderDrag, commitOrderDrag, cancelOrderDrag,
} from './input/orderDrag';
import { type PaintModeCtx, paintAt } from './input/paintMode';
import type { OrderDrag } from './input/orderDrag';
import type { Hex } from '../hex-engine/HexUtils';
import type { Team, GroupId, UnitType } from '../battle/simulate';
import type { OrderChange } from '../battle/ai';
import type { CpIntent } from '../battle/command-points';
import type {
  Armies, GroupFormations, GroupDepths, Rosters, GroupOrders,
} from './constants';
import type { GenSettings } from './world-gen';

export interface PixiAppCtx {
  // DOM container
  containerRef: RefObject<HTMLDivElement | null>;
  // PIXI app ref (written by hook)
  appRef: MutableRefObject<PIXI.Application | null>;
  // World container + all graphics layers (all pre-allocated in GameCanvas)
  worldRef: MutableRefObject<PIXI.Container>;
  terrainGfx: MutableRefObject<PIXI.Graphics>;
  terrainOverlayRef: MutableRefObject<PIXI.Container>;
  detailsGfx: MutableRefObject<PIXI.Container>;
  deployZoneGfx: MutableRefObject<PIXI.Graphics>;
  captureZoneGfx: MutableRefObject<PIXI.Graphics>;
  captureFlagSpriteRef: MutableRefObject<PIXI.Sprite | null>;
  captureFlagTextureRef: MutableRefObject<PIXI.Texture | null>;
  gridGfx: MutableRefObject<PIXI.Graphics>;
  unitsGfx: MutableRefObject<PIXI.Container>;
  projectilesGfx: MutableRefObject<PIXI.Container>;
  previewGfx: MutableRefObject<PIXI.Container>;
  highlightGfx: MutableRefObject<PIXI.Graphics>;
  unitContainersRef: MutableRefObject<Map<string, PIXI.Container>>;
  // Texture refs (written by hook after load)
  armyTextureRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureBlueRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureRedCavalryRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureBlueCavalryRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureRedSkirmisherRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureBlueSkirmisherRef: MutableRefObject<PIXI.Texture | null>;
  javelinTextureRef: MutableRefObject<PIXI.Texture | null>;
  grassTextureRef: MutableRefObject<PIXI.Texture | null>;
  grassNoiseTextureRef: MutableRefObject<PIXI.Texture | null>;
  grassMacroNoiseTextureRef: MutableRefObject<PIXI.Texture | null>;
  grassPatchDryTextureRef: MutableRefObject<PIXI.Texture | null>;
  grassPatchDenseTextureRef: MutableRefObject<PIXI.Texture | null>;
  grassFlowerSpeckTextureRef: MutableRefObject<PIXI.Texture | null>;
  forestTextureRef: MutableRefObject<PIXI.Texture | null>;
  forestMacroVariationTextureRef: MutableRefObject<PIXI.Texture | null>;
  forestDensePatchTextureRef: MutableRefObject<PIXI.Texture | null>;
  forestMossPatchTextureRef: MutableRefObject<PIXI.Texture | null>;
  riverTextureRef: MutableRefObject<PIXI.Texture | null>;
  riverFlowVariationTextureRef: MutableRefObject<PIXI.Texture | null>;
  riverDepthPatchTextureRef: MutableRefObject<PIXI.Texture | null>;
  riverEdgeSoftnessTextureRef: MutableRefObject<PIXI.Texture | null>;
  riverShimmerHighlightTextureRef: MutableRefObject<PIXI.Texture | null>;
  hillTextureRef: MutableRefObject<PIXI.Texture | null>;
  hillMacroNoiseTextureRef: MutableRefObject<PIXI.Texture | null>;
  hillPatchDryTextureRef: MutableRefObject<PIXI.Texture | null>;
  hillPatchDenseTextureRef: MutableRefObject<PIXI.Texture | null>;
  mountainTextureRef: MutableRefObject<PIXI.Texture | null>;
  snowTextureRef: MutableRefObject<PIXI.Texture | null>;
  sandTextureRef: MutableRefObject<PIXI.Texture | null>;
  seaTextureRef: MutableRefObject<PIXI.Texture | null>;
  seaMacroNoiseTextureRef: MutableRefObject<PIXI.Texture | null>;
  seaShallowPatchTextureRef: MutableRefObject<PIXI.Texture | null>;
  seaDepthPatchTextureRef: MutableRefObject<PIXI.Texture | null>;
  seaMicroNoiseTextureRef: MutableRefObject<PIXI.Texture | null>;
  deepSeaTextureRef: MutableRefObject<PIXI.Texture | null>;
  detailTexturesRef: MutableRefObject<Map<string, PIXI.Texture>>;
  waterFilterHandlesRef: MutableRefObject<WaterFilterHandle[]>;
  // Pan/zoom state refs
  isDragging: MutableRefObject<boolean>;
  lastMousePos: MutableRefObject<{ x: number; y: number }>;
  zoom: MutableRefObject<number>;
  isPaintingRef: MutableRefObject<boolean>;
  lastPaintedKeyRef: MutableRefObject<string | null>;
  // Input refs (read by pointer handlers)
  inputModeRef: MutableRefObject<InputMode | null>;
  isScanningRef: MutableRefObject<boolean>;
  noiseOffsetRef: MutableRefObject<{ q: number; r: number }>;
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  selectedTeamRef: MutableRefObject<Team>;
  selectedGroupRef: MutableRefObject<GroupId>;
  selectedUnitTypeRef: MutableRefObject<UnitType>;
  armiesRef: MutableRefObject<Armies>;
  groupOrdersRef: MutableRefObject<GroupOrders>;
  groupFormationsRef: MutableRefObject<GroupFormations>;
  groupDepthsRef: MutableRefObject<GroupDepths>;
  rostersRef: MutableRefObject<Rosters>;
  gridDataRef: MutableRefObject<{ hex: Hex; type: string }[]>;
  orderDragRef: MutableRefObject<OrderDrag | null>;
  // Ticker callback (kept in a ref so the ticker always calls the latest version)
  updateHighlightsRef: MutableRefObject<() => void>;
  // State setters
  setTerrainTexturesLoaded: Dispatch<SetStateAction<boolean>>;
  setHoveredHex: Dispatch<SetStateAction<Hex | null>>;
  setSettings: Dispatch<SetStateAction<GenSettings>>;
  setViewMode: Dispatch<SetStateAction<'STRATEGIC' | 'TACTICAL'>>;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  setCurrentStrategicHex: Dispatch<SetStateAction<Hex | null>>;
  setInputMode: Dispatch<SetStateAction<InputMode | null>>;
  setArmies: Dispatch<SetStateAction<Armies>>;
  setRosters: Dispatch<SetStateAction<Rosters>>;
  issueOrder: (team: Team, groupId: GroupId, change: OrderChange) => void;
  chargeCP: (team: Team, intent: CpIntent) => boolean;
  triggerBrokeFlash: (team: Team) => void;
  generateWorldData: () => void;
}

export function usePixiApp(ctx: PixiAppCtx): void {
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
        const c = canvas.getContext('2d')!;
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(img, 0, 0, pixelSize, pixelSize);
        return PIXI.Texture.from(canvas);
      };

      const [armyTex, redInfantryTex, hopliteTex, redCavalryTex, cavalryHopliteTex, romanSkirmisherTex, skirmisherTex, javelinTex, grassTex, grassNoiseTex, grassMacroNoiseTex, grassPatchDryTex, grassPatchDenseTex, grassFlowerSpeckTex, forestTex, forestMacroVariationTex, forestDensePatchTex, forestMossPatchTex, riverTex, riverFlowVariationTex, riverDepthPatchTex, riverEdgeSoftnessTex, riverShimmerHighlightTex, hillTex, hillMacroNoiseTex, hillPatchDryTex, hillPatchDenseTex, mountainTex, snowTex, sandTex, seaTex, seaMacroNoiseTex, seaShallowPatchTex, seaDepthPatchTex, seaMicroNoiseTex, deepSeaTex] = await Promise.all([
        loadHighResSvgTexture('/units/army.svg', 160),
        PIXI.Assets.load<PIXI.Texture>('/units/normalized/red-infantry.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/normalized/hoplite.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/normalized/red-cavalry.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/normalized/cavalry-hoplite.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/normalized/roman_skirmisher.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/normalized/skirmisher.png'),
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
      for (const tex of [redInfantryTex, hopliteTex, redCavalryTex, cavalryHopliteTex, romanSkirmisherTex, skirmisherTex, javelinTex, grassTex, grassNoiseTex, grassMacroNoiseTex, grassPatchDryTex, grassPatchDenseTex, grassFlowerSpeckTex, forestTex, forestMacroVariationTex, forestDensePatchTex, forestMossPatchTex, riverTex, riverFlowVariationTex, riverDepthPatchTex, riverEdgeSoftnessTex, hillTex, hillMacroNoiseTex, hillPatchDryTex, hillPatchDenseTex, mountainTex, snowTex, sandTex, seaTex, seaMacroNoiseTex, seaShallowPatchTex, seaDepthPatchTex, seaMicroNoiseTex, deepSeaTex]) {
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

      /* eslint-disable react-hooks/immutability */
      ctx.armyTextureRef.current = armyTex;
      ctx.unitTextureRef.current = redInfantryTex;
      ctx.unitTextureBlueRef.current = hopliteTex;
      ctx.unitTextureRedCavalryRef.current = redCavalryTex;
      ctx.unitTextureBlueCavalryRef.current = cavalryHopliteTex;
      ctx.unitTextureRedSkirmisherRef.current = romanSkirmisherTex;
      ctx.unitTextureBlueSkirmisherRef.current = skirmisherTex;
      ctx.javelinTextureRef.current = javelinTex;

      // Capture-the-flag marker — loaded once at mount, positioned at hex (0,0).
      const winFlagTex = await PIXI.Assets.load<PIXI.Texture>('/assets/win-flag.png');
      if (!isMounted) return;
      winFlagTex.source.scaleMode = 'linear';
      winFlagTex.source.autoGenerateMipmaps = true;
      winFlagTex.source.updateMipmaps();
      ctx.captureFlagTextureRef.current = winFlagTex;
      /* eslint-enable react-hooks/immutability */
      const flagSprite = new PIXI.Sprite(winFlagTex);
      flagSprite.anchor.set(0.5, 1.0); // bottom-centre so the pole base sits on the hex top
      const flagPos = HexUtils.hexToPixel(CAPTURE_CENTER);
      const flagScale = (HexUtils.size * 1.4) / winFlagTex.width;
      flagSprite.scale.set(flagScale);
      flagSprite.x = flagPos.x;
      flagSprite.y = flagPos.y - 8;
      ctx.captureFlagSpriteRef.current = flagSprite;

      const detailTexs = await Promise.all(
        ALL_DETAIL_KEYS.map(k => PIXI.Assets.load<PIXI.Texture>(detailAssetPath(k))),
      );
      if (!isMounted) return;
      for (let i = 0; i < ALL_DETAIL_KEYS.length; i++) {
        const tex = detailTexs[i];
        tex.source.scaleMode = 'linear';
        tex.source.autoGenerateMipmaps = true;
        tex.source.updateMipmaps();
        ctx.detailTexturesRef.current.set(ALL_DETAIL_KEYS[i], tex);
      }

      ctx.grassTextureRef.current = grassTex;
      ctx.grassNoiseTextureRef.current = grassNoiseTex;
      ctx.grassMacroNoiseTextureRef.current = grassMacroNoiseTex;
      ctx.grassPatchDryTextureRef.current = grassPatchDryTex;
      ctx.grassPatchDenseTextureRef.current = grassPatchDenseTex;
      ctx.grassFlowerSpeckTextureRef.current = grassFlowerSpeckTex;
      ctx.forestTextureRef.current = forestTex;
      ctx.forestMacroVariationTextureRef.current = forestMacroVariationTex;
      ctx.forestDensePatchTextureRef.current = forestDensePatchTex;
      ctx.forestMossPatchTextureRef.current = forestMossPatchTex;
      ctx.riverTextureRef.current = riverTex;
      ctx.riverFlowVariationTextureRef.current = riverFlowVariationTex;
      ctx.riverDepthPatchTextureRef.current = riverDepthPatchTex;
      ctx.riverEdgeSoftnessTextureRef.current = riverEdgeSoftnessTex;
      ctx.riverShimmerHighlightTextureRef.current = riverShimmerHighlightTex;
      ctx.hillTextureRef.current = hillTex;
      ctx.hillMacroNoiseTextureRef.current = hillMacroNoiseTex;
      ctx.hillPatchDryTextureRef.current = hillPatchDryTex;
      ctx.hillPatchDenseTextureRef.current = hillPatchDenseTex;
      ctx.mountainTextureRef.current = mountainTex;
      ctx.snowTextureRef.current = snowTex;
      ctx.sandTextureRef.current = sandTex;
      ctx.seaTextureRef.current = seaTex;
      ctx.seaMacroNoiseTextureRef.current = seaMacroNoiseTex;
      ctx.seaShallowPatchTextureRef.current = seaShallowPatchTex;
      ctx.seaDepthPatchTextureRef.current = seaDepthPatchTex;
      ctx.seaMicroNoiseTextureRef.current = seaMicroNoiseTex;
      ctx.deepSeaTextureRef.current = deepSeaTex;

      ctx.setTerrainTexturesLoaded(true);

      if (!ctx.containerRef.current) return;
      ctx.containerRef.current.appendChild(app.canvas);
      ctx.appRef.current = app;

      const world = ctx.worldRef.current;
      world.x = app.screen.width / 2;
      world.y = app.screen.height / 2;
      world.scale.set(ctx.zoom.current);
      app.stage.addChild(world);

      // World z-order: terrain → painted overlay → scatter details → grid → units →
      // projectiles → drag previews → hover highlights.
      world.addChild(ctx.terrainGfx.current);
      world.addChild(ctx.terrainOverlayRef.current);
      world.addChild(ctx.detailsGfx.current);
      world.addChild(ctx.deployZoneGfx.current);
      world.addChild(ctx.captureZoneGfx.current);
      if (ctx.captureFlagSpriteRef.current) world.addChild(ctx.captureFlagSpriteRef.current);
      world.addChild(ctx.gridGfx.current);
      world.addChild(ctx.unitsGfx.current);
      world.addChild(ctx.projectilesGfx.current);
      world.addChild(ctx.previewGfx.current);
      world.addChild(ctx.highlightGfx.current);

      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      const paintCtx: PaintModeCtx = {
        currentStrategicHexRef: ctx.currentStrategicHexRef,
        lastPaintedKeyRef: ctx.lastPaintedKeyRef,
        selectedTeamRef: ctx.selectedTeamRef,
        selectedGroupRef: ctx.selectedGroupRef,
        selectedUnitTypeRef: ctx.selectedUnitTypeRef,
        armiesRef: ctx.armiesRef,
        rostersRef: ctx.rostersRef,
        gridDataRef: ctx.gridDataRef,
        inputModeRef: ctx.inputModeRef,
        setArmies: ctx.setArmies,
        setRosters: ctx.setRosters,
        chargeCP: ctx.chargeCP,
        triggerBrokeFlash: ctx.triggerBrokeFlash,
      };

      const odCtx: OrderDragCtx = {
        previewGfx: ctx.previewGfx,
        zoom: ctx.zoom,
        orderDragRef: ctx.orderDragRef,
        selectedTeamRef: ctx.selectedTeamRef,
        selectedGroupRef: ctx.selectedGroupRef,
        currentStrategicHexRef: ctx.currentStrategicHexRef,
        armiesRef: ctx.armiesRef,
        groupOrdersRef: ctx.groupOrdersRef,
        groupFormationsRef: ctx.groupFormationsRef,
        groupDepthsRef: ctx.groupDepthsRef,
        gridDataRef: ctx.gridDataRef,
        setArmies: ctx.setArmies,
        setInputMode: ctx.setInputMode,
        issueOrder: ctx.issueOrder,
      };

      app.stage.on('pointerdown', (e) => {
        const mode = ctx.inputModeRef.current;
        if ((mode === 'place' || mode === 'assign') && ctx.currentStrategicHexRef.current) {
          ctx.isPaintingRef.current = true;
          ctx.lastPaintedKeyRef.current = null;
          const local = world.toLocal(e.global);
          paintAt(HexUtils.pixelToHex({ x: local.x, y: local.y }), paintCtx);
          return;
        }
        if (mode === 'order' && ctx.currentStrategicHexRef.current) {
          beginOrderDrag(e, world, odCtx);
          return;
        }
        ctx.isDragging.current = true;
        ctx.lastMousePos.current = { x: e.global.x, y: e.global.y };
      });

      app.stage.on('globalpointermove', (e) => {
        if (ctx.isDragging.current) {
          world.x += e.global.x - ctx.lastMousePos.current.x;
          world.y += e.global.y - ctx.lastMousePos.current.y;
          ctx.lastMousePos.current = { x: e.global.x, y: e.global.y };
        }
        const local = world.toLocal(e.global);
        const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        ctx.setHoveredHex(hex);
        if (ctx.isPaintingRef.current) paintAt(hex, paintCtx);
        if (ctx.orderDragRef.current) updateOrderDrag(local.x, local.y, odCtx);
      });

      app.stage.on('pointerup', () => {
        if (ctx.orderDragRef.current) commitOrderDrag(odCtx);
        ctx.isDragging.current = false;
        ctx.isPaintingRef.current = false;
        ctx.lastPaintedKeyRef.current = null;
      });

      app.stage.on('pointertap', (e) => {
        if (ctx.isDragging.current) return;
        // Order commits in pointerup (captures drag direction); pointertap is a no-op.
        if (ctx.inputModeRef.current === 'order') return;
        const local = world.toLocal(e.global);
        const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        if (ctx.isScanningRef.current) {
          // CAPTURE GLOBAL NOISE COORDS
          // Tactical center hex (0,0) must sample the same noise point as the clicked strategic hex.
          // Since (newOffset / newRes) = (clickedHex + currentOffset) / currentRes and newRes = currentRes * DIVE_ZOOM,
          // the offset must be scaled by DIVE_ZOOM.
          const targetOffsetQ = (hex.q + ctx.noiseOffsetRef.current.q) * DIVE_ZOOM;
          const targetOffsetR = (hex.r + ctx.noiseOffsetRef.current.r) * DIVE_ZOOM;

          gsap.to(world.scale, { x: 3, y: 3, duration: 0.6, ease: 'power2.in' });
          gsap.to(world, {
            x: app.screen.width / 2 - (hex.q * 20),
            y: app.screen.height / 2 - (hex.r * 20),
            duration: 0.6,
            ease: 'power2.in',
            onComplete: () => {
              ctx.setSettings(s => ({
                ...s,
                noiseOffset: { q: targetOffsetQ, r: targetOffsetR },
                resolution: s.resolution * DIVE_ZOOM,
              }));
              ctx.setViewMode('TACTICAL');
              ctx.setIsScanning(false);
              ctx.setCurrentStrategicHex(hex);
              gsap.fromTo(world.scale, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8, duration: 0.8, ease: 'power2.out' });
            },
          });
        }
      });

      ctx.containerRef.current?.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = 1.15;
        const delta = e.deltaY > 0 ? 1 / factor : factor;
        const oldScale = ctx.zoom.current;
        const newScale = Math.min(Math.max(oldScale * delta, 0.05), 6);
        const mouseLocal = world.toLocal(new PIXI.Point(e.clientX, e.clientY));
        world.scale.set(newScale);
        world.x -= (mouseLocal.x * newScale - mouseLocal.x * oldScale);
        world.y -= (mouseLocal.y * newScale - mouseLocal.y * oldScale);
        ctx.zoom.current = newScale;
      }, { passive: false });

      ctx.containerRef.current?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cancelOrderDrag(odCtx);
        ctx.setInputMode(null);
      });

      // Read world.scale.x (not zoom.current) — GSAP mutates scale directly during the
      // dive animation. Iterate children only on threshold crossings.
      let lastLodFar: boolean | null = null;
      let waterFilterTime = 0;
      app.ticker.add((ticker) => {
        // Call via ref so the ticker always invokes the latest closure (which has current
        // hoveredHex / gridData / isScanning from the most recent render).
        ctx.updateHighlightsRef.current();
        waterFilterTime += ticker.deltaMS / 1000;
        for (const handle of ctx.waterFilterHandlesRef.current) {
          handle.uniforms.uTime = waterFilterTime;
        }
        ctx.gridGfx.current.alpha = world.scale.x < 0.6 ? 0.15 : 0.30;
        const isFar = world.scale.x < LOD_THRESHOLD;
        if (isFar === lastLodFar) return;
        lastLodFar = isFar;
        // Per-unit containers (tactical) and flat sprites (strategic) coexist; descend
        // into 'unit-container' children and apply LOD directly to top-level labels.
        const applyLod = (child: PIXI.Container) => {
          if (child.label === 'unit-sprite' || child.label === 'unit-sprite-shadow') child.visible = !isFar;
          else if (child.label === 'unit-marker') child.visible = isFar;
          else if (child.label === 'unit-detail') child.visible = !isFar;
        };
        for (const child of ctx.unitsGfx.current.children) {
          if (child.label === 'unit-container') {
            for (const inner of (child as PIXI.Container).children) applyLod(inner as PIXI.Container);
          } else {
            applyLod(child as PIXI.Container);
          }
        }
      });

      ctx.generateWorldData();
    };

    // Capture the unit-containers map for the unmount cleanup. The ref's `.current`
    // object is created once and never reassigned — only mutated by drawUnits via
    // `.set`/`.delete` — so this reference stays valid through the lifetime of the
    // component and points to the same Map at unmount.
    const containers = ctx.unitContainersRef.current;
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
      for (const child of ctx.projectilesGfx.current.children) {
        gsap.killTweensOf(child);
      }
      for (const child of ctx.terrainOverlayRef.current.children) {
        if ('mask' in child) (child as PIXI.Sprite).mask = null;
      }
      app.destroy(true, { children: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
