import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import gsap from 'gsap';
import { createNoise2D } from 'simplex-noise';

// --- Professional Tactical Palette ---
interface TerrainDef {
  color: number;
  label: string;
  height: number;
}

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
  
  const noiseRef = useRef<ReturnType<typeof createNoise2D> | null>(null);
  const armyTextureRef = useRef<PIXI.Texture | null>(null);
  const unitTextureRef = useRef<PIXI.Texture | null>(null);

  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const zoom = useRef(0.5);

  const [gridData, setGridData] = useState<{ hex: Hex; type: string }[]>([]);
  const [hoveredHex, setHoveredHex] = useState<Hex | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [viewMode, setViewMode] = useState<'STRATEGIC' | 'TACTICAL'>('STRATEGIC');
  
  const [genSettings, setSettings] = useState({
    waterLevel: 0.4,
    mountainLevel: 0.85,
    noiseOffset: { q: 0, r: 0 },
    resolution: 40.0 // Much higher base resolution for smoothness
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

        // Radial falloff for islands (only in Strategic view)
        if (viewMode === 'STRATEGIC') {
          const d = Math.sqrt(q*q + r*r + q*r) / gridRadius;
          e *= Math.max(0, 1.1 - Math.pow(d, 2.5));
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
      .filter(([_, t]) => t === 'MOUNTAIN' || t === 'SNOW' || t === 'HILL')
      .map(([k]) => HexUtils.fromKey(k));

    for (let i = 0; i < riverCount; i++) {
      if (starts.length === 0) break;
      let curr = starts[Math.floor(Math.random() * starts.length)];
      let visited = new Set<string>();
      
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

  useEffect(() => {
    let isMounted = true;
    const app = new PIXI.Application();
    const start = async () => {
      await app.init({ resizeTo: window, backgroundColor: 0x050a14, antialias: true });
      const textures = await PIXI.Assets.load<PIXI.Texture>([
        '/units/army.svg',
        '/units/unit.svg',
      ]);
      if (!isMounted) return;
      armyTextureRef.current = textures['/units/army.svg'];
      unitTextureRef.current = textures['/units/unit.svg'];
      if (!containerRef.current) return;
      containerRef.current.appendChild(app.canvas);
      appRef.current = app;
      const world = worldRef.current;
      world.x = app.screen.width / 2; world.y = app.screen.height / 2; world.scale.set(zoom.current);
      app.stage.addChild(world); world.addChild(terrainGfx.current); world.addChild(highlightGfx.current);
      
      app.stage.eventMode = 'static'; app.stage.hitArea = app.screen;
      app.stage.on('pointerdown', (e) => { isDragging.current = true; lastMousePos.current = { x: e.global.x, y: e.global.y }; });
      app.stage.on('globalpointermove', (e) => {
        if (isDragging.current) { world.x += e.global.x - lastMousePos.current.x; world.y += e.global.y - lastMousePos.current.y; lastMousePos.current = { x: e.global.x, y: e.global.y }; }
        const local = world.toLocal(e.global); setHoveredHex(HexUtils.pixelToHex({ x: local.x, y: local.y }));
      });
      app.stage.on('pointerup', () => isDragging.current = false);
      app.stage.on('pointertap', (e) => {
        if (isDragging.current) return;
        const local = world.toLocal(e.global); const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        if (isScanningRef.current) {
          // CAPTURE GLOBAL NOISE COORDS
          const targetOffsetQ = (hex.q + noiseOffsetRef.current.q);
          const targetOffsetR = (hex.r + noiseOffsetRef.current.r);
          
          gsap.to(world.scale, { x: 3, y: 3, duration: 0.6, ease: 'power2.in' });
          gsap.to(world, { x: app.screen.width/2 - (hex.q * 20), y: app.screen.height/2 - (hex.r * 20), duration: 0.6, ease: 'power2.in', onComplete: () => {
            setSettings(s => ({ ...s, noiseOffset: { q: targetOffsetQ, r: targetOffsetR }, resolution: s.resolution * 4.5 }));
            setViewMode('TACTICAL');
            setIsScanning(false);
            gsap.fromTo(world.scale, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8, duration: 0.8, ease: 'power2.out' });
          }});
        }
      });

      containerRef.current?.addEventListener('wheel', (e) => {
        e.preventDefault(); const factor = 1.15; const delta = e.deltaY > 0 ? 1/factor : factor; const oldScale = zoom.current;
        const newScale = Math.min(Math.max(oldScale * delta, 0.05), 6); const mouseLocal = world.toLocal(new PIXI.Point(e.clientX, e.clientY));
        world.scale.set(newScale); world.x -= (mouseLocal.x * newScale - mouseLocal.x * oldScale); world.y -= (mouseLocal.y * newScale - mouseLocal.y * oldScale); zoom.current = newScale;
      }, { passive: false });

      app.ticker.add(() => updateHighlights());
      generateWorldData();
    };
    start();
    return () => { isMounted = false; app.destroy(true, { children: true }); };
  }, []);

  const isScanningRef = useRef(false);
  const noiseOffsetRef = useRef({ q: 0, r: 0 });
  useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);
  useEffect(() => { noiseOffsetRef.current = genSettings.noiseOffset; }, [genSettings.noiseOffset]);
  useEffect(() => { drawMap(); }, [gridData, drawMap]);
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

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#02040a', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', zIndex: 1, cursor: isScanning ? 'crosshair' : 'default' }} />
      
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
          onClick={() => setIsScanning(!isScanning)}
          style={{ width: '100%', padding: '18px', background: isScanning ? '#ef4444' : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', color: 'white', border: 'none', borderRadius: '16px', fontSize: '13px', fontWeight: '900', cursor: 'pointer', marginBottom: '12px', transition: '0.2s', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)' }}
        >
          {isScanning ? 'CANCEL SCAN' : '🎯 INITIATE TACTICAL DIVE'}
        </button>

        <button 
          onClick={() => setShowGrid(!showGrid)}
          style={{ width: '100%', padding: '12px', background: showGrid ? 'rgba(59, 130, 246, 0.1)' : '#10b981', color: showGrid ? '#60a5fa' : 'white', border: showGrid ? '1px solid rgba(59, 130, 246, 0.5)' : 'none', borderRadius: '12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', marginBottom: '12px', transition: '0.2s' }}
        >
          GRID SYSTEM: {showGrid ? 'ACTIVE' : 'DEACTIVATED'}
        </button>

        <button 
          onClick={() => { setSettings(s => ({ ...s, noiseOffset: {q:0, r:0}, resolution: 40.0 })); setViewMode('STRATEGIC'); }}
          style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', marginBottom: '32px' }}
        >RETURN TO STRATEGIC OVERVIEW</button>

        <button onClick={() => generateWorldData()} style={{ width: '100%', padding: '20px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '16px', fontSize: '14px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)' }}>
          REGENERATE ECOSYSTEM
        </button>
      </div>
    </div>
  );
};
