/**
 * Headless harness for the rigid-block formation simulation. Drives `simulateTick` through
 * canned scenarios that exercise: instant deploy snap, clear march, march blocked by wall,
 * march paused by combat. Prints per-tick ASCII grids and reports outcomes.
 *
 * Run with: npm run sim
 */

import {
  simulateTick, groupHeading, computeFormationPreview, computeOrderedSlotAssignments,
  CHARGE_DURATION_TICKS,
} from '../src/battle/simulate';
import type {
  Unit, GroupOrder, OrderMode, Team, GroupId, FormationType, SimulationConfig, MapApi,
} from '../src/battle/simulate';
import { getTerrainMods } from '../src/battle/terrain';
import { HexUtils, type Hex } from '../src/hex-engine/HexUtils';

const groupOrderKey = (team: Team, groupId: GroupId): string => `${team}:${groupId}`;
const id = (n: number): string => `u${String(n).padStart(2, '0')}`;

/** 7-hex HILL blob: center (0,0) plus its 6 axial neighbors. Everything else = GRASSLAND. */
const HILL_BLOB: Hex[] = [{ q: 0, r: 0 }, ...HexUtils.getNeighbors({ q: 0, r: 0 })];
const HILL_TERRAIN = new Map(HILL_BLOB.map(h => [HexUtils.key(h), 'HILL']));

/**
 * Same 7-hex HILL blob, with RIVERs on the E and W flanks at (2,0) and (-2,0). The
 * river-flanked HILL borders are (1,0) (touches (2,0) RIVER) and (-1,0) (touches
 * (-2,0) RIVER). These segment the perimeter:
 *   - SOUTH arc: (-1,1) SW, (0,1) SE, plus terminators (1,0) and (-1,0)
 *   - NORTH arc: (0,-1) NW, (1,-1) NE, plus the same terminators
 * Anchor on the south side should yield the SOUTH arc; anchor on the north side, the
 * NORTH arc. Used to verify river-segment defense.
 */
const HILL_BLOB_WITH_RIVERS = new Map<string, string>(HILL_TERRAIN);
HILL_BLOB_WITH_RIVERS.set(HexUtils.key({ q: 2, r: 0 }), 'RIVER');
HILL_BLOB_WITH_RIVERS.set(HexUtils.key({ q: -2, r: 0 }), 'RIVER');

/**
 * Radius-2 RIDGELINE blob — 19 hexes total: center + ring-1 (6 hexes) + ring-2 (12).
 * This is the realistic test size for multi-rank defense: ring-2 is the 12-hex front
 * (rank 0), ring-1 is rank 1 (6 hexes), center is rank 2 (1 hex). Surrounding hexes
 * are tagged THICKET — the player's "thicket" terminology for the lowland attackers
 * approach through. Both terrains are walkable.
 */
const RIDGELINE_BLOB: Hex[] = (() => {
  const out: Hex[] = [{ q: 0, r: 0 }];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= 2 && (q !== 0 || r !== 0)) {
        out.push({ q, r });
      }
    }
  }
  return out;
})();
const RIDGELINE_TERRAIN = new Map<string, string>(
  RIDGELINE_BLOB.map(h => [HexUtils.key(h), 'RIDGELINE'] as [string, string]),
);
// Tag a band of THICKET hexes south of the ridgeline. Range r=[2,6] so the SE/SW
// ring-2 borders (whose southern neighbors are at r=2) also count as "south-facing"
// when defendFrom='THICKET' narrows the segment.
for (let q = -6; q <= 6; q++) {
  for (let r = 2; r <= 6; r++) {
    const key = HexUtils.key({ q, r });
    if (RIDGELINE_TERRAIN.has(key)) continue; // skip blob hexes
    RIDGELINE_TERRAIN.set(key, 'THICKET');
  }
}

/**
 * Same RIDGELINE blob, but with a RIVER finger entering from the south-east at
 * (3,-1), (3,0), and from the south-west at (-3,1), (-3,2). These river-flanked
 * borders cut the perimeter — defending from the south arc should ignore the
 * north arc.
 */
const RIDGELINE_WITH_RIVERS = new Map<string, string>(RIDGELINE_TERRAIN);
RIDGELINE_WITH_RIVERS.set(HexUtils.key({ q: 3, r: 0 }), 'RIVER');
RIDGELINE_WITH_RIVERS.set(HexUtils.key({ q: -3, r: 2 }), 'RIVER');

/**
 * Same HILL blob, but with FOREST on the east side and SAND on the west side. Used to
 * verify the directional `defendFrom` filter — defendFrom='FOREST' should pull units to
 * the east-facing borders only.
 *
 * East FOREST hexes (neighbors of E/NE/SE HILL borders):  (2,0), (2,-1), (1,1)
 * West SAND hexes (neighbors of W/SW/NW HILL borders):  (-2,0), (-2,1), (-1,-1)
 */
const HILL_DIRECTIONAL_TERRAIN = new Map<string, string>(HILL_TERRAIN);
HILL_DIRECTIONAL_TERRAIN.set(HexUtils.key({ q: 2, r: 0 }), 'FOREST');
HILL_DIRECTIONAL_TERRAIN.set(HexUtils.key({ q: 2, r: -1 }), 'FOREST');
HILL_DIRECTIONAL_TERRAIN.set(HexUtils.key({ q: 1, r: 1 }), 'FOREST');
HILL_DIRECTIONAL_TERRAIN.set(HexUtils.key({ q: -2, r: 0 }), 'SAND');
HILL_DIRECTIONAL_TERRAIN.set(HexUtils.key({ q: -2, r: 1 }), 'SAND');
HILL_DIRECTIONAL_TERRAIN.set(HexUtils.key({ q: -1, r: -1 }), 'SAND');

interface ScenarioUnit {
  id: string;
  team: Team;
  groupId: GroupId;
  hex: Hex;
  hp?: number;
}

interface Scenario {
  name: string;
  units: ScenarioUnit[];
  attackTarget: Hex;
  team: Team;
  groupId: GroupId;
  formation: FormationType;
  depth: number;
  maxTicks: number;
  /** Hexes blocked from walking (water, walls, etc.). Empty = all walkable. */
  unwalkable?: Hex[];
  /** Motion mode override; undefined = 'march'. */
  mode?: OrderMode;
  /** Override the heading auto-derived from group centroid → target. */
  forceHeading?: number;
  /** Terrain key per hex for the 'defendHeight' mode. Hexes not listed are treated as
   *  'GRASSLAND' (a walkable default). All terrains here are also walkable. */
  terrainAt?: Map<string, string>;
  /** Sticky 'defendTerrain' for 'defendHeight' — captured at toggle time in the live
   *  game; supplied directly here. */
  defendTerrain?: string;
  /** Sticky 'defendFrom' for directional defendHeight — filters borders to those
   *  adjacent to this terrain only. */
  defendFrom?: string;
  /** Anchor hex for defendHeight segment selection. Borders are BFS-restricted to the
   *  segment containing the border nearest this anchor. */
  defendAnchor?: Hex;
}

const seedUnit = (s: ScenarioUnit, terrainAt?: Map<string, string>): Unit => ({
  id: s.id,
  team: s.team,
  tacticalHex: s.hex,
  homeHex: s.hex,
  groupId: s.groupId,
  hp: s.hp ?? 100,
  state: 'idle',
  nextMoveTick: 0,
  // Derive starting visionRadius from the unit's placement terrain (falling through
  // to DEFAULT_TERRAIN_MODS when no terrain info is provided). Same contract as the
  // in-UI placement path so scenarios can read realistic tick-0 vision.
  visionRadius: getTerrainMods(terrainAt?.get(HexUtils.key(s.hex))).visionRadius,
});

// Heights for terrains the harness uses. Mirrors `TERRAINS[type].height` in
// GameCanvas.tsx for shared keys; THICKET and RIDGELINE are harness-only fictions
// (used only by the defendHeight scenarios) and need plausible elevations so the
// damage step's `getTerrainHeight` returns something sane on those hexes.
const HARNESS_HEIGHTS: Record<string, number> = {
  SAND: 8,
  GRASSLAND: 12,
  FOREST: 18,
  HILL: 35,
  ROCKY: 55,
  RIVER: 10,
  THICKET: 18,    // sim-only, treated like FOREST
  RIDGELINE: 35,  // sim-only, treated like HILL
};

const rowAt = (n: number, westQ: number, r: number, team: Team, groupId: GroupId): ScenarioUnit[] =>
  Array.from({ length: n }, (_, i) => ({
    id: id(i + 1),
    team,
    groupId,
    hex: { q: westQ + i, r },
  }));

const scenarios: Scenario[] = [
  {
    // Deploy snap: 8 units scattered, deploy LINE at target. After snap (before any ticks),
    // every red unit should be at its slot. simulateTick isn't needed for this — verified by
    // inspection of computeOrderedSlotAssignments output below.
    name: 'deploy-snap-line',
    units: rowAt(8, -8, 0, 'red', 1),
    attackTarget: { q: 0, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 1,
  },
  {
    // March east: 8 units pre-positioned in LINE formation at target (after snap), block
    // marches west-to-east toward q=8. Expect block centroid to reach target around tick 8.
    name: 'march-east-clear',
    units: rowAt(1, 0, -3, 'red', 1).concat(
      rowAt(1, 0, -2, 'red', 1).map(u => ({ ...u, id: id(2) })),
      rowAt(1, 0, -1, 'red', 1).map(u => ({ ...u, id: id(3) })),
      rowAt(1, 0, 0, 'red', 1).map(u => ({ ...u, id: id(4) })),
      rowAt(1, 0, 1, 'red', 1).map(u => ({ ...u, id: id(5) })),
      rowAt(1, 0, 2, 'red', 1).map(u => ({ ...u, id: id(6) })),
    ),
    attackTarget: { q: 8, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 15,
  },
  {
    // Block hits a wall at q=4 and holds. Block should advance 3 hexes east (to q=3) then
    // stop because q=4 is unwalkable.
    name: 'march-blocked-by-wall',
    units: rowAt(1, 0, -1, 'red', 1).concat(
      rowAt(1, 0, 0, 'red', 1).map(u => ({ ...u, id: id(2) })),
      rowAt(1, 0, 1, 'red', 1).map(u => ({ ...u, id: id(3) })),
    ),
    attackTarget: { q: 8, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 10,
    unwalkable: [
      { q: 4, r: -1 }, { q: 4, r: 0 }, { q: 4, r: 1 },
    ],
  },
  {
    // Block adjacent to enemy on tick 0: combat starts, block does not advance because a
    // unit is fighting.
    name: 'march-stops-on-combat',
    units: [
      ...rowAt(3, 0, 0, 'red', 1).map((u, i) => ({ ...u, id: id(i + 1) })),
      { id: 'enemy', team: 'blue' as Team, groupId: 1 as GroupId, hex: { q: 3, r: 0 } },
    ],
    attackTarget: { q: 8, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 5,
  },
  {
    // Block marches indefinitely in heading direction with no obstacles. Should advance
    // 20 hexes east over 20 ticks. Verifies there's no spurious arrival check.
    name: 'march-forever-clear',
    units: rowAt(1, 0, -1, 'red', 1).concat(
      rowAt(1, 0, 0, 'red', 1).map(u => ({ ...u, id: id(2) })),
      rowAt(1, 0, 1, 'red', 1).map(u => ({ ...u, id: id(3) })),
    ),
    attackTarget: { q: 100, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 20,
  },
  {
    // CHARGE across open ground: 3 reds in a column charge east. Should advance
    // CHARGE_SPEED_HEXES (2) hexes per tick for CHARGE_DURATION_TICKS (3) ticks = 6 hexes,
    // then auto-revert to march for the remaining 7 ticks (7 more hexes) = 13 total.
    name: 'charge-clear',
    units: rowAt(1, 0, -1, 'red', 1).concat(
      rowAt(1, 0, 0, 'red', 1).map(u => ({ ...u, id: id(2) })),
      rowAt(1, 0, 1, 'red', 1).map(u => ({ ...u, id: id(3) })),
    ),
    attackTarget: { q: 100, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 10,
    mode: 'charge',
  },
  {
    // RETREAT disengages from combat: red block adjacent to blue, mode='retreat'.
    // Expect reds back off west despite being in 'fighting' state. Heading is east
    // (toward attackTarget), retreat uses opposite direction → block moves west each tick.
    name: 'retreat-disengage',
    units: [
      ...rowAt(3, 0, 0, 'red', 1).map((u, i) => ({ ...u, id: id(i + 1) })),
      { id: 'enemy', team: 'blue' as Team, groupId: 1 as GroupId, hex: { q: 3, r: 0 } },
    ],
    attackTarget: { q: 8, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 5,
    mode: 'retreat',
    forceHeading: 0, // east, so retreat = west
  },
  {
    // CHARGE impact applies AT MOST ONCE per enemy per charge. 1 red charges past
    // 4 stationary blues spaced 1 hex apart. Without the one-shot lance rule the rear
    // blues would be re-lanced as the red closes in. With it, each blue in lance
    // range takes exactly CHARGE_IMPACT_DAMAGE=10 → hp 100 → 90 (+ melee on b1).
    name: 'charge-impact-once',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },
      { id: 'b1', team: 'blue', groupId: 2, hex: { q: 3, r: 0 } },
      { id: 'b2', team: 'blue', groupId: 2, hex: { q: 4, r: 0 } },
      { id: 'b3', team: 'blue', groupId: 2, hex: { q: 5, r: 0 } },
      { id: 'b4', team: 'blue', groupId: 2, hex: { q: 6, r: 0 } },
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 3,
    mode: 'charge',
    forceHeading: 0,
  },
  {
    // UNLEASH greedy: 3 reds in a column, single blue 6 hexes east. Reds break column
    // and converge on the blue. Each tick each red picks its best neighbor toward target.
    name: 'unleash-greedy',
    units: [
      ...rowAt(1, 0, -1, 'red', 1).map(u => ({ ...u, id: id(1) })),
      ...rowAt(1, 0, 0, 'red', 1).map(u => ({ ...u, id: id(2) })),
      ...rowAt(1, 0, 1, 'red', 1).map(u => ({ ...u, id: id(3) })),
      { id: 'enemy', team: 'blue' as Team, groupId: 1 as GroupId, hex: { q: 6, r: 0 }, hp: 999 },
    ],
    attackTarget: { q: 6, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 8,
    mode: 'unleash',
  },
  {
    // UNLEASH target-spread: 6 reds clustered together, 2 isolated blue enemies at
    // different locations. With UNLEASH_MAX_ENGAGERS=3, expect ~3 reds engage each blue
    // rather than 6 dogpiling one and 0 on the other. Blues at hp=999 so they survive
    // through the test.
    name: 'unleash-target-spread',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: -1 } },
      { id: id(2), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },
      { id: id(3), team: 'red', groupId: 1, hex: { q: 0, r: 1 } },
      { id: id(4), team: 'red', groupId: 1, hex: { q: -1, r: 0 } },
      { id: id(5), team: 'red', groupId: 1, hex: { q: -1, r: 1 } },
      { id: id(6), team: 'red', groupId: 1, hex: { q: 1, r: -1 } },
      { id: 'b1', team: 'blue', groupId: 1, hex: { q: 6, r: -2 }, hp: 999 },
      { id: 'b2', team: 'blue', groupId: 1, hex: { q: 6, r: 2 }, hp: 999 },
    ],
    attackTarget: { q: 6, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 12,
    mode: 'unleash',
  },
  {
    // DEFEND HEIGHT (thicket attack, large blob): 19-hex RIDGELINE blob (radius 2),
    // THICKET surrounding to the south. 15 reds start in the THICKET (3 rows × 5 cols).
    // Defend with anchor (0,2) (south-center) and defendFrom='THICKET' to focus on the
    // south arc. Expected: ~5 borders in the south segment fill rank 0, 6 ring-1 hexes
    // fill rank 1, 4 more units flow into rank 2 (deeper). Demonstrates multi-rank fill
    // at realistic army-on-large-blob scale.
    name: 'defend-thicket-large',
    units: (() => {
      const out: ScenarioUnit[] = [];
      let i = 1;
      for (let r = 3; r <= 5; r++) {
        for (let q = -3; q <= 1; q++) {
          out.push({ id: id(i++), team: 'red', groupId: 1, hex: { q, r } });
        }
      }
      return out;
    })(),
    attackTarget: { q: 0, r: -10 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 10,
    mode: 'defendHeight',
    defendTerrain: 'RIDGELINE',
    defendFrom: 'THICKET',
    defendAnchor: { q: 0, r: 2 },
    terrainAt: RIDGELINE_TERRAIN,
  },
  {
    // DEFEND HEIGHT (SURPLUS units): same 19-hex RIDGELINE blob as defend-thicket-large,
    // but with 30 reds — 11 surplus over blob capacity. Verifies the diagnostic that
    // surplus units end up unassigned (no slot in formation) and stand still where they
    // started, looking "stacked" while the first 19 sorted units migrate to the blob.
    name: 'defend-thicket-surplus',
    units: (() => {
      const out: ScenarioUnit[] = [];
      let i = 1;
      // 6 rows × 5 cols = 30 reds starting in THICKET south of the blob.
      for (let r = 3; r <= 8; r++) {
        for (let q = -3; q <= 1; q++) {
          out.push({ id: id(i++), team: 'red', groupId: 1, hex: { q, r } });
        }
      }
      return out;
    })(),
    attackTarget: { q: 0, r: -10 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 10,
    mode: 'defendHeight',
    defendTerrain: 'RIDGELINE',
    defendFrom: 'THICKET',
    defendAnchor: { q: 0, r: 2 },
    terrainAt: RIDGELINE_TERRAIN,
  },
  {
    // DEFEND HEIGHT (no bunching): 7-hex HILL blob, no rivers. 6 reds ALL start clustered
    // in the SW corner of GRASSLAND (not adjacent to most borders). Anchor (0,0). With the
    // global slot-assignment algorithm, each unit's projected index along the perimeter
    // determines which slot it gets — units don't all flock to the nearby western borders.
    // After enough ticks, the 6 units should occupy 6 DIFFERENT perimeter hexes, spread
    // around the blob (not clustered on the SW two).
    name: 'defend-no-bunching',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: -3, r: 2 } },
      { id: id(2), team: 'red', groupId: 1, hex: { q: -2, r: 2 } },
      { id: id(3), team: 'red', groupId: 1, hex: { q: -3, r: 3 } },
      { id: id(4), team: 'red', groupId: 1, hex: { q: -2, r: 3 } },
      { id: id(5), team: 'red', groupId: 1, hex: { q: -4, r: 2 } },
      { id: id(6), team: 'red', groupId: 1, hex: { q: -4, r: 3 } },
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 12,
    mode: 'defendHeight',
    defendTerrain: 'HILL',
    defendAnchor: { q: 0, r: 0 },
    terrainAt: HILL_TERRAIN,
  },
  {
    // DEFEND HEIGHT (multi-rank fill): 7-hex HILL blob, no rivers. 6 reds start on
    // GRASSLAND adjacent to each of the 6 borders. Rank 0 = 6 perimeter; rank 1 = center.
    // Expected: every unit reaches a border in ~1-2 ticks. Demonstrates that rank-0
    // fills cleanly when each unit has an unblocked entry hex.
    name: 'defend-multi-rank-fills-front',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: 2 } },     // S of (0,1)
      { id: id(2), team: 'red', groupId: 1, hex: { q: -1, r: 2 } },    // SW of (-1,1)
      { id: id(3), team: 'red', groupId: 1, hex: { q: -2, r: 1 } },    // W of (-1,1)
      { id: id(4), team: 'red', groupId: 1, hex: { q: 1, r: 1 } },     // SE of (1,0)
      { id: id(5), team: 'red', groupId: 1, hex: { q: 2, r: 0 } },     // E of (1,0)
      { id: id(6), team: 'red', groupId: 1, hex: { q: 0, r: -2 } },    // N of (0,-1)
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 5,
    mode: 'defendHeight',
    defendTerrain: 'HILL',
    defendAnchor: { q: 0, r: 0 },
    terrainAt: HILL_TERRAIN,
  },
  {
    // DEFEND HEIGHT (advance from back rank): 7-hex HILL blob. 5 reds pre-positioned
    // on 5 of the 6 borders (E border (1,0) left intentionally empty), 1 red at the
    // center (0,0) — rank 1. Expected: the center unit ADVANCES to fill the empty E
    // border (uRank=1 > bestRank=0). Final state: 6 on borders, center empty.
    name: 'defend-advance-from-rank-1',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },     // center, rank 1
      { id: id(2), team: 'red', groupId: 1, hex: { q: 0, r: 1 } },     // SE border
      { id: id(3), team: 'red', groupId: 1, hex: { q: -1, r: 1 } },    // SW border
      { id: id(4), team: 'red', groupId: 1, hex: { q: -1, r: 0 } },    // W border
      { id: id(5), team: 'red', groupId: 1, hex: { q: 0, r: -1 } },    // NW border
      { id: id(6), team: 'red', groupId: 1, hex: { q: 1, r: -1 } },    // NE border
      // (1,0) E border intentionally empty
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 3,
    mode: 'defendHeight',
    defendTerrain: 'HILL',
    defendAnchor: { q: 0, r: 0 },
    terrainAt: HILL_TERRAIN,
  },
  {
    // DEFEND HEIGHT (river segments, SOUTH anchor): 7-hex HILL blob, RIVERs to E (2,0)
    // and W (-2,0). The two river-flanked borders (1,0) and (-1,0) split the perimeter
    // into a NORTH arc {(1,-1), (0,-1)} and a SOUTH arc {(0,1), (-1,1)} with shared
    // terminators. Anchor at (0,1) (SE) → 3 units at center hexes should collectively
    // spread within the SOUTH segment {(-1,1), (0,1), (1,0), (-1,0)} only, never landing
    // on (0,-1) or (1,-1) (north arc).
    name: 'defend-river-segments-south',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },
      { id: id(2), team: 'red', groupId: 1, hex: { q: 0, r: 1 } },
      { id: id(3), team: 'red', groupId: 1, hex: { q: -1, r: 1 } },
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 4,
    mode: 'defendHeight',
    defendTerrain: 'HILL',
    defendAnchor: { q: 0, r: 1 },
    terrainAt: HILL_BLOB_WITH_RIVERS,
  },
  {
    // Same setup, NORTH anchor at (0,-1). Same 3 units. Expected: spread within the
    // NORTH segment {(0,-1), (1,-1), (1,0), (-1,0)}, never on (0,1) or (-1,1).
    name: 'defend-river-segments-north',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },
      { id: id(2), team: 'red', groupId: 1, hex: { q: 0, r: -1 } },
      { id: id(3), team: 'red', groupId: 1, hex: { q: 1, r: -1 } },
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 4,
    mode: 'defendHeight',
    defendTerrain: 'HILL',
    defendAnchor: { q: 0, r: -1 },
    terrainAt: HILL_BLOB_WITH_RIVERS,
  },
  {
    // DEFEND HEIGHT (directional): same 7-hex HILL blob, but east-side neighbors are
    // FOREST and west-side are SAND. With defendFrom='FOREST', the border list narrows to
    // the 3 east-facing HILL borders: (1,0), (1,-1), (0,1). 1 red unit at the center
    // should step to one of those 3, never to the west side.
    name: 'defend-directional',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 3,
    mode: 'defendHeight',
    defendTerrain: 'HILL',
    defendFrom: 'FOREST',
    terrainAt: HILL_DIRECTIONAL_TERRAIN,
  },
  {
    // DEFEND HEIGHT: 7-hex HILL blob (center + 6 neighbors), the rest GRASSLAND. 4 reds:
    //   - u01 on the center (NOT a border, surrounded by HILL) → steps to a free border
    //   - u02/u03 on E/NE borders → already on a border, hold position
    //   - u04 OFF the blob on GRASSLAND, one hex from a free SW border → routes onto blob
    // After ~2 ticks all 4 should be on border hexes.
    name: 'defend-spread-to-border',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },    // center HILL (not border)
      { id: id(2), team: 'red', groupId: 1, hex: { q: 1, r: 0 } },    // E HILL border
      { id: id(3), team: 'red', groupId: 1, hex: { q: 1, r: -1 } },   // NE HILL border
      { id: id(4), team: 'red', groupId: 1, hex: { q: -2, r: 1 } },   // off-blob GRASSLAND, adj to SW border
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 4,
    mode: 'defendHeight',
    defendTerrain: 'HILL',
    terrainAt: HILL_TERRAIN,
  },
  {
    // TERRAIN MODS: equal-size infantry groups, one on HILL (h=35) facing one on
    // GRASSLAND (h=12), already in melee contact. Verifies the per-pair damage
    // formula end-to-end:
    //   Hill → Grassland: 10 * (1 + 0.23) / 1.00 = 12.3/tick (down-hill bonus, no cover)
    //   Grassland → Hill: 10 * (1 + 0)    / 1.25 =  8.0/tick (uphill no-bonus, hill cover)
    //   Ratio ~1.54x throughput advantage to the hill side.
    // Order is on red (HILL), but the rigid-block march freezes on combat (combat begins
    // tick 1), so neither side moves — what we're measuring is the damage asymmetry
    // during static melee. Expected: blues die first (total blue HP drains in ~8 ticks
    // vs ~12 ticks for reds at the start-of-fight rates), leaving the hill side intact.
    name: 'hill_vs_grassland',
    units: [
      // Reds on the HILL column at q=0.
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: -1 } },
      { id: id(2), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },
      { id: id(3), team: 'red', groupId: 1, hex: { q: 0, r: 1 } },
      // Blues on the GRASSLAND column at q=1 (each one E-adjacent to its red mirror).
      { id: 'b1', team: 'blue', groupId: 1, hex: { q: 1, r: -1 } },
      { id: 'b2', team: 'blue', groupId: 1, hex: { q: 1, r: 0 } },
      { id: 'b3', team: 'blue', groupId: 1, hex: { q: 1, r: 1 } },
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 14,
    forceHeading: 0, // east; immaterial since combat freezes march on tick 1
    terrainAt: new Map<string, string>([
      // HILL column (where reds stand).
      [HexUtils.key({ q: 0, r: -1 }), 'HILL'],
      [HexUtils.key({ q: 0, r:  0 }), 'HILL'],
      [HexUtils.key({ q: 0, r:  1 }), 'HILL'],
      // GRASSLAND column (where blues stand). Listed explicitly so the
      // terrainAt-map renderer shows the boundary clearly.
      [HexUtils.key({ q: 1, r: -1 }), 'GRASSLAND'],
      [HexUtils.key({ q: 1, r:  0 }), 'GRASSLAND'],
      [HexUtils.key({ q: 1, r:  1 }), 'GRASSLAND'],
    ]),
  },
  {
    // TERRAIN MODS: HILL (h=35, def 1.25) attacker vs FOREST (h=18, def 1.30) defender.
    // Forest's 1.30 cover almost cancels hill's +17% downhill bonus:
    //   Hill → Forest: 10 * (1 + 0.17) / 1.30 ≈ 9.0/tick
    //   Forest → Hill: 10 * (1 + 0)    / 1.25  = 8.0/tick
    //   Ratio ~1.125x throughput advantage — much tighter than hill_vs_grassland's 1.54x.
    name: 'hill_vs_forest',
    units: [
      { id: id(1), team: 'red', groupId: 1, hex: { q: 0, r: -1 } },
      { id: id(2), team: 'red', groupId: 1, hex: { q: 0, r: 0 } },
      { id: id(3), team: 'red', groupId: 1, hex: { q: 0, r: 1 } },
      { id: 'b1', team: 'blue', groupId: 1, hex: { q: 1, r: -1 } },
      { id: 'b2', team: 'blue', groupId: 1, hex: { q: 1, r: 0 } },
      { id: 'b3', team: 'blue', groupId: 1, hex: { q: 1, r: 1 } },
    ],
    attackTarget: { q: 10, r: 0 },
    team: 'red', groupId: 1, formation: 'line', depth: 1, maxTicks: 20,
    forceHeading: 0,
    terrainAt: new Map<string, string>([
      [HexUtils.key({ q: 0, r: -1 }), 'HILL'],
      [HexUtils.key({ q: 0, r:  0 }), 'HILL'],
      [HexUtils.key({ q: 0, r:  1 }), 'HILL'],
      [HexUtils.key({ q: 1, r: -1 }), 'FOREST'],
      [HexUtils.key({ q: 1, r:  0 }), 'FOREST'],
      [HexUtils.key({ q: 1, r:  1 }), 'FOREST'],
    ]),
  },
];

const headingName = (h: number): string =>
  ['E', 'NE', 'NW', 'W', 'SW', 'SE'][h] ?? '?';

const renderGrid = (units: Unit[], target: Hex, unwalkable: Set<string>, terrainAt?: Map<string, string>): string => {
  let qMin = target.q, qMax = target.q, rMin = target.r, rMax = target.r;
  const bump = (h: Hex) => {
    if (h.q < qMin) qMin = h.q;
    if (h.q > qMax) qMax = h.q;
    if (h.r < rMin) rMin = h.r;
    if (h.r > rMax) rMax = h.r;
  };
  for (const u of units) bump(u.tacticalHex);
  qMin -= 1; qMax += 1; rMin -= 1; rMax += 1;

  const occ = new Map<string, Unit>();
  for (const u of units) occ.set(HexUtils.key(u.tacticalHex), u);

  const lines: string[] = [];
  for (let r = rMin; r <= rMax; r++) {
    const indent = ' '.repeat(r - rMin);
    let row = `r=${String(r).padStart(3)} | ${indent}`;
    for (let q = qMin; q <= qMax; q++) {
      const k = HexUtils.key({ q, r });
      const u = occ.get(k);
      let ch: string;
      if (u) ch = u.team === 'red' ? 'R' : 'B';
      else if (target.q === q && target.r === r) ch = '*';
      else if (unwalkable.has(k)) ch = '#';
      else if (terrainAt && terrainAt.has(k)) {
        const tt = terrainAt.get(k);
        if (tt === 'HILL') ch = '^';
        else if (tt === 'RIDGELINE') ch = '^';
        else if (tt === 'FOREST') ch = 'f';
        else if (tt === 'SAND') ch = 's';
        else if (tt === 'RIVER') ch = '~';
        else if (tt === 'THICKET') ch = 't';
        else if (tt === 'GRASSLAND') ch = ' ';
        else ch = '?';
      }
      else ch = ' ';
      row += ch + ' ';
    }
    lines.push(row);
  }
  return lines.join('\n');
};

const buildMapApi = (unwalkable: Hex[] | undefined, terrainAt?: Map<string, string>): MapApi => {
  const blocked = new Set((unwalkable ?? []).map(h => HexUtils.key(h)));
  const typeAt = (h: Hex) => terrainAt?.get(HexUtils.key(h)) ?? 'GRASSLAND';
  return {
    isInside: () => true, // harness has no bounded map
    isWalkable: (h: Hex) => !blocked.has(HexUtils.key(h)),
    getTerrainType: typeAt,
    getTerrainMods: (h: Hex) => getTerrainMods(typeAt(h)),
    getTerrainHeight: (h: Hex) => HARNESS_HEIGHTS[typeAt(h)] ?? 0,
    isBarrier: (h: Hex) => terrainAt?.get(HexUtils.key(h)) === 'RIVER',
  };
};

interface ScenarioResult {
  name: string;
  hexesMarched: number;
  fightingTicks: number;
}

const runScenario = (s: Scenario): ScenarioResult => {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`Scenario: ${s.name}`);
  console.log(`  formation=${s.formation}  depth=${s.depth}  N=${s.units.length}  target=(${s.attackTarget.q},${s.attackTarget.r})`);
  console.log(`${'='.repeat(72)}`);

  let units: Unit[] = s.units.map(u => seedUnit(u, s.terrainAt));
  const orderedUnits = units.filter(u => u.team === s.team && u.groupId === s.groupId);
  const heading = s.forceHeading ?? groupHeading(orderedUnits, s.attackTarget);
  console.log(`heading: ${heading} (${headingName(heading)})  mode: ${s.mode ?? 'march'}`);

  // Deploy snap for the ordered group (when applicable). For deploy-snap-line the snap is
  // the test itself; for march scenarios it positions the block before the march starts.
  const slots = computeFormationPreview(orderedUnits.length, s.attackTarget, heading, s.formation, s.depth);
  const pairing = computeOrderedSlotAssignments(orderedUnits, slots, s.attackTarget);
  if (s.name === 'deploy-snap-line') {
    units = units.map(u => {
      const slot = pairing.get(u.id);
      return slot ? { ...u, tacticalHex: slot } : u;
    });
  }
  // march-east-clear / march-blocked-by-wall / march-stops-on-combat: units are already
  // pre-positioned in the scenario definition; no snap.

  const unwalkSet = new Set((s.unwalkable ?? []).map(h => HexUtils.key(h)));
  console.log(`\n[initial]`);
  console.log(renderGrid(units, s.attackTarget, unwalkSet, s.terrainAt));

  const orderKey = groupOrderKey(s.team, s.groupId);
  const initialOrder: GroupOrder = {
    team: s.team, groupId: s.groupId, attackTarget: s.attackTarget, heading,
    mode: s.mode,
    chargeTicksRemaining: s.mode === 'charge' ? CHARGE_DURATION_TICKS : undefined,
    defendTerrain: s.defendTerrain,
    defendFrom: s.defendFrom,
    defendAnchor: s.defendAnchor,
  };
  let orders = new Map<string, GroupOrder>([[orderKey, initialOrder]]);
  const config: SimulationConfig = {
    damagePerTick: 10,
    mapApi: buildMapApi(s.unwalkable, s.terrainAt),
    currentTick: 0, // overridden per-tick in the loop below
  };

  // Initial centroid (after snap, if applicable) for "marched N hexes" metric.
  const initialGroup = units.filter(u => u.team === s.team && u.groupId === s.groupId);
  let icq = 0, icr = 0;
  for (const u of initialGroup) { icq += u.tacticalHex.q; icr += u.tacticalHex.r; }
  icq /= initialGroup.length; icr /= initialGroup.length;
  const initialCentroid = HexUtils.hexRound({ q: icq, r: icr });

  let fightingTicks = 0;
  for (let tick = 1; tick <= s.maxTicks; tick++) {
    const result = simulateTick(units, orders, { ...config, currentTick: tick });
    units = result.units;
    orders = result.orders;

    const groupUnits = units.filter(u => u.team === s.team && u.groupId === s.groupId);
    if (groupUnits.some(u => u.state === 'fighting')) fightingTicks++;

    let cq = 0, cr = 0;
    for (const u of groupUnits) { cq += u.tacticalHex.q; cr += u.tacticalHex.r; }
    cq /= Math.max(1, groupUnits.length); cr /= Math.max(1, groupUnits.length);
    const centroidHex = HexUtils.hexRound({ q: cq, r: cr });

    const curOrder = orders.get(orderKey);
    const modeTag = curOrder?.mode ?? 'march';
    const chargeTag = curOrder?.chargeTicksRemaining != null ? `  charge=${curOrder.chargeTicksRemaining}` : '';
    console.log(`\n[tick ${tick}]  centroid=(${centroidHex.q},${centroidHex.r})  mode=${modeTag}${chargeTag}`);
    if (s.mode === 'defendHeight' || s.mode === 'unleash') {
      const posList = units
        .filter(u => u.team === s.team && u.groupId === s.groupId)
        .map(u => `${u.id}@(${u.tacticalHex.q},${u.tacticalHex.r})`)
        .join('  ');
      console.log(`  positions: ${posList}`);
    }
    console.log(renderGrid(units, s.attackTarget, unwalkSet, s.terrainAt));
  }

  const finalGroupUnits = units.filter(u => u.team === s.team && u.groupId === s.groupId);
  let cq = 0, cr = 0;
  for (const u of finalGroupUnits) { cq += u.tacticalHex.q; cr += u.tacticalHex.r; }
  cq /= finalGroupUnits.length; cr /= finalGroupUnits.length;
  const finalCentroid = HexUtils.hexRound({ q: cq, r: cr });
  const hexesMarched = HexUtils.distance(initialCentroid, finalCentroid);

  console.log(`\nsummary[${s.name}]:`);
  console.log(`  initialCentroid: (${initialCentroid.q},${initialCentroid.r})`);
  console.log(`  finalCentroid:   (${finalCentroid.q},${finalCentroid.r})`);
  console.log(`  hexesMarched:    ${hexesMarched}`);
  console.log(`  fightingTicks:   ${fightingTicks}`);
  // Surface final HP per unit when relevant (charge impact scenarios, combat scenarios).
  const initialHpById = new Map(s.units.map(u => [u.id, u.hp ?? 100]));
  const finalById = new Map(units.map(u => [u.id, u]));
  const hpChanges = [...initialHpById.entries()]
    .map(([uid, hp0]) => {
      const u = finalById.get(uid);
      const hp = u?.hp ?? 0;
      return { uid, hp0, hp, alive: !!u };
    })
    .filter(r => r.hp !== r.hp0 || !r.alive);
  if (hpChanges.length > 0) {
    console.log(`  hpChanges:`);
    for (const r of hpChanges) {
      console.log(`    ${r.uid.padEnd(6)} ${r.hp0} → ${r.hp}${r.alive ? '' : ' (dead)'}`);
    }
  }

  return { name: s.name, hexesMarched, fightingTicks };
};

const results = scenarios.map(runScenario);

console.log(`\n${'='.repeat(72)}`);
console.log('OVERALL');
console.log(`${'='.repeat(72)}`);
for (const r of results) {
  console.log(`  ${r.name.padEnd(28)} marched=${r.hexesMarched}  fightingTicks=${r.fightingTicks}`);
}
