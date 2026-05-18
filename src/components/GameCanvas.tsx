import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import gsap from 'gsap';
import { createNoise2D } from 'simplex-noise';
import { simulateTick, groupHeading, snapHeading, computeFormationPreview, computeLineDragSlots, computeWedgeDragSlots, computeHexDragSlots, computeOrderedSlotAssignments, computeLineSlotAssignmentsByType, computeDefendFormation, CHARGE_DURATION_TICKS, MAX_HP_BY_TYPE } from '../battle/simulate';
import type { Unit, GroupOrder, OrderMode, Team, GroupId, FormationType, MapApi, UnitType } from '../battle/simulate';
import { TERRAIN_MODS, getTerrainMods } from '../battle/terrain';

const DRAG_THRESHOLD_PX = 24;

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

interface DefendDrag {
  team: Team;
  groupId: GroupId;
  startHex: Hex;
  currentEndHex: Hex;
}

const HEADING_ARROWS: Record<number, string> = {
  0: '→', 1: '↗', 2: '↖', 3: '←', 4: '↙', 5: '↘',
};

// --- Constants ---
const STRATEGIC_RESOLUTION = 40;
const DIVE_ZOOM = 4.5;

// --- Professional Tactical Palette ---
interface TerrainDef {
  color: number;
  label: string;
  height: number;
  /** Whether units can stand on this terrain. Used by the rigid-block march for validation. */
  walkable: boolean;
  /** Defense rating; HIGHER = better cover. Damage divides by this. Default 1.0. */
  defenseMult?: number;
  /** Extra ticks of movement cooldown on entry. Default 0. */
  moveCost?: number;
  /** HP drained per tick while standing on this hex. Default 0. */
  attritionPerTick?: number;
  /** Sight radius (hexes) for a unit on this terrain. Default 4. */
  visionRadius?: number;
}

type InputMode = 'place' | 'assign' | 'order' | 'defend';

type Armies = Map<string, Unit[]>;
type GroupOrders = Map<string, GroupOrder>;
type GroupFormations = Map<string, FormationType>;
type GroupDepths = Map<string, number>;

const FORMATION_CYCLE: FormationType[] = ['line', 'wedge', 'column', 'hex'];
const FORMATION_LABELS: Record<FormationType, string> = {
  hex: '⬢ HEX',
  line: '─ LINE',
  wedge: '△ WDGE',
  column: '│ COL',
};

const DEPTH_CYCLE: number[] = [1, 2, 3, 4];

const TEAM_TINTS: Record<Team, number> = {
  red: 0xef4444,
  blue: 0x3b82f6,
};

const DAMAGE_PER_TICK = 10;
const TICK_MS = 500;

// Below this world.scale, swap each unit's soldier sprite for a stylized strategic
// marker (filled team-tinted hex top). At far zoom individual soldier features are
// unreadable anyway, and a clean colored token reads like an army-position marker
// instead of a smear of tiny pixelated sprites. The ticker watches world.scale
// directly and toggles visibility when the threshold is crossed.
const LOD_THRESHOLD = 0.25;

const groupOrderKey = (team: Team, groupId: GroupId): string => `${team}:${groupId}`;

// Used in upcoming tasks; intentionally referenced.
void DAMAGE_PER_TICK; void TICK_MS; void groupOrderKey;

// Mod fields are sourced from `TERRAIN_MODS` in `src/battle/terrain.ts` (single source of
// truth — `terrain.ts` owns the mechanical values so it stays React/PIXI-free for the
// headless harness). Spreading them here surfaces the same fields on `TerrainDef` for
// HUD/tooltips and keeps the table self-documenting. Render-side fields (color/label/
// height/walkable) stay native to this file.
const TERRAINS: Record<string, TerrainDef> = {
  DEEP_SEA: { color: 0x1a2a3a, label: 'Deep Water', height: 2, walkable: false },
  SEA: { color: 0x2a3a4a, label: 'Shallows', height: 5, walkable: false },
  SAND: { color: 0xbdaa8a, label: 'Shoreline', height: 8, walkable: true, ...TERRAIN_MODS.SAND },
  GRASSLAND: { color: 0x5a7a4a, label: 'Lowlands', height: 12, walkable: true, ...TERRAIN_MODS.GRASSLAND },
  FOREST: { color: 0x3a5a3a, label: 'Thicket', height: 18, walkable: true, ...TERRAIN_MODS.FOREST },
  HILL: { color: 0x6b5d44, label: 'Ridgeline', height: 35, walkable: true, ...TERRAIN_MODS.HILL },
  ROCKY: { color: 0x4a4a4a, label: 'Plateau', height: 55, walkable: true, ...TERRAIN_MODS.ROCKY },
  MOUNTAIN: { color: 0x2d2d2d, label: 'Summit', height: 85, walkable: true, ...TERRAIN_MODS.MOUNTAIN },
  SNOW: { color: 0xf0f0f0, label: 'Glacier', height: 110, walkable: false },
  RIVER: { color: 0x3a8fb7, label: 'Waterway', height: 10, walkable: true, ...TERRAIN_MODS.RIVER },
};

export const GameCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const worldRef = useRef<PIXI.Container>(new PIXI.Container());
  const terrainGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  const highlightGfx = useRef<PIXI.Graphics>(new PIXI.Graphics());
  const unitsGfx = useRef<PIXI.Container>(new PIXI.Container());
  // Per-unit containers keyed by unit.id. Persist across drawUnits calls so we can
  // GSAP-tween their position between hexes (smooth movement between ticks instead
  // of teleporting). Children inside each container use offsets relative to the
  // container origin (= unit's hex top-center pixel), so children move with the tween.
  const unitContainersRef = useRef<Map<string, PIXI.Container>>(new Map());
  const previewGfx = useRef<PIXI.Container>(new PIXI.Container());
  
  const noiseRef = useRef<ReturnType<typeof createNoise2D> | null>(null);
  const armyTextureRef = useRef<PIXI.Texture | null>(null);
  const unitTextureRef = useRef<PIXI.Texture | null>(null);
  const unitTextureBlueRef = useRef<PIXI.Texture | null>(null);
  const unitTextureRedCavalryRef = useRef<PIXI.Texture | null>(null);
  const unitTextureBlueCavalryRef = useRef<PIXI.Texture | null>(null);
  // Per-team skirmisher sprites: red uses the roman wolf-helm javelineer; blue uses the
  // generic painted skirmisher illustration. Team-tint outline on the unit container
  // remains the unambiguous side indicator regardless of sprite.
  const unitTextureRedSkirmisherRef = useRef<PIXI.Texture | null>(null);
  const unitTextureBlueSkirmisherRef = useRef<PIXI.Texture | null>(null);
  // Javelin sprite used for in-flight projectiles thrown by skirmishers. One shared
  // texture across both teams (no team-tint — javelins look the same regardless of who
  // threw them).
  const javelinTextureRef = useRef<PIXI.Texture | null>(null);
  // Tiled background textures for terrain hex tops. Wrap mode is set to 'repeat' on
  // load so adjacent same-type hexes share the same world-space UV grid and the texture
  // looks continuous (no per-hex seam).
  const grassTextureRef = useRef<PIXI.Texture | null>(null);
  const forestTextureRef = useRef<PIXI.Texture | null>(null);
  const riverTextureRef = useRef<PIXI.Texture | null>(null);
  const hillTextureRef = useRef<PIXI.Texture | null>(null);
  const mountainTextureRef = useRef<PIXI.Texture | null>(null);
  const snowTextureRef = useRef<PIXI.Texture | null>(null);
  const sandTextureRef = useRef<PIXI.Texture | null>(null);
  const seaTextureRef = useRef<PIXI.Texture | null>(null);
  const deepSeaTextureRef = useRef<PIXI.Texture | null>(null);
  // Container for in-flight projectile sprites. Lives in world space (so it pans/zooms
  // with the camera) and is rebuilt-per-tick: each sim result pushes new sprites onto it,
  // GSAP tweens them to the target, and onComplete destroys them.
  const projectilesGfx = useRef<PIXI.Container>(new PIXI.Container());
  // Overlay for textured terrain types that need GLOBAL-UV tiling (e.g. HILL). The
  // standard `tGfx.poly().fill({ texture, matrix })` path on `terrainGfx` normalises UVs
  // to each polygon's bbox, so every hex sees the same texture patch — visible as obvious
  // repetition. This overlay sidesteps that by using one big TilingSprite per textured
  // terrain biome, masked to the union of that biome's hex tops. Inside a contiguous
  // biome the texture genuinely tiles in world space.
  const terrainOverlayRef = useRef<PIXI.Container>(new PIXI.Container());

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
  const [selectedUnitType, setSelectedUnitType] = useState<UnitType>('infantry');
  const [groupOrders, setGroupOrders] = useState<GroupOrders>(new Map());
  const [groupFormations, setGroupFormations] = useState<GroupFormations>(new Map());
  const [groupDepths, setGroupDepths] = useState<GroupDepths>(new Map());
  const [isBattleRunning, setIsBattleRunning] = useState(false);
  // Set true once terrain-related textures (currently just grass) finish loading.
  // drawMap reads it via deps so the map redraws once textures are ready.
  const [terrainTexturesLoaded, setTerrainTexturesLoaded] = useState(false);
  const [fogOfWar, setFogOfWar] = useState(false);
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
        else if (e < m * 0.7) type = 'GRASSLAND';
        else if (e < m * 0.9) type = 'FOREST';
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
    // World→UV matrix for terrain texture fills. The source tiles are large (~1200+ px)
    // relative to a hex (~80 px), so at identity each hex shows only a tiny near-uniform
    // patch. Scaling by 14 shrinks the visible tile to ~88 world px (≈ 1.1 hex widths),
    // giving each hex its own near-unique slice of the texture so adjacent hexes never
    // sample matching patches — kills the per-hex "same shape" repetition perception.
    const terrainUvMatrix = new PIXI.Matrix().scale(14, 14);
    // Quick neighbor lookup, used below by the HILL "continuous-plain" rendering path to
    // suppress per-hex 3D walls and grid strokes between two HILL hexes (so the biome
    // reads as one painted landscape rather than 6+ fenced bumps).
    const terrainAt = new Map<string, string>(gridData.map(d => [HexUtils.key(d.hex), d.type]));
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
      // Global-UV terrains (HILL, MOUNTAIN) suppress the two visible side walls when the
      // neighbour on that face is the SAME type. Inside a contiguous biome this removes
      // the per-hex 3D bump, so the textured top (rendered by the TilingSprite overlay
      // below with world-space UVs) reads as one continuous painted plain. At a biome
      // boundary the wall stays, preserving the elevation drop as a terrain cue. Other
      // terrains keep the original behaviour.
      // Vertex→neighbour mapping: edge (1,2) faces SE (dir 5), edge (0,1) faces E (dir 0).
      const isGlobalUv = item.type === 'HILL' || item.type === 'MOUNTAIN' || item.type === 'SNOW';
      const seType = isGlobalUv ? terrainAt.get(HexUtils.key({ q: item.hex.q, r: item.hex.r + 1 })) : undefined;
      const eType  = isGlobalUv ? terrainAt.get(HexUtils.key({ q: item.hex.q + 1, r: item.hex.r })) : undefined;
      if (!isGlobalUv || seType !== item.type) drawSide(2, 1, 0.6);
      if (!isGlobalUv || eType !== item.type) drawSide(1, 0, 0.4);
      // Top hexagon. Grass uses a tiled painted texture; all other terrains keep flat
      // colour. wrap='repeat' (set at load) lets adjacent grass hexes sample one global
      // UV grid so the field reads continuous. PIXI v8 fluent API: poly(points).fill(...).
      const grassTex = grassTextureRef.current;
      const forestTex = forestTextureRef.current;
      const riverTex = riverTextureRef.current;
      const hillTex = hillTextureRef.current;
      const sandTex = sandTextureRef.current;
      const seaTex = seaTextureRef.current;
      const deepSeaTex = deepSeaTextureRef.current;
      // Multiplicative tint on textured fills — darkens the terrain so it sits visually
      // under unit sprites without overwhelming them. 0xFFFFFF = unchanged, lower = darker.
      let fillStyle: { texture?: PIXI.Texture; matrix?: PIXI.Matrix; color: number };
      if (item.type === 'GRASSLAND' && grassTex) {
        fillStyle = { texture: grassTex, matrix: terrainUvMatrix, color: 0x888888 };
      } else if (item.type === 'FOREST' && forestTex) {
        fillStyle = { texture: forestTex, matrix: terrainUvMatrix, color: 0x888888 };
      } else if (item.type === 'RIVER' && riverTex) {
        fillStyle = { texture: riverTex, matrix: terrainUvMatrix, color: 0xC8C8C8 };
      } else if (item.type === 'SAND' && sandTex) {
        fillStyle = { texture: sandTex, matrix: terrainUvMatrix, color: 0xC8C8C8 };
      } else if (item.type === 'SEA' && seaTex) {
        // Coastal sea: darker filter so the shallows read distinctly from any RIVER/inland
        // water and the open ocean further out (DEEP_SEA stays at the lighter tint).
        fillStyle = { texture: seaTex, matrix: terrainUvMatrix, color: 0x506070 };
      } else if (item.type === 'DEEP_SEA' && deepSeaTex) {
        fillStyle = { texture: deepSeaTex, matrix: terrainUvMatrix, color: 0xC8C8C8 };
      } else {
        // HILL and MOUNTAIN intentionally fall through to flat color here — the TilingSprite
        // overlay below paints the textured surface on top with world-space UVs (no per-hex
        // repetition). The flat color shows only briefly before textures finish loading.
        fillStyle = { color: tDef.color };
      }
      // hillTex referenced for the overlay build above; mark as read in this scope.
      void hillTex;
      const topPoints: number[] = [];
      for (let i = 0; i < 6; i++) { topPoints.push(top[i].x, top[i].y); }
      tGfx.poly(topPoints).fill(fillStyle);
      if (isGlobalUv) {
        // Global-UV terrains read as one continuous painted plain inside the biome, so
        // internal same-type edges get NO stroke at all (regardless of showGrid). Only
        // edges that border a different terrain get a stroke — and that one stays subtle,
        // since the 3D side wall (still drawn at those edges above) is the dominant biome
        // cue.
        // Vertex/dir mapping (pointy-top, `r = 60°·i − 30°`):
        //   (5,0)→NE dir1, (0,1)→E dir0, (1,2)→SE dir5, (2,3)→SW dir4, (3,4)→W dir3, (4,5)→NW dir2.
        const edgePairs: [number, number, number][] = [
          [5, 0, 1], [0, 1, 0], [1, 2, 5], [2, 3, 4], [3, 4, 3], [4, 5, 2],
        ];
        for (const [v1, v2, dirIdx] of edgePairs) {
          const dir = HexUtils.directions[dirIdx];
          const nType = terrainAt.get(HexUtils.key({ q: item.hex.q + dir.q, r: item.hex.r + dir.r }));
          if (nType !== item.type) {
            tGfx.poly([top[v1].x, top[v1].y, top[v2].x, top[v2].y])
                .stroke({ width: 1.5, color: 0x142016, alpha: 0.4 });
          }
        }
      } else if (showGrid) {
        tGfx.poly(topPoints).stroke({
          width: 1,
          color: PIXI.Color.shared.setValue(tDef.color).multiply(0.9).toNumber(),
          alpha: 0.2,
        });
      }
    });

    // Global-UV terrain overlays: ONE big TilingSprite per terrain type, covering the
    // world bbox of that type's hexes and masked to the union of those hex tops. The tile
    // coordinate space is the sprite's own local space — so adjacent hexes see different
    // (continuous) patches of the texture, killing the per-hex repetition that the
    // Graphics fill path produces. Used for terrain types with strong, distinct features
    // where the per-hex repeat would be obvious (HILL, MOUNTAIN).
    const overlay = terrainOverlayRef.current;
    for (const child of overlay.children.slice()) {
      // The TilingSprite is masked by the Graphics child; clearing the mask reference
      // before destroying keeps PIXI from holding onto a destroyed mask.
      if ('mask' in child) (child as PIXI.Sprite).mask = null;
      overlay.removeChild(child);
      child.destroy({ children: true, texture: false });
    }
    const globalUvOverlays: { type: string; texture: PIXI.Texture | null; tint: number }[] = [
      { type: 'HILL', texture: hillTextureRef.current, tint: 0xC8C8C8 },
      { type: 'MOUNTAIN', texture: mountainTextureRef.current, tint: 0xC8C8C8 },
      { type: 'SNOW', texture: snowTextureRef.current, tint: 0xFFFFFF },
    ];
    for (const layer of globalUvOverlays) {
      if (!layer.texture) continue;
      const hexes = gridData.filter(d => d.type === layer.type);
      if (hexes.length === 0) continue;
      const hexH = (TERRAINS[layer.type] ?? TERRAINS.SEA).height;
      const sz = HexUtils.size;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const d of hexes) {
        const p = HexUtils.hexToPixel(d.hex);
        const topY = p.y - hexH;
        for (let i = 0; i < 6; i++) {
          const r = Math.PI / 180 * (60 * i - 30);
          const vx = p.x + sz * Math.cos(r);
          const vy = topY + sz * Math.sin(r);
          if (vx < minX) minX = vx;
          if (vx > maxX) maxX = vx;
          if (vy < minY) minY = vy;
          if (vy > maxY) maxY = vy;
        }
      }
      const w = maxX - minX;
      const h = maxY - minY;
      const tile = new PIXI.TilingSprite({ texture: layer.texture, width: w, height: h });
      tile.x = minX;
      tile.y = minY;
      // One tile spans ~110 world px (≈ 1.4 hex widths): texture details read at hex zoom
      // without an obvious 1:1 hex:tile coincidence.
      const tileScale = 110 / layer.texture.width;
      tile.tileScale.set(tileScale, tileScale);
      tile.tint = layer.tint;
      const mask = new PIXI.Graphics();
      for (const d of hexes) {
        const p = HexUtils.hexToPixel(d.hex);
        const topY = p.y - hexH;
        const pts: number[] = [];
        for (let i = 0; i < 6; i++) {
          const r = Math.PI / 180 * (60 * i - 30);
          pts.push(p.x + sz * Math.cos(r), topY + sz * Math.sin(r));
        }
        mask.poly(pts).fill({ color: 0xffffff });
      }
      overlay.addChild(tile);
      overlay.addChild(mask);
      tile.mask = mask;
    }
  }, [gridData, showGrid, terrainTexturesLoaded]);

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

    // Tear down all per-unit containers (kill any in-flight tweens first so GSAP
    // doesn't touch a destroyed object). Used when leaving tactical view or when
    // there's no active battle to render.
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

    // Reconciliation: destroy containers for units that no longer exist (dead,
    // removed, or the army emptied) so GSAP can't tween into ghosts. Then sweep
    // any non-container leftovers (e.g., strategic sprites that hadn't been
    // cleared when we transitioned views).
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

    // Lieutenant per (team, groupId): if the group has an active order, the lieutenant is
    // the unit currently at the attack target hex (i.e., the unit that snapped to slots[0]
    // at deploy time and has been carried along by the rigid-block march). Otherwise fall
    // back to the lowest-id live unit so a marker still appears between orders.
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

    // Map hex-key → team for the team-outline edge filter below. A hex's edge k is
    // shared with the neighbor at HexUtils.directions[(6 - k) % 6] (verts go clockwise
    // in screen coords but directions go counterclockwise from E); if that neighbor
    // holds a same-team ally we skip drawing edge k, so the cluster shows only its
    // exterior perimeter.
    const teamByKey = new Map<string, Team>();
    for (const u of units) teamByKey.set(HexUtils.key(u.tacticalHex), u.team);

    // Initial LOD state from the live world scale (zoom.current can be stale during a
    // gsap dive). The ticker re-applies on every threshold crossing too. Hoisted here
    // so the per-unit overlays AND the per-order attack-target ring share one value.
    const isFar = worldRef.current.scale.x < LOD_THRESHOLD;

    // Fog of war: precompute the set of hex keys any friendly unit can currently see.
    // Bounding-box scan with axial-distance prune (HexUtils.distance is ground truth).
    // Friendlies are always rendered below; only enemy units check against this set.
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
      // Animation cache key includes Y elevation so world-regen (same hex, different
      // terrain type at that hex → different topY) re-targets the container even when
      // the unit didn't logically move. Without this, a unit standing on a hex whose
      // terrain type changes would render at the old elevation until it moved.
      const targetKey = `${hexKey}|${Math.round(topY)}`;

      // Get-or-create persistent container per unit. Existing containers tween to
      // the new position (smooth motion); first-appearance containers snap. We
      // compare against the LAST TARGET key (not container.position, which is
      // mid-tween) so re-renders from non-movement causes (fog toggle, hover, etc.)
      // don't retrigger animation.
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
        gsap.to(container.position, {
          x: pos.x,
          y: topY,
          duration: TICK_MS / 1000,
          ease: 'linear',
          overwrite: true,
        });
      }

      // Fog of war: hide enemy units outside any friendly's vision. Position keeps
      // tweening even while hidden, so when fog reveals the unit it's at the
      // correct current location instead of teleporting from its last-seen hex.
      // Children are still rebuilt below — keeps HP bar / lieutenant marker fresh
      // so a fog reveal shows the unit's current state, not the last seen one.
      const isHidden = fogOfWar && u.team !== selectedTeam && !visibleHexes.has(hexKey);
      container.visible = !isHidden;

      // Rebuild children inside the container. Children use RELATIVE offsets from
      // container origin (= unit's hex top-center in world space). The container's
      // GSAP tween carries them all along.
      container.removeChildren();

      const teamColor = TEAM_TINTS[u.team];
      const s = HexUtils.size;
      const verts: { x: number; y: number }[] = [];
      for (let k = 0; k < 6; k++) {
        const ang = Math.PI / 180 * (60 * k - 30);
        verts.push({ x: s * Math.cos(ang), y: s * Math.sin(ang) });
      }

      // Strategic marker — team-tinted hex top. Drawn before the outline so the
      // outline strokes render on top of the fill.
      const marker = new PIXI.Graphics();
      marker.poly(verts.flatMap(v => [v.x, v.y])).fill({ color: teamColor, alpha: 0.7 });
      marker.label = 'unit-marker';
      marker.visible = isFar;
      container.addChild(marker);

      // Outline — only the edges not shared with a same-team neighbor.
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

      // Sprite — team+type-specific unit illustration. y=32 = below container origin
      // (origin is at hex TOP; sprite anchors at its bottom-center). `unitType` falls
      // back to 'infantry' for any pre-feature units still in state from hot-reload.
      const unitType = u.unitType ?? 'infantry';
      const tex = u.team === 'red'
        ? (unitType === 'skirmisher' ? unitTexRedSkir : unitType === 'cavalry' ? unitTexRedCav : unitTex)
        : (unitType === 'skirmisher' ? unitTexBlueSkir : unitType === 'cavalry' ? unitTexBlueCav : unitTexBlue);
      const sprite = new PIXI.Sprite(tex);
      sprite.anchor.set(0.5, 1);
      sprite.x = 0;
      sprite.y = 32;
      // Roman (red) cavalry and skirmisher artwork has more empty margin inside its bbox
      // than the infantry sprite, so at the same render size the figures read smaller.
      // Bump those two up so the visible silhouette matches the infantry on screen.
      const isOversizedRedSprite = u.team === 'red' && (unitType === 'cavalry' || unitType === 'skirmisher');
      const spriteSize = isOversizedRedSprite ? 100 : 72;
      sprite.width = spriteSize;
      sprite.height = spriteSize;
      sprite.label = 'unit-sprite';
      sprite.visible = !isFar;
      container.addChild(sprite);

      // HP bar (only when damaged). Per-type max so cavalry's 30/60 fills 50% rather
      // than the 30% an infantry's 30/100 would show.
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

      // Lieutenant ★ + heading arrow.
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

  useEffect(() => {
    let isMounted = true;
    const app = new PIXI.Application();
    // Hoisted so the unmount cleanup can detach the dblclick listener registered inside `start`.
    let dblClickHandler: ((e: MouseEvent) => void) | null = null;
    const start = async () => {
      await app.init({ resizeTo: window, backgroundColor: 0x050a14, antialias: true });
      // The army SVG is natively 40×40. PIXI rasterizes it once at native size, which is
      // blurry on high-DPI screens (where 40 CSS pixels = 80+ device pixels). Render the
      // SVG into a high-res canvas (4× display size) so PIXI downsamples nicely instead.
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

      const [armyTex, romanSoldierTex, hopliteTex, mountedKnightTex, cavalryHopliteTex, romanSkirmisherTex, skirmisherTex, javelinTex, grassTex, forestTex, riverTex, hillTex, mountainTex, snowTex, sandTex, seaTex, deepSeaTex] = await Promise.all([
        loadHighResSvgTexture('/units/army.svg', 160),
        PIXI.Assets.load<PIXI.Texture>('/units/roman_soldier.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/hoplite.png'),
        // Both cavalry sprites are painted PNGs, same pipeline as the infantry/skirmisher
        // textures (LINEAR + mipmaps below).
        PIXI.Assets.load<PIXI.Texture>('/units/mounted-knight.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/cavalry-hoplite.png'),
        // Per-team skirmishers: red wolf-helm javelineer, blue generic painted skirmisher.
        PIXI.Assets.load<PIXI.Texture>('/units/roman_skirmisher.png'),
        PIXI.Assets.load<PIXI.Texture>('/units/skirmisher.png'),
        // Projectile sprite for skirmisher ranged attacks.
        PIXI.Assets.load<PIXI.Texture>('/units/javelin.png'),
        // Tiled terrain textures.
        PIXI.Assets.load<PIXI.Texture>('/terrain/grass.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/forest.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/river.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/hill.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/mountain.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/snow.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/sand.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/sea.png'),
        PIXI.Assets.load<PIXI.Texture>('/terrain/deep-sea.png'),
      ]);
      if (!isMounted) return;
      // All painted sprites: LINEAR scaleMode + auto-generated mipmaps give trilinear
      // filtering, smooth at any zoom level, including heavy minification when the
      // strategic camera is zoomed out (without mipmaps, an 800px → 30px downscale
      // aliases into a shimmering mess).
      for (const tex of [romanSoldierTex, hopliteTex, mountedKnightTex, cavalryHopliteTex, romanSkirmisherTex, skirmisherTex, javelinTex, grassTex, forestTex, riverTex, hillTex, mountainTex, snowTex, sandTex, seaTex, deepSeaTex]) {
        tex.source.scaleMode = 'linear';
        tex.source.autoGenerateMipmaps = true;
        tex.source.updateMipmaps();
      }
      // Terrain tiles repeat across the world. 'repeat' wrap mode means adjacent hexes
      // of the same terrain sample a continuous global UV grid → no per-hex seam, the
      // whole field looks like one painted surface.
      grassTex.source.addressMode = 'repeat';
      forestTex.source.addressMode = 'repeat';
      riverTex.source.addressMode = 'repeat';
      hillTex.source.addressMode = 'repeat';
      mountainTex.source.addressMode = 'repeat';
      snowTex.source.addressMode = 'repeat';
      sandTex.source.addressMode = 'repeat';
      seaTex.source.addressMode = 'repeat';
      deepSeaTex.source.addressMode = 'repeat';
      armyTextureRef.current = armyTex;
      unitTextureRef.current = romanSoldierTex;
      unitTextureBlueRef.current = hopliteTex;
      unitTextureRedCavalryRef.current = mountedKnightTex;
      unitTextureBlueCavalryRef.current = cavalryHopliteTex;
      unitTextureRedSkirmisherRef.current = romanSkirmisherTex;
      unitTextureBlueSkirmisherRef.current = skirmisherTex;
      javelinTextureRef.current = javelinTex;
      grassTextureRef.current = grassTex;
      forestTextureRef.current = forestTex;
      riverTextureRef.current = riverTex;
      hillTextureRef.current = hillTex;
      mountainTextureRef.current = mountainTex;
      snowTextureRef.current = snowTex;
      sandTextureRef.current = sandTex;
      seaTextureRef.current = seaTex;
      deepSeaTextureRef.current = deepSeaTex;
      setTerrainTexturesLoaded(true);
      if (!containerRef.current) return;
      containerRef.current.appendChild(app.canvas);
      appRef.current = app;
      const world = worldRef.current;
      world.x = app.screen.width / 2; world.y = app.screen.height / 2; world.scale.set(zoom.current);
      app.stage.addChild(world);
      world.addChild(terrainGfx.current);
      // HILL (and any future biome with global-UV tiling) renders here, above the base
      // terrain Graphics but below the units, so the TilingSprite covers the flat-color
      // HILL tops while still sitting under any unit standing on a hill.
      world.addChild(terrainOverlayRef.current);
      world.addChild(unitsGfx.current);
      // Projectiles render ABOVE units so a javelin in flight isn't hidden behind a sprite.
      world.addChild(projectilesGfx.current);
      world.addChild(previewGfx.current);
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
          const placementType = gridDataRef.current.find(d => d.hex.q === hex.q && d.hex.r === hex.r)?.type;
          const unitType = selectedUnitTypeRef.current;
          const newUnit: Unit = {
            id: crypto.randomUUID(),
            team: selectedTeamRef.current,
            unitType,
            tacticalHex: hex,
            homeHex: hex,
            groupId: selectedGroupRef.current,
            hp: MAX_HP_BY_TYPE[unitType],
            state: 'idle',
            nextMoveTick: 0,
            visionRadius: getTerrainMods(placementType).visionRadius,
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
        // TW-style continuous-angle drag for LINE / WEDGE. Other formations and the no-real-drag
        // case use the existing 6-snap path so quick-click keeps the old behavior.
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
            const r = Math.PI / 180 * (60 * k - 30);
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

      // For defend input mode: BFS the home-terrain blob from `startHex`, derive borders
      // (filtered by `defendFrom` when present), draw a green outline on each border, and
      // draw a line from start to end when the drag has moved at least one hex.
      const renderDefendPreview = () => {
        const gfx = previewGfx.current;
        gfx.removeChildren();
        const drag = defendDragRef.current;
        if (!drag) return;

        const grid = gridDataRef.current;
        const gridSet = new Set(grid.map(d => HexUtils.key(d.hex)));
        const terrainAt = new Map(grid.map(d => [HexUtils.key(d.hex), d.type]));
        const homeTerrain = terrainAt.get(HexUtils.key(drag.startHex));
        if (!homeTerrain) return;

        const dragDist = HexUtils.distance(drag.startHex, drag.currentEndHex);
        const endTerrain = dragDist > 0 ? terrainAt.get(HexUtils.key(drag.currentEndHex)) : undefined;
        const defendFrom = endTerrain && endTerrain !== homeTerrain ? endTerrain : undefined;

        // BFS the blob.
        const blob = new Set<string>();
        const queue: Hex[] = [drag.startHex];
        while (queue.length) {
          const h = queue.shift()!;
          const k = HexUtils.key(h);
          if (blob.has(k)) continue;
          if (!gridSet.has(k)) continue;
          if (terrainAt.get(k) !== homeTerrain) continue;
          blob.add(k);
          for (const n of HexUtils.getNeighbors(h)) queue.push(n);
        }

        // Borders.
        const borders: Hex[] = [];
        for (const k of blob) {
          const h = HexUtils.fromKey(k);
          for (const n of HexUtils.getNeighbors(h)) {
            const nk = HexUtils.key(n);
            if (!gridSet.has(nk)) continue;
            const nt = terrainAt.get(nk);
            if (!nt || !TERRAINS[nt].walkable) continue;
            if (nt === homeTerrain) continue;
            if (defendFrom && nt !== defendFrom) continue;
            borders.push(h);
            break;
          }
        }

        // Segment BFS from the gesture's start hex (the anchor). Same algorithm as the
        // sim's defendHeight branch — RIVER-flanked borders are terminal. Preview only
        // the borders the sim will actually defend.
        let segmentBorders = borders;
        const borderKeys = new Set(borders.map(b => HexUtils.key(b)));
        let nearestBorder: Hex | null = null;
        let nearestD = Infinity;
        for (const b of borders) {
          const d = HexUtils.distance(drag.startHex, b);
          if (d < nearestD) { nearestD = d; nearestBorder = b; }
        }
        if (nearestBorder) {
          const segment = new Set<string>();
          const segQueue: Hex[] = [nearestBorder];
          while (segQueue.length) {
            const h = segQueue.shift()!;
            const hk = HexUtils.key(h);
            if (segment.has(hk)) continue;
            segment.add(hk);
            let flanked = false;
            for (const n of HexUtils.getNeighbors(h)) {
              if (blob.has(HexUtils.key(n))) continue;
              if (terrainAt.get(HexUtils.key(n)) === 'RIVER') { flanked = true; break; }
            }
            if (flanked) continue;
            for (const n of HexUtils.getNeighbors(h)) {
              const nk = HexUtils.key(n);
              if (!borderKeys.has(nk) || segment.has(nk)) continue;
              segQueue.push(n);
            }
          }
          segmentBorders = borders.filter(b => segment.has(HexUtils.key(b)));
        }

        const drawHexOutline = (hex: Hex, color: number, alpha: number, fillAlpha: number) => {
          const pos = HexUtils.hexToPixel(hex);
          const tile = grid.find(d => d.hex.q === hex.q && d.hex.r === hex.r);
          const topY = pos.y - (tile ? TERRAINS[tile.type].height : 0);
          const poly = new PIXI.Graphics();
          poly.lineStyle(2, color, alpha);
          poly.beginFill(color, fillAlpha);
          const s = HexUtils.size;
          for (let kk = 0; kk < 6; kk++) {
            const r = Math.PI / 180 * (60 * kk - 30);
            if (kk === 0) poly.moveTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
            else poly.lineTo(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
          }
          poly.closePath().endFill();
          gfx.addChild(poly);
        };

        for (const b of segmentBorders) drawHexOutline(b, 0x16a34a, 0.95, 0.22);

        // Start anchor (slightly brighter outline).
        drawHexOutline(drag.startHex, 0x86efac, 1.0, 0.0);

        // Threat-direction line + endpoint marker.
        if (dragDist > 0) {
          const startPx = HexUtils.hexToPixel(drag.startHex);
          const endPx = HexUtils.hexToPixel(drag.currentEndHex);
          const startTile = grid.find(d => d.hex.q === drag.startHex.q && d.hex.r === drag.startHex.r);
          const endTile = grid.find(d => d.hex.q === drag.currentEndHex.q && d.hex.r === drag.currentEndHex.r);
          const startY = startPx.y - (startTile ? TERRAINS[startTile.type].height : 0);
          const endY = endPx.y - (endTile ? TERRAINS[endTile.type].height : 0);
          const line = new PIXI.Graphics();
          line.lineStyle(3, 0xfacc15, 0.9);
          line.moveTo(startPx.x, startY);
          line.lineTo(endPx.x, endY);
          gfx.addChild(line);
          drawHexOutline(drag.currentEndHex, 0xfacc15, 0.95, 0.15);
        }
      };

      // Commit a defend order onto the selected group. `homeHex`'s terrain becomes the
      // sticky `defendTerrain`; `fromHex` (when provided) supplies the threat `defendFrom`.
      // Same-terrain drag (fromHex's terrain == homeHex's terrain) is treated as
      // omnidirectional.
      const commitDefend = (homeHex: Hex, fromHex: Hex | null) => {
        const team = selectedTeamRef.current;
        const groupId = selectedGroupRef.current;
        const key = groupOrderKey(team, groupId);
        const grid = gridDataRef.current;
        const gridSet = new Set(grid.map(d => HexUtils.key(d.hex)));
        const terrainAt = new Map(grid.map(d => [HexUtils.key(d.hex), d.type]));
        const defendTerrain = terrainAt.get(HexUtils.key(homeHex));
        if (!defendTerrain) return;
        const fromTerrain = fromHex ? terrainAt.get(HexUtils.key(fromHex)) : undefined;
        const defendFrom = fromTerrain && fromTerrain !== defendTerrain ? fromTerrain : undefined;

        // Compute the initial sticky unit→slot assignment using current group units +
        // terrain. The sim then walks each unit toward its stored slot every tick — no
        // per-tick re-pair, no oscillation.
        const strategic = currentStrategicHexRef.current;
        const groupUnits = strategic
          ? (armiesRef.current.get(HexUtils.key(strategic)) ?? []).filter(u => u.team === team && u.groupId === groupId)
          : [];
        const mapApi: MapApi = {
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
          isBarrier: (h: Hex) => terrainAt.get(HexUtils.key(h)) === 'RIVER',
        };
        const tentativeOrder: GroupOrder = {
          team, groupId, attackTarget: { q: 0, r: 0 }, heading: 0,
          mode: 'defendHeight', defendTerrain, defendFrom, defendAnchor: homeHex,
        };
        const formation = computeDefendFormation(groupUnits, tentativeOrder, {
          damagePerTick: DAMAGE_PER_TICK,
          mapApi,
          // Pre-pairing helper; doesn't advance time. Pass 0; the helper doesn't read it.
          currentTick: 0,
        });
        const defendAssignments: Record<string, Hex> | undefined = formation
          ? Object.fromEntries(formation.assignment)
          : undefined;

        setGroupOrders(prev => {
          const cur = prev.get(key);
          if (!cur?.attackTarget) return prev;
          const next = new Map(prev);
          next.set(key, {
            ...cur,
            mode: 'defendHeight',
            defendTerrain,
            defendFrom,
            defendAnchor: homeHex,
            defendAssignments,
            chargeTicksRemaining: undefined,
            chargeDamagedIds: undefined,
          });
          return next;
        });
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
        if (mode === 'defend' && currentStrategicHexRef.current) {
          const team = selectedTeamRef.current;
          const groupId = selectedGroupRef.current;
          const local = world.toLocal(e.global);
          const startHex = HexUtils.pixelToHex({ x: local.x, y: local.y });
          defendDragRef.current = { team, groupId, startHex, currentEndHex: startHex };
          renderDefendPreview();
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
        if (defendDragRef.current) {
          defendDragRef.current.currentEndHex = hex;
          renderDefendPreview();
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

          // Compute the slot list for the deploy snap.
          let heading: number;
          let slots: Hex[];
          // Only set for LINE drags; selects type-aware pairing below.
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

          // LINE drags pair by unit role (cav→flanks, skir→front-center, inf→back). Every
          // other formation keeps the march-projection pairing where the frontmost unit
          // lands at slots[0].
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
            setGroupOrders(prev => {
              const next = new Map(prev);
              next.set(groupOrderKey(drag.team, drag.groupId), {
                team: drag.team, groupId: drag.groupId, attackTarget: drag.targetHex, heading,
              });
              return next;
            });
          }
          setInputMode(null);
          cancelOrderDrag();
        }
        // Defend mode: if the user dragged, commit a directional defense and exit mode.
        // If they didn't drag (static click), don't commit and don't exit — wait for the
        // browser dblclick event to complete the omnidirectional gesture.
        const dDrag = defendDragRef.current;
        if (dDrag) {
          const dragDist = HexUtils.distance(dDrag.startHex, dDrag.currentEndHex);
          if (dragDist > 0) {
            commitDefend(dDrag.startHex, dDrag.currentEndHex);
            setInputMode(null);
          }
          defendDragRef.current = null;
          previewGfx.current.removeChildren();
        }
        isDragging.current = false;
        isPaintingRef.current = false;
        lastPaintedKeyRef.current = null;
      });
      // Browser dblclick on the canvas — used by 'defend' input mode for the
      // omnidirectional gesture (double-click on the hex whose terrain to defend).
      dblClickHandler = (e: MouseEvent) => {
        if (inputModeRef.current !== 'defend') return;
        const rect = app.canvas.getBoundingClientRect();
        const local = world.toLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        const hex = HexUtils.pixelToHex({ x: local.x, y: local.y });
        commitDefend(hex, null);
        setInputMode(null);
      };
      app.canvas.addEventListener('dblclick', dblClickHandler);
      app.stage.on('pointertap', (e) => {
        if (isDragging.current) return;
        // Order mode: commit happens in pointerup so the drag direction is captured.
        // pointertap would fire here as well after a static click, but the drag path
        // already handled it (committing on pointerup with auto-heading fallback).
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

      // Per-frame: refresh highlights and apply zoom-based LOD. We read world.scale.x
      // (not zoom.current) because gsap mutates scale directly during the dive animation
      // without touching zoom.current, and we want LOD to follow the camera live.
      // Only iterate children on threshold crossings, so steady-state is ~free.
      let lastLodFar: boolean | null = null;
      // eslint-disable-next-line react-hooks/immutability
      app.ticker.add(() => {
        updateHighlights();
        const isFar = world.scale.x < LOD_THRESHOLD;
        if (isFar === lastLodFar) return;
        lastLodFar = isFar;
        // Top-level children may be per-unit containers (tactical) or flat sprites
        // (strategic / attack-target indicators). Descend one level into containers
        // labeled 'unit-container'; apply LOD directly to top-level labeled children.
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
      if (dblClickHandler) app.canvas.removeEventListener('dblclick', dblClickHandler);
      // Kill any in-flight GSAP tweens targeting unit-container positions before
      // PIXI destroys them — otherwise GSAP keeps updating freed objects for up
      // to TICK_MS after unmount.
      containers.forEach(cont => {
        gsap.killTweensOf(cont);
        gsap.killTweensOf(cont.position);
      });
      containers.clear();
      // Kill any in-flight projectile tweens before PIXI tears down the sprites.
      for (const child of projectilesGfx.current.children) {
        gsap.killTweensOf(child);
      }
      // Clear masks so PIXI doesn't hold references to soon-to-be-destroyed Graphics.
      for (const child of terrainOverlayRef.current.children) {
        if ('mask' in child) (child as PIXI.Sprite).mask = null;
      }
      app.destroy(true, { children: true });
    };
  }, []);

  const lastTickHadBothTeamsRef = useRef(false);
  const [winBanner, setWinBanner] = useState<Team | null>(null);
  // Monotonic tick counter passed into simulateTick so unit movement cooldowns
  // (`unit.nextMoveTick`) compare against a real time axis. Must NOT reset on
  // setInterval start: units retain absolute `nextMoveTick` values across pauses
  // and battle restarts. Resetting tick to 0 while units still hold cooldowns
  // from the prior run (e.g., nextMoveTick=279) leaves every unit frozen on
  // cooldown for hundreds of ticks. The counter is only reset on regenerate /
  // return to strategic, where armies are also wiped.
  const tickCounterRef = useRef(0);

  useEffect(() => {
    if (!isBattleRunning) return;
    const id = window.setInterval(() => {
      const strategic = currentStrategicHexRef.current;
      if (!strategic) return;
      const strategicKey = HexUtils.key(strategic);
      const units = armiesRef.current.get(strategicKey) ?? [];
      if (units.length === 0) return;
      // Compute simulateTick BEFORE dispatching state updates. React batches updater
      // functions and runs them later during render — assigning to a closure variable
      // inside `setArmies(prev => ...)` and reading it on the next line is undefined
      // (the updater hasn't run yet). Compute synchronously here, then dispatch both
      // setters with already-computed values.
      const teamsBefore = new Set(units.map(u => u.team));
      if (teamsBefore.size >= 2) lastTickHadBothTeamsRef.current = true;
      const grid = gridDataRef.current;
      const gridSet = new Set(grid.map(d => HexUtils.key(d.hex)));
      const terrainAt = new Map(grid.map(d => [HexUtils.key(d.hex), d.type]));
      tickCounterRef.current += 1;
      const result = simulateTick(units, groupOrdersRef.current, {
        damagePerTick: DAMAGE_PER_TICK,
        currentTick: tickCounterRef.current,
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
          isBarrier: (h: Hex) => terrainAt.get(HexUtils.key(h)) === 'RIVER',
        },
      });
      // Spawn javelin sprites for any ranged attacks this tick. Each sprite tweens from
      // attacker hex to target hex over ~250ms (sub-tick) and self-destroys onComplete.
      const javelinTex = javelinTextureRef.current;
      if (javelinTex && result.projectiles.length > 0) {
        // Asset orientation: javelin tip in the upper-left of the image, butt in the
        // lower-right. The vector from butt→tip in image pixels is roughly (-1610, -670)
        // (the asset is 1813×822 with the diagonal javelin). Pre-compute the angle of
        // that vector once so the sprite's natural tip-direction is known; the throw
        // rotation is then `throwAngle - assetTipAngle` to point the tip at the target.
        const assetTipAngle = Math.atan2(-670, -1610);
        const container = projectilesGfx.current;
        for (const p of result.projectiles) {
          const fromPx = HexUtils.hexToPixel(p.fromHex);
          const toPx = HexUtils.hexToPixel(p.toHex);
          const dxp = toPx.x - fromPx.x;
          const dyp = toPx.y - fromPx.y;
          const sprite = new PIXI.Sprite(javelinTex);
          sprite.anchor.set(0.5, 0.5);
          // Scale to a hex-appropriate length (~50 px = a bit more than one hex).
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
  const selectedUnitTypeRef = useRef<UnitType>('infantry');
  const groupOrdersRef = useRef<GroupOrders>(new Map());
  const groupFormationsRef = useRef<GroupFormations>(new Map());
  const groupDepthsRef = useRef<GroupDepths>(new Map());
  const armiesRef = useRef<Armies>(new Map());
  const orderDragRef = useRef<OrderDrag | null>(null);
  const defendDragRef = useRef<DefendDrag | null>(null);
  const gridDataRef = useRef<{ hex: Hex; type: string }[]>([]);
  const isBattleRunningRef = useRef(false);
  const fogOfWarRef = useRef(false);
  useEffect(() => {
    inputModeRef.current = inputMode;
    if (inputMode !== 'order') {
      orderDragRef.current = null;
    }
    if (inputMode !== 'defend') {
      defendDragRef.current = null;
    }
    if (inputMode !== 'order' && inputMode !== 'defend') {
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
  useEffect(() => { armiesRef.current = armies; }, [armies]);
  useEffect(() => { gridDataRef.current = gridData; }, [gridData]);
  useEffect(() => { isBattleRunningRef.current = isBattleRunning; }, [isBattleRunning]);
  useEffect(() => { fogOfWarRef.current = fogOfWar; }, [fogOfWar]);
  /* eslint-enable react-hooks/immutability */

  // Shared toggle for CHARGE / RETREAT / UNLEASH shortcuts and HUD buttons. Toggling the
  // active mode reverts the group to 'march'; CHARGE additionally arms / clears the
  // duration counter so re-entering charge starts a fresh window. DefendHeight is NOT
  // handled here — it uses an input-mode gesture flow (see toggleDefend).
  const toggleMode = useCallback((mode: Exclude<OrderMode, 'march' | 'defendHeight'>) => {
    const gid = selectedGroupRef.current;
    const team = selectedTeamRef.current;
    const key = groupOrderKey(team, gid);

    setGroupOrders(prev => {
      const cur = prev.get(key);
      if (!cur?.attackTarget) return prev;
      const isActive = (cur.mode ?? 'march') === mode;
      const nextOrder: GroupOrder = isActive
        ? { ...cur, mode: 'march', chargeTicksRemaining: undefined, chargeDamagedIds: undefined }
        : {
            ...cur,
            mode,
            chargeTicksRemaining: mode === 'charge' ? CHARGE_DURATION_TICKS : undefined,
            chargeDamagedIds: undefined,
          };
      const next = new Map(prev);
      next.set(key, nextOrder);
      return next;
    });
  }, []);

  // Three-state toggle for DEFEND:
  //   1. Order already in defendHeight → click cancels (revert to march, clear sticky fields).
  //   2. Already in 'defend' input mode (no order yet) → click exits input mode.
  //   3. Otherwise → enter 'defend' input mode so the next canvas gesture (double-click or
  //      drag) specifies what to defend.
  // Requires an active attack order to enter the mode in the first place.
  const toggleDefend = useCallback(() => {
    const gid = selectedGroupRef.current;
    const team = selectedTeamRef.current;
    const key = groupOrderKey(team, gid);
    const cur = groupOrdersRef.current.get(key);
    const isDefending = (cur?.mode ?? 'march') === 'defendHeight';

    if (isDefending) {
      setGroupOrders(prev => {
        const c = prev.get(key);
        if (!c?.attackTarget) return prev;
        const next = new Map(prev);
        next.set(key, { ...c, mode: 'march', defendTerrain: undefined, defendFrom: undefined, defendAnchor: undefined, defendAssignments: undefined });
        return next;
      });
      return;
    }

    if (inputModeRef.current === 'defend') {
      setInputMode(null);
      return;
    }

    if (!cur?.attackTarget) return;
    setInputMode('defend');
    setIsScanning(false);
  }, []);

  // Order-related shortcuts for the currently selected group. Layout — top row:
  //   T Q W E R  →  Assign / Attack / Hold / Charge / Unleash
  // Bottom row:
  //   A S D F V  →  Mirror direction / Defend / Cycle formation / Retreat / Cycle depth
  // All TACTICAL-only; ignored while typing in inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!'tqwerasdfv'.includes(k)) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (viewMode !== 'TACTICAL') return;
      const gid = selectedGroupRef.current;
      const team = selectedTeamRef.current;
      const key = groupOrderKey(team, gid);

      if (k === 't') {
        // Assign mode toggle. Doesn't require an order; lets you reassign existing
        // units to this group with a brush paint on the canvas.
        setInputMode(prev => (prev === 'assign' ? null : 'assign'));
        setIsScanning(false);
      } else if (k === 'q') {
        // Attack mode: needs at least one unit in the selected group.
        const hex = currentStrategicHexRef.current;
        const units = hex ? armiesRef.current.get(HexUtils.key(hex)) ?? [] : [];
        const count = units.filter(u => u.team === team && u.groupId === gid).length;
        if (count === 0) return;
        setInputMode(prev => (prev === 'order' ? null : 'order'));
        setIsScanning(false);
      } else if (k === 'w') {
        // Hold toggle on active order.
        setGroupOrders(prev => {
          const cur = prev.get(key);
          if (!cur?.attackTarget) return prev;
          const next = new Map(prev);
          next.set(key, { ...cur, hold: !cur.hold });
          return next;
        });
      } else if (k === 'e') {
        toggleMode('charge');
      } else if (k === 'r') {
        toggleMode('unleash');
      } else if (k === 'a') {
        // Mirror march heading horizontally: NE↔NW, SE↔SW, E↔W. No-op if no active order.
        setGroupOrders(prev => {
          const cur = prev.get(key);
          if (!cur?.attackTarget) return prev;
          const next = new Map(prev);
          next.set(key, { ...cur, heading: (3 - cur.heading + 6) % 6 });
          return next;
        });
      } else if (k === 's') {
        toggleDefend();
      } else if (k === 'd') {
        // Cycle formation through FORMATION_CYCLE. Defaults to 'line' if unset.
        setGroupFormations(prev => {
          const cur = prev.get(key) ?? 'line';
          const idx = FORMATION_CYCLE.indexOf(cur);
          const nextFormation = FORMATION_CYCLE[(idx + 1) % FORMATION_CYCLE.length];
          const next = new Map(prev);
          next.set(key, nextFormation);
          return next;
        });
      } else if (k === 'f') {
        toggleMode('retreat');
      } else if (k === 'v') {
        // Cycle depth through DEPTH_CYCLE. Defaults to 1 if unset.
        setGroupDepths(prev => {
          const cur = prev.get(key) ?? 1;
          const idx = DEPTH_CYCLE.indexOf(cur);
          const nextDepth = DEPTH_CYCLE[(idx + 1) % DEPTH_CYCLE.length];
          const next = new Map(prev);
          next.set(key, nextDepth);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, toggleMode, toggleDefend]);

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
        const samePlacing = inputModeRef.current === 'place' && selectedUnitTypeRef.current === type;
        setSelectedUnitType(type);
        setInputMode(samePlacing ? null : 'place');
        setIsScanning(false);
      };
      if (e.key === 'z' || e.key === 'Z') { setPlacementType('infantry'); return; }
      if (e.key === 'x' || e.key === 'X') { setPlacementType('cavalry'); return; }
      if (e.key === 'c' || e.key === 'C') { setPlacementType('skirmisher'); return; }
      // Backspace → kill every unit in the currently selected team+group on this
      // strategic hex, and clear the group's order (no phantom lieutenant marker or
      // attack-target ring lingers).
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
        setGroupOrders(prev => {
          const k = groupOrderKey(team, gid);
          if (!prev.has(k)) return prev;
          const next = new Map(prev);
          next.delete(k);
          return next;
        });
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode]);

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
      if (u.team === selectedTeam) {
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

        {/* Placement row: INFANTRY (Z), CAVALRY (X), SKIRMISHER (C). The active button
            is the one whose unitType matches selectedUnitType, but ONLY while inputMode
            === 'place'. Click toggles place-mode for that type; clicking another type
            while already placing swaps without exiting. */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {(['infantry', 'cavalry', 'skirmisher'] as const).map(type => {
            const samePlacing = isPlacing && selectedUnitType === type;
            const disabled = viewMode !== 'TACTICAL';
            const keyHint = type === 'infantry' ? '(Z)' : type === 'cavalry' ? '(X)' : '(C)';
            const label = type === 'infantry' ? 'INFANTRY' : type === 'cavalry' ? 'CAVALRY' : 'SKIRMISH';
            return (
              <button
                key={type}
                onClick={() => {
                  if (viewMode !== 'TACTICAL') return;
                  setSelectedUnitType(type);
                  setInputMode(samePlacing ? null : 'place');
                  if (!samePlacing) setIsScanning(false);
                }}
                disabled={disabled}
                title={disabled ? 'Dive into a tactical view first' : `Place ${type}`}
                style={{
                  flex: 1,
                  padding: '14px 6px',
                  background: disabled
                    ? 'rgba(255,255,255,0.04)'
                    : samePlacing ? '#ef4444' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: disabled ? '#475569' : 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '1px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: '0.2s',
                }}
              >
                {samePlacing ? `STOP ${keyHint}` : `${label} ${keyHint}`}
              </button>
            );
          })}
        </div>

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
          <button
            onClick={() => setFogOfWar(f => !f)}
            style={{ width: '100%', padding: '12px', background: fogOfWar ? '#10b981' : 'rgba(59, 130, 246, 0.1)', color: fogOfWar ? 'white' : '#60a5fa', border: fogOfWar ? 'none' : '1px solid rgba(59, 130, 246, 0.5)', borderRadius: '12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', marginBottom: '12px', transition: '0.2s' }}
          >
            FOG OF WAR: {fogOfWar ? 'ACTIVE' : 'DEACTIVATED'}
          </button>
        )}

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
              const isSelectedRow = selectedGroup === gid;
              const assignActive = inputMode === 'assign' && selectedGroup === gid;
              const orderActive = inputMode === 'order' && selectedGroup === gid;
              const teamColor = TEAM_TINTS[selectedTeam];
              const teamColorHex = `#${teamColor.toString(16).padStart(6, '0')}`;
              const formationKey = groupOrderKey(selectedTeam, gid);
              const formation: FormationType = groupFormations.get(formationKey) ?? 'line';
              const formationIsDefault = formation === 'line';
              const depth = groupDepths.get(formationKey) ?? 1;
              const depthIsDefault = depth === 1;
              const order = groupOrders.get(formationKey);
              const holdActive = !!order?.hold;
              const canHold = !!order?.attackTarget;
              const orderMode: OrderMode = order?.mode ?? 'march';
              const chargeActive = orderMode === 'charge';
              const retreatActive = orderMode === 'retreat';
              const unleashActive = orderMode === 'unleash';
              const defendActive = orderMode === 'defendHeight';
              const defendInputActive = inputMode === 'defend' && selectedGroup === gid;
              const defendShown = defendActive || defendInputActive;
              const chargeRemaining = order?.chargeTicksRemaining;
              // AOE-style two-row layout. Each row mirrors a keyboard row so the buttons
              // sit under the keys that activate them:
              //   Row 1 (QWERT-ish):  [G] [T-ASSIGN] [Q-ATTACK] [W-HOLD] [E-CHARGE] [R-UNLEASH]
              //   Row 2 (ASDFV):              [A-MIRROR] [S-DEFEND] [D-FORM] [F-RETREAT] [V-DEPTH]
              const rowStyle: React.CSSProperties = {
                display: 'flex', alignItems: 'center', gap: '6px',
              };
              const btnBase: React.CSSProperties = {
                flex: 1, padding: '6px 4px', fontSize: '10px', fontWeight: 800,
                borderRadius: '8px', letterSpacing: '0.5px',
              };
              return (
                <div key={gid} style={{
                  marginBottom: '6px',
                  padding: '4px 6px',
                  borderLeft: isSelectedRow ? `3px solid ${teamColorHex}` : '3px solid transparent',
                  background: isSelectedRow ? `${teamColorHex}14` : 'transparent',
                  borderRadius: '6px',
                  transition: 'background 120ms, border-color 120ms',
                }}>
                  {/* Row 1 ──────── G  T  Q  W  E  R ──────── */}
                  <div style={{ ...rowStyle, marginBottom: '4px' }}>
                    <button
                      onClick={() => setSelectedGroup(gid)}
                      title={`Select G${gid} (shortcut: ${gid})`}
                      style={{
                        flex: '0 0 48px', padding: 0, background: 'transparent', border: 'none',
                        textAlign: 'left', fontSize: '11px', fontWeight: 800,
                        color: isSelectedRow ? teamColorHex : '#cbd5e1',
                        cursor: 'pointer',
                      }}
                    >
                      G{gid} <span style={{ color: '#64748b', fontWeight: 600 }}>×{count}</span>
                    </button>
                    {/* Q — ATTACK (enter order mode) */}
                    <button
                      disabled={count === 0}
                      title="Attack (shortcut: Q)"
                      onClick={() => {
                        setSelectedGroup(gid);
                        setInputMode(prev => (prev === 'order' && selectedGroup === gid) ? null : 'order');
                        setIsScanning(false);
                      }}
                      style={{
                        ...btnBase,
                        background: orderActive ? teamColorHex : 'rgba(255,255,255,0.04)',
                        color: count === 0 ? '#475569' : orderActive ? 'white' : '#94a3b8',
                        border: orderActive ? `1px solid ${teamColorHex}` : '1px solid rgba(255,255,255,0.1)',
                        cursor: count === 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      ATTACK (Q)
                    </button>
                    {/* W — HOLD */}
                    <button
                      disabled={!canHold}
                      title={canHold ? (holdActive ? 'Hold active — block will not march (shortcut: W)' : 'Hold block in place (shortcut: W)') : 'No active order to hold'}
                      onClick={() => {
                        if (!canHold) return;
                        setGroupOrders(prev => {
                          const next = new Map(prev);
                          const cur = next.get(formationKey);
                          if (cur) next.set(formationKey, { ...cur, hold: !cur.hold });
                          return next;
                        });
                      }}
                      style={{
                        ...btnBase,
                        background: holdActive ? '#f59e0b' : 'rgba(255,255,255,0.04)',
                        color: !canHold ? '#475569' : holdActive ? 'white' : '#94a3b8',
                        border: holdActive ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canHold ? 'not-allowed' : 'pointer',
                        opacity: !canHold ? 0.5 : 1,
                      }}
                    >
                      HOLD (W)
                    </button>
                    {/* E — CHARGE */}
                    <button
                      disabled={!canHold}
                      title={canHold ? (chargeActive ? `Charge active${chargeRemaining != null ? ` (${chargeRemaining} ticks left)` : ''} — click to cancel (shortcut: E)` : 'Charge: 2 hexes/tick, lance damage, 1.5s burst (shortcut: E)') : 'No active order'}
                      onClick={() => { if (canHold) toggleMode('charge'); }}
                      style={{
                        ...btnBase,
                        background: chargeActive ? '#dc2626' : 'rgba(255,255,255,0.04)',
                        color: !canHold ? '#475569' : chargeActive ? 'white' : '#94a3b8',
                        border: chargeActive ? '1px solid #dc2626' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canHold ? 'not-allowed' : 'pointer',
                        opacity: !canHold ? 0.5 : 1,
                      }}
                    >
                      {chargeActive && chargeRemaining != null ? `CHG ${chargeRemaining} (E)` : 'CHARGE (E)'}
                    </button>
                    {/* R — UNLEASH */}
                    <button
                      disabled={!canHold}
                      title={canHold ? (unleashActive ? 'Unleashed — units chase nearest enemy (shortcut: R)' : 'Unleash: break formation, each unit hunts nearest enemy (shortcut: R)') : 'No active order'}
                      onClick={() => { if (canHold) toggleMode('unleash'); }}
                      style={{
                        ...btnBase,
                        background: unleashActive ? '#a855f7' : 'rgba(255,255,255,0.04)',
                        color: !canHold ? '#475569' : unleashActive ? 'white' : '#94a3b8',
                        border: unleashActive ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canHold ? 'not-allowed' : 'pointer',
                        opacity: !canHold ? 0.5 : 1,
                      }}
                    >
                      UNLEASH (R)
                    </button>
                    {/* T — ASSIGN. Sits right of UNLEASH so the row reads Q W E R T,
                        matching the keyboard. Available regardless of order state. */}
                    <button
                      title="Assign units to this group (shortcut: T)"
                      onClick={() => {
                        setSelectedGroup(gid);
                        setInputMode(prev => (prev === 'assign' && selectedGroup === gid) ? null : 'assign');
                        setIsScanning(false);
                      }}
                      style={{
                        ...btnBase,
                        background: assignActive ? teamColorHex : 'rgba(255,255,255,0.04)',
                        color: assignActive ? 'white' : '#94a3b8',
                        border: assignActive ? `1px solid ${teamColorHex}` : '1px solid rgba(255,255,255,0.1)',
                        cursor: 'pointer',
                      }}
                    >
                      ASSIGN (T)
                    </button>
                  </div>
                  {/* Row 2 ──────── A  S  D  F  V ──────── */}
                  <div style={{ ...rowStyle, paddingLeft: '54px' /* aligns under the QWER cluster, past the G label */ }}>
                    {/* A — MIRROR heading. Button face shows the arrow we'd flip TO. */}
                    <button
                      disabled={!canHold}
                      title={canHold
                        ? `Mirror march heading ${HEADING_ARROWS[order?.heading ?? 0]} → ${HEADING_ARROWS[(3 - (order?.heading ?? 0) + 6) % 6]} (shortcut: A)`
                        : 'No active order'}
                      onClick={() => {
                        if (!canHold) return;
                        setGroupOrders(prev => {
                          const cur = prev.get(formationKey);
                          if (!cur?.attackTarget) return prev;
                          const next = new Map(prev);
                          next.set(formationKey, { ...cur, heading: (3 - cur.heading + 6) % 6 });
                          return next;
                        });
                      }}
                      style={{
                        ...btnBase, fontSize: '12px',
                        background: 'rgba(255,255,255,0.04)',
                        color: !canHold ? '#475569' : '#facc15',
                        border: '1px solid rgba(255,255,255,0.1)',
                        cursor: !canHold ? 'not-allowed' : 'pointer',
                        opacity: !canHold ? 0.5 : 1,
                      }}
                    >
                      {HEADING_ARROWS[(3 - (order?.heading ?? 0) + 6) % 6]} (A)
                    </button>
                    {/* S — DEFEND */}
                    <button
                      disabled={!canHold}
                      title={canHold
                        ? (defendActive
                            ? `Defending ${order?.defendTerrain ?? 'terrain'}${order?.defendFrom ? ` from ${order.defendFrom}` : ''} — click to cancel (shortcut: S)`
                            : defendInputActive
                              ? 'Defend mode active: double-click a hex (omnidirectional) or drag terrain→threat. Click again to cancel. (shortcut: S)'
                              : 'Defend: enter defend mode, then double-click a hex, or drag from your terrain to the threat terrain (shortcut: S)')
                        : 'No active order'}
                      onClick={() => { if (canHold) toggleDefend(); }}
                      style={{
                        ...btnBase,
                        background: defendShown ? '#16a34a' : 'rgba(255,255,255,0.04)',
                        color: !canHold ? '#475569' : defendShown ? 'white' : '#94a3b8',
                        border: defendShown ? '1px solid #16a34a' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canHold ? 'not-allowed' : 'pointer',
                        opacity: !canHold ? 0.5 : 1,
                      }}
                    >
                      {defendInputActive && !defendActive ? 'DEF? (S)' : 'DEFEND (S)'}
                    </button>
                    {/* D — Cycle formation */}
                    <button
                      disabled={isBattleRunning}
                      title={isBattleRunning ? 'Formation locked during battle' : `Formation: ${formation} (click to cycle, shortcut: D)`}
                      onClick={() => {
                        setGroupFormations(prev => {
                          const next = new Map(prev);
                          const cur = next.get(formationKey) ?? 'line';
                          const idx = FORMATION_CYCLE.indexOf(cur);
                          next.set(formationKey, FORMATION_CYCLE[(idx + 1) % FORMATION_CYCLE.length]);
                          return next;
                        });
                      }}
                      style={{
                        ...btnBase,
                        background: isBattleRunning ? 'rgba(255,255,255,0.02)' : formationIsDefault ? 'rgba(255,255,255,0.04)' : 'rgba(148,163,184,0.18)',
                        color: isBattleRunning ? '#475569' : formationIsDefault ? '#94a3b8' : '#e2e8f0',
                        border: '1px solid rgba(255,255,255,0.1)',
                        cursor: isBattleRunning ? 'not-allowed' : 'pointer',
                        opacity: isBattleRunning ? 0.5 : 1,
                      }}
                    >
                      {FORMATION_LABELS[formation]} (D)
                    </button>
                    {/* F — RETREAT */}
                    <button
                      disabled={!canHold}
                      title={canHold ? (retreatActive ? 'Retreat active — falling back (shortcut: F)' : 'Retreat: march backwards, disengage from combat (shortcut: F)') : 'No active order to retreat'}
                      onClick={() => { if (canHold) toggleMode('retreat'); }}
                      style={{
                        ...btnBase,
                        background: retreatActive ? '#3b82f6' : 'rgba(255,255,255,0.04)',
                        color: !canHold ? '#475569' : retreatActive ? 'white' : '#94a3b8',
                        border: retreatActive ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canHold ? 'not-allowed' : 'pointer',
                        opacity: !canHold ? 0.5 : 1,
                      }}
                    >
                      RETREAT (F)
                    </button>
                    {/* V — Cycle depth */}
                    <button
                      disabled={isBattleRunning}
                      title={isBattleRunning ? 'Depth locked during battle' : `Depth: ${depth} (click to cycle, shortcut: V)`}
                      onClick={() => {
                        setGroupDepths(prev => {
                          const next = new Map(prev);
                          const cur = next.get(formationKey) ?? 1;
                          const idx = DEPTH_CYCLE.indexOf(cur);
                          next.set(formationKey, DEPTH_CYCLE[(idx + 1) % DEPTH_CYCLE.length]);
                          return next;
                        });
                      }}
                      style={{
                        ...btnBase,
                        background: isBattleRunning ? 'rgba(255,255,255,0.02)' : depthIsDefault ? 'rgba(255,255,255,0.04)' : 'rgba(148,163,184,0.18)',
                        color: isBattleRunning ? '#475569' : depthIsDefault ? '#94a3b8' : '#e2e8f0',
                        border: '1px solid rgba(255,255,255,0.1)',
                        cursor: isBattleRunning ? 'not-allowed' : 'pointer',
                        opacity: isBattleRunning ? 0.5 : 1,
                      }}
                    >
                      D{depth} (V)
                    </button>
                  </div>
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
            setIsBattleRunning(false);
            setGroupOrders(new Map());
            setGroupFormations(new Map());
            setGroupDepths(new Map());
            setWinBanner(null);
            lastTickHadBothTeamsRef.current = false;
            tickCounterRef.current = 0;
          }}
          style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', marginBottom: '32px' }}
        >RETURN TO STRATEGIC OVERVIEW</button>

        <button onClick={() => {
          noiseRef.current = null;
          setArmies(new Map());
          setCurrentStrategicHex(null);
          setInputMode(null);
          setIsBattleRunning(false);
          setGroupOrders(new Map());
          setGroupFormations(new Map());
          setGroupDepths(new Map());
          setWinBanner(null);
          lastTickHadBothTeamsRef.current = false;
          tickCounterRef.current = 0;
          generateWorldData();
        }} style={{ width: '100%', padding: '20px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '16px', fontSize: '14px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)' }}>
          REGENERATE ECOSYSTEM
        </button>
      </div>
    </div>
  );
};
