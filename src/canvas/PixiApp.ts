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
import { advanceUnitFollowers, killUnitTweens } from './render/drawUnits';
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
  movementDustGfx: MutableRefObject<PIXI.Container>;
  unitsGfx: MutableRefObject<PIXI.Container>;
  combatFxGfx: MutableRefObject<PIXI.Container>;
  projectilesGfx: MutableRefObject<PIXI.Container>;
  previewGfx: MutableRefObject<PIXI.Container>;
  highlightGfx: MutableRefObject<PIXI.Graphics>;
  unitContainersRef: MutableRefObject<Map<string, PIXI.Container>>;
  // Texture refs (written by hook after load)
  armyTextureRef: MutableRefObject<PIXI.Texture | null>;
  // Soft unit shadow baked once at boot (a blurred ellipse). Reused by every unit so
  // shadows are plain Sprites, not per-frame BlurFilter passes.
  shadowTextureRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureBlueRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureRedCavalryRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureBlueCavalryRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureRedSkirmisherRef: MutableRefObject<PIXI.Texture | null>;
  unitTextureBlueSkirmisherRef: MutableRefObject<PIXI.Texture | null>;
  boatTextureRef: MutableRefObject<PIXI.Texture | null>;
  javelinTextureRef: MutableRefObject<PIXI.Texture | null>;
  dustTextureRef: MutableRefObject<PIXI.Texture | null>;
  grassTextureRef: MutableRefObject<PIXI.Texture | null>;
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
  setSelectedGroup: Dispatch<SetStateAction<GroupId>>;
  setArmies: Dispatch<SetStateAction<Armies>>;
  setRosters: Dispatch<SetStateAction<Rosters>>;
  issueOrder: (team: Team, groupId: GroupId, change: OrderChange) => void;
  chargeCP: (team: Team, intent: CpIntent) => boolean;
  triggerBrokeFlash: (team: Team) => void;
}

export function usePixiApp(ctx: PixiAppCtx): void {
  useEffect(() => {
    let isMounted = true;
    // DOM listeners on the container <div> (owned by React, not destroyed by app.destroy).
    // Registered with this signal so cleanup removes them — otherwise a remount stacks a
    // second wheel/contextmenu handler whose closures point at the destroyed app.
    const domListeners = new AbortController();
    const app = new PIXI.Application();
    const start = async () => {
      await app.init({
        resizeTo: window,
        backgroundColor: 0x050a14,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

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

      // Texture manifest: path, target ref, and per-texture flags in ONE place, so adding a
      // texture is a single row — no positional Promise.all / mipmap-loop / addressMode /
      // assignment lists to keep in sync. `repeat` wraps the source so TilingSprite overlays
      // tile continuously across each biome; everything but the army SVG gets LINEAR +
      // auto-mipmaps so heavy minification at strategic zoom doesn't alias.
      type TexSpec = {
        path: string;
        ref: MutableRefObject<PIXI.Texture | null>;
        repeat?: boolean;
        svgSize?: number;
        noMipmap?: boolean;
      };
      /* eslint-disable react-hooks/immutability */
      const manifest: TexSpec[] = [
        { path: '/units/army.svg', ref: ctx.armyTextureRef, svgSize: 160, noMipmap: true },
        { path: '/units/normalized/red-infantry.png', ref: ctx.unitTextureRef },
        { path: '/units/normalized/hoplite.png', ref: ctx.unitTextureBlueRef },
        { path: '/units/normalized/red-cavalry.png', ref: ctx.unitTextureRedCavalryRef },
        { path: '/units/normalized/blue-cavalry.png', ref: ctx.unitTextureBlueCavalryRef },
        { path: '/units/normalized/roman_skirmisher.png', ref: ctx.unitTextureRedSkirmisherRef },
        { path: '/units/normalized/blue-skirmisher.png', ref: ctx.unitTextureBlueSkirmisherRef },
        { path: '/units/boat.png', ref: ctx.boatTextureRef },
        { path: '/units/javelin.png', ref: ctx.javelinTextureRef },
        { path: '/fx/dust-puff.png', ref: ctx.dustTextureRef },
        { path: '/terrain/grass.png', ref: ctx.grassTextureRef, repeat: true },
        { path: '/terrain/grass-macro-noise.png', ref: ctx.grassMacroNoiseTextureRef, repeat: true },
        { path: '/terrain/grass-patch-dry.png', ref: ctx.grassPatchDryTextureRef, repeat: true },
        { path: '/terrain/grass-patch-dense.png', ref: ctx.grassPatchDenseTextureRef, repeat: true },
        { path: '/terrain/grass-flower-speck.png', ref: ctx.grassFlowerSpeckTextureRef, repeat: true },
        { path: '/terrain/forest.png', ref: ctx.forestTextureRef, repeat: true },
        { path: '/terrain/forest-macro-variation.png', ref: ctx.forestMacroVariationTextureRef, repeat: true },
        { path: '/terrain/forest-dense-patch.png', ref: ctx.forestDensePatchTextureRef, repeat: true },
        { path: '/terrain/forest-moss-patch.png', ref: ctx.forestMossPatchTextureRef, repeat: true },
        { path: '/terrain/river.png', ref: ctx.riverTextureRef, repeat: true },
        { path: '/terrain/river-flow-variation.png', ref: ctx.riverFlowVariationTextureRef, repeat: true },
        { path: '/terrain/river-depth-patch.png', ref: ctx.riverDepthPatchTextureRef, repeat: true },
        { path: '/terrain/river-edge-softness.png', ref: ctx.riverEdgeSoftnessTextureRef, repeat: true },
        { path: '/terrain/river-shimmer-highlight.png', ref: ctx.riverShimmerHighlightTextureRef, repeat: true },
        { path: '/terrain/hill.png', ref: ctx.hillTextureRef, repeat: true },
        { path: '/terrain/hill-macro-noise.png', ref: ctx.hillMacroNoiseTextureRef, repeat: true },
        { path: '/terrain/hill-patch-dry.png', ref: ctx.hillPatchDryTextureRef, repeat: true },
        { path: '/terrain/hill-patch-dense.png', ref: ctx.hillPatchDenseTextureRef, repeat: true },
        { path: '/terrain/mountain.png', ref: ctx.mountainTextureRef, repeat: true },
        { path: '/terrain/snow.png', ref: ctx.snowTextureRef, repeat: true },
        { path: '/terrain/sand.png', ref: ctx.sandTextureRef, repeat: true },
        { path: '/terrain/sea.png', ref: ctx.seaTextureRef, repeat: true },
        { path: '/terrain/sea-macro-noise.png', ref: ctx.seaMacroNoiseTextureRef, repeat: true },
        { path: '/terrain/sea-shallow-patch.png', ref: ctx.seaShallowPatchTextureRef, repeat: true },
        { path: '/terrain/sea-depth-patch.png', ref: ctx.seaDepthPatchTextureRef, repeat: true },
        { path: '/terrain/sea-micro-noise.png', ref: ctx.seaMicroNoiseTextureRef, repeat: true },
        { path: '/terrain/deep-sea.png', ref: ctx.deepSeaTextureRef, repeat: true },
      ];
      const loadedTex = await Promise.all(manifest.map(t =>
        t.svgSize != null
          ? loadHighResSvgTexture(t.path, t.svgSize)
          : PIXI.Assets.load<PIXI.Texture>(t.path),
      ));
      if (!isMounted) return;

      manifest.forEach((t, i) => {
        const tex = loadedTex[i];
        if (!t.noMipmap) {
          tex.source.scaleMode = 'linear';
          tex.source.autoGenerateMipmaps = true;
          tex.source.updateMipmaps();
        }
        if (t.repeat) tex.source.addressMode = 'repeat';
        t.ref.current = tex;
      });
      // Bake a soft elliptical shadow to a texture once — every unit reuses it as a plain
      // Sprite, so shadows cost zero per-frame filter passes. The 128² frame leaves room
      // for the blur to fall off inside the texture bounds.
      const shadowG = new PIXI.Graphics().ellipse(64, 64, 46, 24).fill({ color: 0x000000 });
      shadowG.filters = [new PIXI.BlurFilter({ strength: 6 })];
      ctx.shadowTextureRef.current = app.renderer.generateTexture({
        target: shadowG,
        resolution: 2,
        frame: new PIXI.Rectangle(0, 0, 128, 128),
      });
      shadowG.destroy(true);

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

      ctx.setTerrainTexturesLoaded(true);

      if (!ctx.containerRef.current) return;
      ctx.containerRef.current.appendChild(app.canvas);
      ctx.appRef.current = app;

      const world = ctx.worldRef.current;
      world.x = app.screen.width / 2;
      world.y = app.screen.height / 2;
      world.scale.set(ctx.zoom.current);
      app.stage.addChild(world);
      // NOTE: do NOT enableRenderGroup() on `world`. A render group only flushes its
      // descendants' transforms to the GPU on a structural rebuild (≈per tick here, from
      // ring/unit churn), so GSAP-animated unit and dust positions jump once per tick
      // instead of gliding per frame — units visibly teleport. See LEARNINGS.md.

      // World z-order: terrain → painted overlay → scatter details → grid → units →
      // projectiles → drag previews → hover highlights.
      world.addChild(ctx.terrainGfx.current);
      world.addChild(ctx.terrainOverlayRef.current);
      world.addChild(ctx.detailsGfx.current);
      world.addChild(ctx.deployZoneGfx.current);
      world.addChild(ctx.captureZoneGfx.current);
      if (ctx.captureFlagSpriteRef.current) world.addChild(ctx.captureFlagSpriteRef.current);
      world.addChild(ctx.gridGfx.current);
      ctx.movementDustGfx.current.sortableChildren = true;
      world.addChild(ctx.movementDustGfx.current);
      // Units overlap neighbours (112px sprite over a 40px hex), so render them
      // back-to-front: zIndex = screen-Y is assigned per container in drawUnits.
      ctx.unitsGfx.current.sortableChildren = true;
      world.addChild(ctx.unitsGfx.current);
      ctx.combatFxGfx.current.sortableChildren = true;
      world.addChild(ctx.combatFxGfx.current);
      world.addChild(ctx.projectilesGfx.current);
      world.addChild(ctx.previewGfx.current);
      world.addChild(ctx.highlightGfx.current);

      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      // Last hex the pointer hovered (axial key). Used to skip redundant setHoveredHex
      // calls — without this, every sub-hex mouse move re-renders GameCanvas + HUD.
      let lastHoverKey: string | null = null;

      const paintCtx: PaintModeCtx = {
        currentStrategicHexRef: ctx.currentStrategicHexRef,
        lastPaintedKeyRef: ctx.lastPaintedKeyRef,
        selectedTeamRef: ctx.selectedTeamRef,
        selectedGroupRef: ctx.selectedGroupRef,
        selectedUnitTypeRef: ctx.selectedUnitTypeRef,
        armiesRef: ctx.armiesRef,
        groupOrdersRef: ctx.groupOrdersRef,
        rostersRef: ctx.rostersRef,
        gridDataRef: ctx.gridDataRef,
        inputModeRef: ctx.inputModeRef,
        setArmies: ctx.setArmies,
        setRosters: ctx.setRosters,
        setSelectedGroup: ctx.setSelectedGroup,
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
        chargeCP: ctx.chargeCP,
        triggerBrokeFlash: ctx.triggerBrokeFlash,
      };

      app.stage.on('pointerdown', (e) => {
        const mode = ctx.inputModeRef.current;
        if (mode === 'place' && ctx.currentStrategicHexRef.current) {
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
        const hoverKey = HexUtils.key(hex);
        if (hoverKey !== lastHoverKey) {
          lastHoverKey = hoverKey;
          ctx.setHoveredHex(hex);
        }
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
        } else if (ctx.inputModeRef.current === null && ctx.currentStrategicHexRef.current) {
          // Tactical click on one of the selected team's units → select that unit's group.
          // (Skipped during order/place modes, which own the click.)
          const sk = HexUtils.key(ctx.currentStrategicHexRef.current);
          const team = ctx.selectedTeamRef.current;
          const clickedKey = HexUtils.key(hex);
          const hit = (ctx.armiesRef.current.get(sk) ?? []).find(
            u => u.team === team && u.hp > 0 && HexUtils.key(u.tacticalHex) === clickedKey,
          );
          if (hit) ctx.setSelectedGroup(hit.groupId);
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
      }, { passive: false, signal: domListeners.signal });

      ctx.containerRef.current?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cancelOrderDrag(odCtx);
        ctx.setInputMode(null);
      }, { signal: domListeners.signal });

      // Read world.scale.x (not zoom.current) — GSAP mutates scale directly during the
      // dive animation. Iterate children only on threshold crossings.
      let lastLodFar: boolean | null = null;
      let waterFilterTime = 0;
      app.ticker.add((ticker) => {
        // Call via ref so the ticker always invokes the latest closure (which has current
        // hoveredHex / gridData / isScanning from the most recent render).
        ctx.updateHighlightsRef.current();
        advanceUnitFollowers(ctx.unitContainersRef.current, ticker.deltaMS);
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
        };
        for (const child of ctx.unitsGfx.current.children) {
          if (child.label === 'unit-container') {
            for (const inner of (child as PIXI.Container).children) applyLod(inner as PIXI.Container);
          } else {
            applyLod(child as PIXI.Container);
          }
        }
      });
    };

    // Capture the unit-containers map for the unmount cleanup. The ref's `.current`
    // object is created once and never reassigned — only mutated by drawUnits via
    // `.set`/`.delete` — so this reference stays valid through the lifetime of the
    // component and points to the same Map at unmount.
    const containers = ctx.unitContainersRef.current;
    start();
    return () => {
      isMounted = false;
      domListeners.abort();
      // Kill GSAP tweens before PIXI destroys their targets — otherwise GSAP keeps
      // updating freed objects for up to TICK_MS after unmount.
      containers.forEach(killUnitTweens);
      containers.clear();
      for (const child of ctx.projectilesGfx.current.children) {
        gsap.killTweensOf(child);
      }
      for (const child of ctx.movementDustGfx.current.children) {
        gsap.killTweensOf(child);
      }
      for (const child of ctx.combatFxGfx.current.children) {
        gsap.killTweensOf(child);
      }
      for (const child of ctx.terrainOverlayRef.current.children) {
        if ('mask' in child) (child as PIXI.Sprite).mask = null;
      }
      ctx.shadowTextureRef.current?.destroy(true);
      ctx.shadowTextureRef.current = null;
      app.destroy(true, { children: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
