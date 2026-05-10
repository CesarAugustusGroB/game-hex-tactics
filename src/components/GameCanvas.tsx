import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import gsap from 'gsap';
import { createNoise2D } from 'simplex-noise';
import { simulateTick } from '../battle/simulate';
import type { Unit, GroupOrder, Team, GroupId } from '../battle/simulate';

// --- Constants ---
const STRATEGIC_RESOLUTION = 40;
const DIVE_ZOOM = 4.5;

// --- Professional Tactical Palette ---
interface TerrainDef {
  color: number;
  label: string;
  height: number;
}

type InputMode = 'place' | 'assign' | 'order';

type Armies = Map<string, Unit[]>;
type GroupOrders = Map<string, GroupOrder>;

const TEAM_TINTS: Record<Team, number> = {
  red: 0xef4444,
  blue: 0x3b82f6,
};

const MAX_HP = 100;
const DAMAGE_PER_TICK = 10;
const TICK_MS = 500;

const groupOrderKey = (team: Team, groupId: GroupId): string => `${team}:${groupId}`;

// Used in upcoming tasks; intentionally referenced.
void MAX_HP; void DAMAGE_PER_TICK; void TICK_MS; void groupOrderKey;

const TERRAINS: Record<string, TerrainDef> = {
  DEEP_SEA: { color: 0x1a2a3a, label: 'Deep Water', height: 2 },
  SEA: { color: 0x2a3a4a, label: 'Shallows', height: 5 },
  SAND: { color: 0xbdaa8a, label: 'Shoreline', height: 8 },
  PLAIN: { color: 0x5a7a4a, label: 'Lowlands', height: 12 },
  GRASS: { color: 0x3a5a3a, label: 'Thicket', height: 18 },
  HILL: { color: 0x6b5d44, label: 'Ridgeline', height: 35 },
  ROCKY: { color: 0x4a4a4a, label: 'Plateau', height: 55 },
  MOUNTAIN: { color: 0x2d2d2d, label: 'Summit', height: 85 },
  SNOW: { color: 0xf0f0f0, label: 'Glacier', height: 110 },
  RIVER: { color: 0x3a8fb7, label: 'Waterway', height: 10 },
};

export const GameCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const worldRef = useRef<PIXI.Container>(new PIXI.Container());
  const terrainGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  const highlightGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  const unitsGfx = useRef<PIXI.Container>(new PIXI.Container());
  
  const noiseRef = useRef<ReturnType<typeof createNoise2D> | null>(null);
  const armyTextureRef = useRef<PIXI.Texture | null>(null);
  const unitTextureRef = useRef<PIXI.Texture | null>(null);

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
  const isPlacing = inputMode === 'place'; // derived; keeps existing JSX expressions terse
  const [selectedTeam, setSelectedTeam] = useState<Team>('red');
  const [selectedGroup, setSelectedGroup] = useState<GroupId>(1);
  const [groupOrders, setGroupOrders] = useState<GroupOrders>(new Map());
  const [isBattleRunning, setIsBattleRunning] = useState(false);
  const [genSettings, setSettings] = useState({
    waterLevel: 0.4,
    mountainLevel: 0.85,
    noiseOffset: { q: 0, r: 0 },
    resolution: STRATEGIC_RESOLUTION // Much higher base resolution for smoothness
  });

  const gridRadius = 35;

  // --- Smooth Tactical Generator ---
  const generateWorldData = useCallback(() => {
    const newMap = new Map<string, string>();
    if (!noiseRef.current) noiseRef.current = createNoise2D();
    const noise = noiseRef.current;
    const elevationCache = new Map<string, number>();

    // 1. Smooth Elevation Sampling
    for (let q = -gridRadius; q <= gridRadius; q++) {
      for (let r = Math.max(-gridRadius, -q - gridRadius); r <= Math.min(gridRadius, -q + gridRadius); r++) {
        // COORDINATE TRANSFORM: To zoom IN, we divide by a LARGER number
        const nx = (q + genSettings.noiseOffset.q) / genSettings.resolution;
        const ny = (r + genSettings.noiseOffset.r) / genSettings.resolution;
        
        // Large scale features
        let e = (noise(nx, ny) + 0.4 * noise(nx * 2.2, ny * 2.2)) / 1.4;
        e = (e + 1) / 2;

        // Radial falloff: strong island shape in STRATEGIC, soft falloff in TACTICAL.
        // For TACTICAL we use the strategic-equivalent position so the dived hex anchors
        // to its strategic boost level (mountain stays mountain-ish at center).
        if (viewMode === 'STRATEGIC') {
          const d = Math.sqrt(q*q + r*r + q*r) / gridRadius;
          e *= Math.max(0, 1.1 - Math.pow(d, 2.5));
        } else {
          const scaleBack = STRATEGIC_RESOLUTION / genSettings.resolution;
          const qe = (q + genSettings.noiseOffset.q) * scaleBack;
          const re = (r + genSettings.noiseOffset.r) * scaleBack;
          const d = Math.sqrt(qe*qe + re*re + qe*re) / gridRadius;
          e *= Math.max(0, 1.1 - Math.pow(d, 4));
        }

        let type = 'SEA';
        const w = genSettings.waterLevel;
        const m = genSettings.mountainLevel;

        if (e < w * 0.7) type = 'DEEP_SEA';
        else if (e < w) type = 'SEA';
        else if (e < w + 0.03) type = 'SAND';
        else if (e < m * 0.7) type = 'PLAIN';
        else if (e < m * 0.9) type = 'GRASS';
        else if (e < m) type = 'HILL';
        else if (e < m + 0.1) type = 'MOUNTAIN';
        else type = 'SNOW';

        const key = HexUtils.key({ q, r });
        newMap.set(key, type);
        elevationCache.set(key, e);
      }
    }

    // 2. Cohesion Pass: Remove single-hex noise
    const smoothedMap = new Map<string, string>();
    newMap.forEach((type, key) => {
      const hex = HexUtils.fromKey(key);
      const neighbors = HexUtils.getNeighbors(hex).filter(n => newMap.has(HexUtils.key(n)));
      const neighborTypes = neighbors.map(n => newMap.get(HexUtils.key(n)));
      
      // If isolated, take majority neighbor type
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
        
        // Tactical Rivers are THICK
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

    setGridData(Array.from(smoothedMap.entries()).map(([k, t]) => ({ hex: HexUtils.fromKey(k), type: t })).sort((a, b) => a.hex.r - b.hex.r));
  }, [genSettings, gridRadius, viewMode]);

  // --- Clean 3D Renderer ---
  const drawMap = useCallback(() => {
    const tGfx = terrainGfx.current;
    tGfx.clear();
    gridData.forEach((item) => {
      const pos = HexUtils.hexToPixel(item.hex);
      const tDef = TERRAINS[item.type] || TERRAINS.SEA;
      const h = tDef.height;
      const s = HexUtils.size;
      const top: { x: number; y: number }[] = [];
      const base: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const r = Math.PI / 180 * (60 * i - 30);
        top.push({ x: pos.x + s * Math.cos(r), y: pos.y + s * Math.sin(r) - h });
        base.push({ x: pos.x + s * Math.cos(r), y: pos.y + s * Math.sin(r) });
      }
      const drawSide = (v1: number, v2: number, shade: number) => {
        tGfx.beginFill(PIXI.Color.shared.setValue(tDef.color).multiply(shade).toNumber());
        tGfx.moveTo(top[v1].x, top[v1].y).lineTo(top[v2].x, top[v2].y).lineTo(base[v2].x, base[v2].y).lineTo(base[v1].x, base[v1].y).closePath().endFill();
      };
      drawSide(2, 1, 0.6); drawSide(1, 0, 0.4); // Visible faces
      tGfx.beginFill(tDef.color);
      if (showGrid) {
        tGfx.lineStyle(1, PIXI.Color.shared.setValue(tDef.color).multiply(0.9).toNumber(), 0.2);
      } else {
        tGfx.lineStyle(0);
      }
      tGfx.moveTo(top[0].x, top[0].y);

      for (let i = 1; i < 6; i++) tGfx.lineTo(top[i].x, top[i].y);
      tGfx.closePath().endFill();
    });
  }, [gridData]);

  const drawUnits = useCallback(() => {
    const c = unitsGfx.current;
    c.removeChildren();
    const armyTex = armyTextureRef.current;
    const unitTex = unitTextureRef.current;
    if (!armyTex || !unitTex) return;

    if (viewMode === 'STRATEGIC') {
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
    if (!currentStrategicHex) return;
    const units = armies.get(HexUtils.key(currentStrategicHex)) ?? [];
    units.forEach(u => {
      const tile = gridData.find(d => d.hex.q === u.tacticalHex.q && d.hex.r === u.tacticalHex.r);
      if (!tile) return;
      const pos = HexUtils.hexToPixel(u.tacticalHex);
      const topY = pos.y - TERRAINS[tile.type].height;

      // Sprite
      const sprite = new PIXI.Sprite(unitTex);
      sprite.tint = TEAM_TINTS[u.team];
      sprite.anchor.set(0.5, 1);
      sprite.x = pos.x;
      sprite.y = topY - 4;
      sprite.width = 32;
      sprite.height = 32;
      c.addChild(sprite);

      // HP bar (only when damaged)
      if (u.hp < MAX_HP) {
        const barW = 26;
        const barH = 4;
        const barX = pos.x - barW / 2;
        const barY = topY - 40;
        const ratio = Math.max(0, u.hp / MAX_HP);
        const bg = new PIXI.Graphics();
        bg.rect(barX, barY, barW, barH).fill({ color: 0x000000, alpha: 0.6 });
        c.addChild(bg);
        const fg = new PIXI.Graphics();
        const r = Math.round(0xef * (1 - ratio) + 0x10 * ratio);
        const g = Math.round(0x44 * (1 - ratio) + 0xb9 * ratio);
        const b = Math.round(0x44 * (1 - ratio) + 0x81 * ratio);
        const color = (r << 16) | (g << 8) | b;
        fg.rect(barX, barY, barW * ratio, barH).fill({ color });
        c.addChild(fg);
      }

      // Group badge
      if (u.groupId !== null) {
        const badge = new PIXI.Text({
          text: String(u.groupId),
          style: { fontSize: 10, fontWeight: '900', fill: 0xffffff, stroke: { color: 0x000000, width: 2 } },
        });
        badge.anchor.set(0.5);
        badge.x = pos.x + 12;
        badge.y = topY - 28;
        c.addChild(badge);
      }
    });

    // Attack target indicators per group
    groupOrders.forEach(order => {
      if (!order.attackTarget) return;
      const tile = gridData.find(d => d.hex.q === order.attackTarget!.q && d.hex.r === order.attackTarget!.r);
      if (!tile) return;
      const pos = HexUtils.hexToPixel(order.attackTarget);
      const topY = pos.y - TERRAINS[tile.type].height;
      const ring = new PIXI.Graphics();
      ring.circle(pos.x, topY, 22).stroke({ width: 3, color: TEAM_TINTS[order.team], alpha: 0.85 });
      c.addChild(ring);
    });
  }, [armies, viewMode, gridData, currentStrategicHex, groupOrders]);

  useEffect(() => {
    let isMounted = true;
    const app = new PIXI.Application();
    const start = async () => {
      await app.init({ resizeTo: window, backgroundColor: 0x050a14, antialias: true });
      const textures = await PIXI.Assets.load<PIXI.Texture>([
        '/units/army.svg',
        '/units/mounted-knight.svg',
      ]);
      if (!isMounted) return;
      armyTextureRef.current = textures['/units/army.svg'];
      unitTextureRef.current = textures['/units/mounted-knight.svg'];
      if (!containerRef.current) return;
      containerRef.current.appendChild(app.canvas);
      appRef.current = app;
      const world = worldRef.current;
      world.x = app.screen.width / 2; world.y = app.screen.height / 2; world.scale.set(zoom.current);
      app.stage.addChild(world);
      world.addChild(terrainGfx.current);
      world.addChild(unitsGfx.current);
      world.addChild(highlightGfx.current);
      
      app.stage.eventMode = 'static'; app.stage.hitArea = app.screen;

      const paintPlace = (hex: Hex) => {
        const strategicHex = currentStrategicHexRef.current;
        if (!strategicHex) return;
        const hexKey = HexUtils.key(hex);
        if (lastPaintedKeyRef.current === hexKey) return;
        lastPaintedKeyRef.current = hexKey;
        const strategicKey = HexUtils.key(strategicHex);
        setArmies(prev => {
          const next = new Map(prev);
          const existing = next.get(strategicKey) ?? [];
          // One unit per hex — skip if occupied (any team).
          if (existing.some(u => u.tacticalHex.q === hex.q && u.tacticalHex.r === hex.r)) {
            return prev;
          }
          const newUnit: Unit = {
            id: crypto.randomUUID(),
            team: selectedTeamRef.current,
            tacticalHex: hex,
            homeHex: hex,
            groupId: null,
            hp: MAX_HP,
            state: 'idle',
          };
          next.set(strategicKey, [...existing, newUnit]);
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

      app.stage.on('pointerdown', (e) => {
        // Brush mode: in placing mode, paint instead of dragging.
        const mode = inputModeRef.current;
        if ((mode === 'place' || mode === 'assign') && currentStrategicHexRef.current) {
          isPaintingRef.current = true;
          lastPaintedKeyRef.current = null;
          const local = world.toLocal(e.global);
          paintAt(HexUtils.pixelToHex({ x: local.x, y: local.y }));
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
      });
      app.stage.on('pointerup', () => {
        isDragging.current = false;
        isPaintingRef.current = false;
        lastPaintedKeyRef.current = null;
      });
      app.stage.on('pointertap', (e) => {
        if (isDragging.current) return;
        const local = world.toLocal(e.global); const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        // Order mode: single-click sets attack target for selected group
        if (inputModeRef.current === 'order') {
          const team = selectedTeamRef.current;
          const groupId = selectedGroupRef.current;
          setGroupOrders(prev => {
            const next = new Map(prev);
            next.set(groupOrderKey(team, groupId), { team, groupId, attackTarget: hex });
            return next;
          });
          setInputMode(null); // auto-exit order mode after one click
          return;
        }
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
        setInputMode(null);
      });

      // eslint-disable-next-line react-hooks/immutability
      app.ticker.add(() => updateHighlights());
      generateWorldData();
    };
    start();
    return () => { isMounted = false; app.destroy(true, { children: true }); };
  }, []);

  const lastTickHadBothTeamsRef = useRef(false);
  const [winBanner, setWinBanner] = useState<Team | null>(null);

  useEffect(() => {
    if (!isBattleRunning) return;
    const id = window.setInterval(() => {
      const strategic = currentStrategicHexRef.current;
      if (!strategic) return;
      const strategicKey = HexUtils.key(strategic);
      setArmies(prev => {
        const units = prev.get(strategicKey) ?? [];
        if (units.length === 0) return prev;
        const teamsBefore = new Set(units.map(u => u.team));
        if (teamsBefore.size >= 2) lastTickHadBothTeamsRef.current = true;
        const next = simulateTick(units, groupOrdersRef.current, { damagePerTick: DAMAGE_PER_TICK });
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
        const updated = new Map(prev);
        updated.set(strategicKey, next);
        return updated;
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isBattleRunning]);

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
  const groupOrdersRef = useRef<GroupOrders>(new Map());
  const isBattleRunningRef = useRef(false);
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
  useEffect(() => { currentStrategicHexRef.current = currentStrategicHex; }, [currentStrategicHex]);
  useEffect(() => { selectedTeamRef.current = selectedTeam; }, [selectedTeam]);
  useEffect(() => { selectedGroupRef.current = selectedGroup; }, [selectedGroup]);
  useEffect(() => { groupOrdersRef.current = groupOrders; }, [groupOrders]);
  useEffect(() => { isBattleRunningRef.current = isBattleRunning; }, [isBattleRunning]);
  /* eslint-enable react-hooks/immutability */
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
        const r = Math.PI / 180 * (60 * i - 30);
        if (i === 0) h.moveTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r)); else h.lineTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
      }
      h.closePath();
    }
  };

  const curT = hoveredHex ? TERRAINS[gridData.find(d => d.hex.q === hoveredHex.q && d.hex.r === hoveredHex.r)?.type || 'SEA'] : null;

  const groupCounts: Record<GroupId, number> = { 1: 0, 2: 0, 3: 0 };
  if (currentStrategicHex) {
    const units = armies.get(HexUtils.key(currentStrategicHex)) ?? [];
    for (const u of units) {
      if (u.team === selectedTeam && u.groupId !== null) {
        groupCounts[u.groupId]++;
      }
    }
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#02040a', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', zIndex: 1, cursor: (isScanning || inputMode !== null) ? 'crosshair' : 'default' }} />

      {winBanner && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          padding: '24px 48px',
          fontSize: '28px',
          fontWeight: 900,
          letterSpacing: '4px',
          color: 'white',
          background: `linear-gradient(135deg, ${winBanner === 'red' ? '#ef4444' : '#3b82f6'} 0%, rgba(0,0,0,0.5) 100%)`,
          border: `2px solid ${winBanner === 'red' ? '#ef4444' : '#3b82f6'}`,
          borderRadius: '20px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          zIndex: 200,
          pointerEvents: 'none',
        }}>
          {winBanner.toUpperCase()} VICTORY
        </div>
      )}

      {/* HUD - Professional Glassmorphism */}
      <div style={{
        position: 'absolute', top: 24, left: 24, color: '#f8fafc', background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(24px)',
        padding: '32px', borderRadius: '32px', border: '1px solid rgba(255, 255, 255, 0.12)',
        width: '360px', boxShadow: '0 40px 80px rgba(0, 0, 0, 0.9)', zIndex: 100, pointerEvents: 'auto',
        fontFamily: '"Inter", sans-serif'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 900 }}>{viewMode} COMMAND</h2>
          <span style={{ fontSize: '10px', color: '#3b82f6', fontWeight: 800, letterSpacing: '1px' }}>SYSTEM READY</span>
        </div>
        
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: '20px', borderRadius: '20px', marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>TERRAIN TYPE</span>
            <span style={{ color: curT ? `#${curT.color.toString(16).padStart(6,'0')}` : '#475569', fontWeight: 900, fontSize: '14px', filter: 'brightness(1.5)' }}>
              {curT ? curT.label : 'OFFLINE'}
            </span>
          </div>
        </div>

        <button
          onClick={() => {
            setIsScanning(s => {
              const next = !s;
              if (next) setInputMode(null);
              return next;
            });
          }}
          style={{ width: '100%', padding: '18px', background: isScanning ? '#ef4444' : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', color: 'white', border: 'none', borderRadius: '16px', fontSize: '13px', fontWeight: '900', cursor: 'pointer', marginBottom: '12px', transition: '0.2s', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)' }}
        >
          {isScanning ? 'CANCEL SCAN' : '🎯 INITIATE TACTICAL DIVE'}
        </button>

        <button
          onClick={() => {
            if (viewMode !== 'TACTICAL') return;
            setInputMode(prev => {
              const next = prev === 'place' ? null : 'place';
              if (next) setIsScanning(false);
              return next;
            });
          }}
          disabled={viewMode !== 'TACTICAL'}
          title={viewMode !== 'TACTICAL' ? 'Dive into a tactical view first' : ''}
          style={{
            width: '100%',
            padding: '14px',
            background: viewMode !== 'TACTICAL'
              ? 'rgba(255,255,255,0.04)'
              : isPlacing ? '#ef4444' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            color: viewMode !== 'TACTICAL' ? '#475569' : 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: viewMode !== 'TACTICAL' ? 'not-allowed' : 'pointer',
            marginBottom: '12px',
            transition: '0.2s',
          }}
        >
          {isPlacing ? 'STOP PLACING' : 'PLACE UNIT'}
        </button>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {(['red', 'blue'] as const).map(team => {
            const active = selectedTeam === team;
            const bg = team === 'red' ? '#ef4444' : '#3b82f6';
            return (
              <button
                key={team}
                onClick={() => setSelectedTeam(team)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: active ? bg : 'rgba(255,255,255,0.04)',
                  color: active ? 'white' : '#94a3b8',
                  border: active ? `1px solid ${bg}` : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '1px',
                  cursor: 'pointer',
                  transition: '0.2s',
                }}
              >
                {team.toUpperCase()}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowGrid(!showGrid)}
          style={{ width: '100%', padding: '12px', background: showGrid ? 'rgba(59, 130, 246, 0.1)' : '#10b981', color: showGrid ? '#60a5fa' : 'white', border: showGrid ? '1px solid rgba(59, 130, 246, 0.5)' : 'none', borderRadius: '12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', marginBottom: '12px', transition: '0.2s' }}
        >
          GRID SYSTEM: {showGrid ? 'ACTIVE' : 'DEACTIVATED'}
        </button>

        {viewMode === 'TACTICAL' && (
          <div style={{
            background: 'rgba(0,0,0,0.4)',
            padding: '14px',
            borderRadius: '14px',
            marginBottom: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800, letterSpacing: '1px', marginBottom: '10px' }}>
              GROUPS
            </div>
            {([1, 2, 3] as const).map(gid => {
              const count = groupCounts[gid];
              const assignActive = inputMode === 'assign' && selectedGroup === gid;
              const orderActive = inputMode === 'order' && selectedGroup === gid;
              const teamColor = TEAM_TINTS[selectedTeam];
              const teamColorHex = `#${teamColor.toString(16).padStart(6, '0')}`;
              return (
                <div key={gid} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <div style={{ flex: '0 0 56px', fontSize: '11px', fontWeight: 800, color: '#cbd5e1' }}>
                    G{gid} <span style={{ color: '#64748b', fontWeight: 600 }}>×{count}</span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedGroup(gid);
                      setInputMode(prev => (prev === 'assign' && selectedGroup === gid) ? null : 'assign');
                      setIsScanning(false);
                    }}
                    style={{
                      flex: 1, padding: '6px', fontSize: '10px', fontWeight: 800,
                      background: assignActive ? teamColorHex : 'rgba(255,255,255,0.04)',
                      color: assignActive ? 'white' : '#94a3b8',
                      border: assignActive ? `1px solid ${teamColorHex}` : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px', cursor: 'pointer',
                    }}
                  >
                    ASSIGN
                  </button>
                  <button
                    disabled={count === 0}
                    onClick={() => {
                      setSelectedGroup(gid);
                      setInputMode(prev => (prev === 'order' && selectedGroup === gid) ? null : 'order');
                      setIsScanning(false);
                    }}
                    style={{
                      flex: 1, padding: '6px', fontSize: '10px', fontWeight: 800,
                      background: orderActive ? teamColorHex : 'rgba(255,255,255,0.04)',
                      color: count === 0 ? '#475569' : orderActive ? 'white' : '#94a3b8',
                      border: orderActive ? `1px solid ${teamColorHex}` : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      cursor: count === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    ATTACK
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setIsBattleRunning(b => !b)}
              style={{
                width: '100%', padding: '12px', marginTop: '6px',
                background: isBattleRunning ? '#ef4444' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white', border: 'none', borderRadius: '10px',
                fontSize: '11px', fontWeight: 900, cursor: 'pointer',
              }}
            >
              {isBattleRunning ? '⏸ PAUSE BATTLE' : '▶ START BATTLE'}
            </button>
          </div>
        )}

        <button
          onClick={() => {
            setSettings(s => ({ ...s, noiseOffset: {q:0, r:0}, resolution: STRATEGIC_RESOLUTION }));
            setViewMode('STRATEGIC');
            setCurrentStrategicHex(null);
            setInputMode(null);
          }}
          style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', marginBottom: '32px' }}
        >RETURN TO STRATEGIC OVERVIEW</button>

        <button onClick={() => {
          noiseRef.current = null;
          setArmies(new Map());
          setCurrentStrategicHex(null);
          setInputMode(null);
          generateWorldData();
        }} style={{ width: '100%', padding: '20px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '16px', fontSize: '14px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)' }}>
          REGENERATE ECOSYSTEM
        </button>
      </div>
    </div>
  );
};
