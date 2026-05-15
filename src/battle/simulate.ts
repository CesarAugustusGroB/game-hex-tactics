import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { heightDamageBonus, type TerrainMods } from './terrain';

export type Team = 'red' | 'blue';
export type GroupId = 1 | 2 | 3;
export type UnitState = 'idle' | 'moving' | 'fighting';
export type FormationType = 'hex' | 'line' | 'wedge' | 'column';

export interface Unit {
  id: string;
  team: Team;
  tacticalHex: Hex;
  homeHex: Hex;
  groupId: GroupId;
  hp: number;
  state: UnitState;
  /** Position the unit occupied at the start of the most recent tick during which it
   *  moved. Used by defendHeight's lateral fallback to avoid backtracking (so a unit
   *  that side-stepped tick N doesn't immediately step back to its previous hex tick
   *  N+1, which would oscillate). Optional — undefined for units that have never moved. */
  prevTacticalHex?: Hex;
  /** Absolute tick number at which the unit is next allowed to move. Set when the unit
   *  enters a hex: `currentTick + 1 + terrainMoveCost`. Movement steps skip any unit
   *  with `currentTick < nextMoveTick`. Defaults to 0 on newly-placed units (immediately
   *  movable). Charge mode halves the entry penalty (floor). */
  nextMoveTick: number;
  /** Sight radius (hexes) for the unit. Refreshed each tick from the terrain it stands
   *  on. Data-only this pass: nothing reads it yet. Defaults to 4 on newly-placed units
   *  (matches `DEFAULT_TERRAIN_MODS.visionRadius`). */
  visionRadius: number;
}

/**
 * Player-selectable motion modes layered on top of an active attack order.
 * - 'march'        : rigid-block advance, all-or-nothing, combat freezes the block.
 * - 'charge'       : per-unit advance at CHARGE_SPEED_HEXES per tick for CHARGE_DURATION_TICKS
 *                    ticks; stragglers get left behind; deals impact damage in a 3-hex lance.
 * - 'retreat'      : rigid-block advance in the OPPOSITE of `heading`; ignores 'fighting' state
 *                    so the block can disengage.
 * - 'unleash'      : break formation; each unit greedily steps toward its nearest enemy.
 * - 'defendHeight' : spread to the borders of the group's home terrain (captured at activation);
 *                    per-unit greedy step toward nearest border hex, units stay on home terrain.
 */
export type OrderMode = 'march' | 'charge' | 'retreat' | 'unleash' | 'defendHeight';

export interface GroupOrder {
  team: Team;
  groupId: GroupId;
  attackTarget: Hex | null;
  /** Snapped 0..5 hex direction captured at deploy time. Used by the HUD for facing
   *  indicators; not load-bearing for movement in the rigid-block model. */
  heading: number;
  /** Player-controlled hold flag. When true, the rigid-block march is suppressed for
   *  this group (combat still resolves). Toggled from the HUD HOLD button. */
  hold?: boolean;
  /** Player-selected motion mode. Undefined = 'march' (default). */
  mode?: OrderMode;
  /** Set when mode='charge' is engaged; counts down to 0, then mode reverts to 'march'.
   *  HOLD pauses the countdown (so a charge can be paused and resumed intact). */
  chargeTicksRemaining?: number;
  /** Enemy unit ids already hit by this group's lance during the current charge. Each
   *  enemy takes impact damage at most ONCE per charge — the lance is a one-shot impact
   *  on contact, not a sustained beam that re-damages as the unit advances. Cleared when
   *  the charge ends. */
  chargeDamagedIds?: string[];
  /** Sticky home-terrain key captured at the moment 'defendHeight' is toggled on (e.g.
   *  'HILL'). The sim defends the connected blob of THIS terrain, even if the group
   *  drifts onto adjacent terrain. Cleared whenever mode reverts to anything else. */
  defendTerrain?: string;
  /** Sticky threat-source terrain captured at activation. When set, the defendHeight
   *  border list is filtered to blob hexes adjacent to ≥1 hex of THIS terrain only,
   *  yielding a directional defense (one side of the blob instead of all 360°).
   *  Undefined = omnidirectional. Cleared whenever mode reverts to anything else. */
  defendFrom?: string;
  /** Sticky anchor hex captured at the moment 'defendHeight' is activated — the hex the
   *  player clicked / drag-started on. The sim narrows defense to the perimeter SEGMENT
   *  containing the border nearest this anchor; barrier-flanked borders (e.g. RIVER)
   *  terminate the segment. Undefined = full perimeter (legacy / no-anchor orders). */
  defendAnchor?: Hex;
  /** Sticky unit→slot assignment, fixed at defendHeight activation by `commitDefend` in
   *  the UI. Keyed by unit id; values are the assigned formation slot. When set, the sim
   *  walks each unit one step toward its STORED slot every tick — NO per-tick re-pairing,
   *  so units converge on a stable formation instead of oscillating. Cleared on
   *  toggle-off / mode switch. Undefined = legacy path (recompute pairing each tick). */
  defendAssignments?: Record<string, Hex>;
}

export interface MapApi {
  /** Whether the hex is on the playable grid. */
  isInside(hex: Hex): boolean;
  /** Whether terrain at the hex permits unit occupation. */
  isWalkable(hex: Hex): boolean;
  /** Terrain key at the given hex (e.g. 'HILL', 'GRASSLAND'), or undefined if off-map.
   *  Used by 'defendHeight' to identify the perimeter to defend. */
  getTerrainType(hex: Hex): string | undefined;
  /** Mechanical mods (defenseMult / moveCost / attritionPerTick / visionRadius) for the
   *  terrain at this hex. Off-map / unknown terrain returns neutral defaults. Sim reads
   *  through this method so the same code path works in-engine and in the harness. */
  getTerrainMods(hex: Hex): TerrainMods;
  /** Terrain elevation at the given hex, in the same height units as `TerrainDef.height`.
   *  Used by the damage step to compute the downhill attack bonus. Off-map hexes return
   *  0 (no bonus, no penalty). */
  getTerrainHeight(hex: Hex): number;
  /** Whether this hex is a "natural barrier" — walkable but cuts the defense line.
   *  Today: RIVER hexes. A perimeter border that touches a barrier hex is a segment
   *  terminator; the defendHeight BFS does not expand past it. */
  isBarrier(hex: Hex): boolean;
}

export interface SimulationConfig {
  damagePerTick: number;
  mapApi: MapApi;
  /** Monotonic tick counter supplied by the caller (the GameCanvas setInterval / the
   *  harness loop). Used by movement to compare against each unit's `nextMoveTick`
   *  cooldown. Callers must increment this each tick; the sim itself is stateless. */
  currentTick: number;
}

export interface SimulationResult {
  units: Unit[];
  /** Reference-equal to the input orders Map when no order needed mutation this tick,
   *  so React `setGroupOrders(result.orders)` is a cheap no-op when nothing changed. */
  orders: Map<string, GroupOrder>;
}

/** CHARGE tuning. Duration in ticks; at TICK_MS=500 this is 1.5s real-time. */
export const CHARGE_DURATION_TICKS = 3;
export const CHARGE_SPEED_HEXES = 2;
export const CHARGE_IMPACT_RANGE = 2;
export const CHARGE_IMPACT_DAMAGE = 10;

/** UNLEASH engagement cap: max allies attacking a single enemy at once. Above the cap,
 *  new units pick a less-crowded enemy instead of dogpiling. 3 covers a clean half-arc
 *  (a hex has 6 neighbors, 3 from one side is plenty). If every enemy is at the cap,
 *  units fall back to closest-overall so they still engage. */
export const UNLEASH_MAX_ENGAGERS = 3;

const groupOrderKey = (team: Team, groupId: GroupId): string => `${team}:${groupId}`;

// sameHex was used by the per-unit movement loop; the rigid-block march uses key compares.

const addHex = (a: Hex, b: Hex, scale = 1): Hex => ({
  q: a.q + b.q * scale,
  r: a.r + b.r * scale,
});

/**
 * Snap a pixel-space vector to the index 0..5 of the hex direction whose pixel form has
 * the largest dot product with it. Returns 0 (east) when the vector is near-zero.
 */
export const snapHeading = (px: number, py: number): number => {
  if (Math.hypot(px, py) < 1e-6) return 0;
  let bestIdx = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const dPx = HexUtils.hexToPixel(HexUtils.directions[i]);
    const dot = px * dPx.x + py * dPx.y;
    if (dot > bestDot) {
      bestDot = dot;
      bestIdx = i;
    }
  }
  return bestIdx;
};

export const groupHeading = (units: Unit[], target: Hex): number => {
  const tp = HexUtils.hexToPixel(target);
  let dx = 0;
  let dy = 0;
  for (const u of units) {
    const up = HexUtils.hexToPixel(u.tacticalHex);
    dx += tp.x - up.x;
    dy += tp.y - up.y;
  }
  return snapHeading(dx, dy);
};

/** All hexes at exactly `radius` from `center`, in clockwise order starting from the SW corner. */
const hexRing = (center: Hex, radius: number): Hex[] => {
  if (radius === 0) return [center];
  const result: Hex[] = [];
  let h = addHex(center, HexUtils.directions[4], radius);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      result.push(h);
      h = addHex(h, HexUtils.directions[i]);
    }
  }
  return result;
};

/**
 * Hex formation: fill concentric rings outward from `target` (center first). When the outermost
 * ring would be only partially filled, distribute that ring's units evenly around its perimeter
 * instead of clustering them on one side — keeps the shape rotationally balanced.
 */
const collectNearestHexes = (target: Hex, count: number): Hex[] => {
  const slots: Hex[] = [];
  let remaining = count;
  for (let r = 0; remaining > 0; r++) {
    const ring = hexRing(target, r);
    const take = Math.min(remaining, ring.length);
    if (take === ring.length) {
      slots.push(...ring);
    } else {
      const step = ring.length / take;
      for (let i = 0; i < take; i++) slots.push(ring[Math.floor(i * step)]);
    }
    remaining -= take;
  }
  return slots;
};

/**
 * Produce `count` slots in formation-local order (lead/apex first). Heading is an index into
 * HexUtils.directions; line and wedge use the two diagonals symmetric to the heading axis,
 * giving pixel-symmetric V and chord shapes that read clearly on the hex grid.
 *
 * `depth` is the number of ranks/files behind the front. LINE: `depth` ranks of
 * `ceil(count/depth)` width (front rank shrinks, ranks stack back). COLUMN: `depth` parallel
 * files of `ceil(count/depth)` length. WEDGE and HEX ignore depth.
 */
const formationSlots = (
  target: Hex,
  heading: number,
  count: number,
  formation: FormationType,
  depth: number,
): Hex[] => {
  if (count === 0) return [];
  const back = HexUtils.directions[(heading + 3) % 6];
  // Two back-diagonal hex directions, mirror-symmetric across the heading axis in pixel space.
  const backLeft = HexUtils.directions[(heading + 2) % 6];
  const backRight = HexUtils.directions[(heading + 4) % 6];
  // Perpendicular axis used to extend lines and to space parallel column files: heading-
  // relative "left" diagonal in pixel space (axis tilted 60° off true perpendicular).
  const perpA = HexUtils.directions[(heading + 1) % 6];
  const d = Math.max(1, depth);

  switch (formation) {
    case 'hex':
      return collectNearestHexes(target, count);
    case 'line': {
      // d ranks of width w = ceil(count/d). Rank 0 is the front; subsequent ranks are
      // shifted by `back`. Rank-major iteration, left-to-right within a rank — last partial
      // rank ends up right-aligned (i.e. slot[0] = target stays the front-right corner).
      const w = Math.ceil(count / d);
      const slots: Hex[] = [];
      for (let r = 0; r < d && slots.length < count; r++) {
        for (let i = 0; i < w && slots.length < count; i++) {
          slots.push(addHex(addHex(target, back, r), perpA, i));
        }
      }
      return slots;
    }
    case 'wedge': {
      const slots: Hex[] = [target];
      for (let k = 1; slots.length < count; k++) {
        slots.push(addHex(target, backLeft, k));
        if (slots.length >= count) break;
        slots.push(addHex(target, backRight, k));
      }
      return slots.slice(0, count);
    }
    case 'column': {
      // d parallel files of length L = ceil(count/d). File 0 is the rightmost (anchored on
      // target); each subsequent file is shifted by `perpA` (heading-relative left). File-major
      // iteration, front-to-back within a file — last partial file ends up right-aligned in
      // rank.
      const L = Math.ceil(count / d);
      const slots: Hex[] = [];
      for (let f = 0; f < d && slots.length < count; f++) {
        for (let k = 0; k < L && slots.length < count; k++) {
          slots.push(addHex(addHex(target, perpA, f), back, k));
        }
      }
      return slots;
    }
  }
};

/**
 * Produce a per-unit destination hex so an N-unit group forms the chosen shape near the attack
 * target. Pairing is by sorted id ↔ formation-ordered slot, so a given unit keeps the same slot
 * tick-to-tick as long as the live roster is stable; when a unit dies the rest re-pair and
 * compact toward the formation lead.
 */
/**
 * Slot list for a formation, lieutenant-anchored on `target`. slot[0] = target (lieutenant);
 * the rest extend to the lieutenant's heading-relative left. Shared by the live sim and the
 * pre-commit preview so what the player sees is exactly what they'll get.
 */
export const computeFormationPreview = (
  unitCount: number,
  target: Hex,
  heading: number,
  formation: FormationType,
  depth: number,
): Hex[] => {
  if (unitCount <= 0) return [];
  const slots = formationSlots(target, heading, unitCount, formation, depth);

  // Find the rightmost slot (largest projection onto heading-relative right vector, tiebreak
  // by forward projection so a hex's SE corner beats its SW corner). Shift everything so that
  // slot lands on `target`, then swap it to index 0.
  const headingPx = HexUtils.hexToPixel(HexUtils.directions[heading]);
  const rightPx = { x: -headingPx.y, y: headingPx.x };
  const targetPx = HexUtils.hexToPixel(target);
  let rightmostIdx = 0;
  let bestRight = -Infinity;
  let bestFwd = -Infinity;
  for (let i = 0; i < slots.length; i++) {
    const sp = HexUtils.hexToPixel(slots[i]);
    const dx = sp.x - targetPx.x;
    const dy = sp.y - targetPx.y;
    const rProj = dx * rightPx.x + dy * rightPx.y;
    const fProj = dx * headingPx.x + dy * headingPx.y;
    if (rProj > bestRight || (rProj === bestRight && fProj > bestFwd)) {
      bestRight = rProj;
      bestFwd = fProj;
      rightmostIdx = i;
    }
  }
  const shiftQ = target.q - slots[rightmostIdx].q;
  const shiftR = target.r - slots[rightmostIdx].r;
  for (let i = 0; i < slots.length; i++) {
    slots[i] = { q: slots[i].q + shiftQ, r: slots[i].r + shiftR };
  }
  if (rightmostIdx !== 0) {
    const tmp = slots[0];
    slots[0] = slots[rightmostIdx];
    slots[rightmostIdx] = tmp;
  }
  return slots;
};

/**
 * Front rank along the hex-line from `startHex` to `endHex` (any angle, not snapped to 6),
 * then additional ranks shifted one hex `back` per rank. Slot[0] = startHex so the lieutenant
 * lands at the press point. The forward heading (perpendicular to the line, pointing away from
 * the press-hex centroid of the front rank) is snapped to one of 6 hex directions for the
 * back-shift and for the lieutenant's facing-arrow glyph; the front line itself stays continuous.
 *
 * For drags shorter than count units, the formation wraps into ⌈N/W⌉ ranks; clamps to single
 * full rank when W ≥ N.
 */
export const computeLineDragSlots = (
  count: number,
  startHex: Hex,
  endHex: Hex,
): { slots: Hex[]; headingForward: number } => {
  if (count <= 0) return { slots: [], headingForward: 0 };
  const fullLine = HexUtils.hexLine(startHex, endHex);
  // Cap front-rank width at count (no point making a line longer than the army).
  const w = Math.min(fullLine.length, count);
  const front = fullLine.slice(0, w);

  // The line lies along the drag in pixel space; the block faces (and marches) PERPENDICULAR
  // to the line — specifically the drag vector rotated 90° clockwise on screen:
  //   east drag  → north march    west drag  → south march
  //   north drag → west march     south drag → east march
  // This matches the player intuition that the line is a "wall" and units face the side they
  // would step toward. `back` is the opposite perpendicular so extra ranks stack behind the
  // front rank away from the march direction.
  const aPx = HexUtils.hexToPixel(startHex);
  const bPx = HexUtils.hexToPixel(endHex);
  const lineDx = bPx.x - aPx.x;
  const lineDy = bPx.y - aPx.y;
  const forwardPx = { x: lineDy, y: -lineDx };
  const backPx = { x: -lineDy, y: lineDx };
  const headingForward = snapHeading(forwardPx.x, forwardPx.y);
  const back = HexUtils.directions[snapHeading(backPx.x, backPx.y)];

  const slots: Hex[] = [];
  for (let r = 0; r < Math.ceil(count / w) && slots.length < count; r++) {
    for (let i = 0; i < w && slots.length < count; i++) {
      slots.push(addHex(front[i], back, r));
    }
  }
  return { slots, headingForward };
};

/**
 * Total-War-style 60° wedge laid out by a single drag.
 *
 * - **Press hex** = apex of the wedge, where the lieutenant (slot[0]) goes. This is the front
 *   of the formation — the spearhead.
 * - **Drag direction** = where the wedge points (forward / attack direction).
 * - **Drag length** = depth of the wedge along its central axis.
 *
 * The two arms extend BEHIND the apex at ±30° from the central axis (60° apex angle), so the
 * shape is a narrow arrowhead instead of a wide 120° V. Arm length is drag_length / cos30°
 * so the back-edge sits the dragged distance behind the apex along the central axis.
 *
 * Fill order is **apex-first**: small N = a pointy tip, large N = a full arrowhead, excess
 * spills behind the back edge. This is what makes the formation read as a wedge at every
 * group size.
 */
export const computeWedgeDragSlots = (
  count: number,
  startHex: Hex,
  endHex: Hex,
): { slots: Hex[]; headingForward: number } => {
  if (count <= 0) return { slots: [], headingForward: 0 };

  const aPx = HexUtils.hexToPixel(startHex);
  const bPx = HexUtils.hexToPixel(endHex);
  const dx = bPx.x - aPx.x;  // drag direction = forward (where the wedge points)
  const dy = bPx.y - aPx.y;
  const SQRT3 = Math.sqrt(3);
  const COS30 = SQRT3 / 2;
  const SIN30 = 0.5;
  // Back = -drag. Arms extend backward at ±30° from the back axis (60° apex angle total).
  const backX = -dx;
  const backY = -dy;
  // Right arm = back rotated -30° math; Left arm = back rotated +30° math.
  // 2D rotation (math): (x cos α - y sin α, x sin α + y cos α).
  const rArmDx = backX * COS30 + backY * SIN30;
  const rArmDy = -backX * SIN30 + backY * COS30;
  const lArmDx = backX * COS30 - backY * SIN30;
  const lArmDy = backX * SIN30 + backY * COS30;
  // Arm length = (drag length on the central axis) / cos30. With the rotated vector at the
  // drag's magnitude, scaling by 1/cos30 stretches it to the actual arm length.
  const armScale = 1 / COS30;
  const rTipHex = HexUtils.pixelToHex({ x: aPx.x + rArmDx * armScale, y: aPx.y + rArmDy * armScale });
  const lTipHex = HexUtils.pixelToHex({ x: aPx.x + lArmDx * armScale, y: aPx.y + lArmDy * armScale });

  const rightArm = HexUtils.hexLine(startHex, rTipHex);
  const leftArm = HexUtils.hexLine(startHex, lTipHex);
  const w = Math.min(rightArm.length, leftArm.length);

  const headingForward = snapHeading(dx, dy);

  const slots: Hex[] = [];
  const seen = new Set<string>();
  const push = (h: Hex) => {
    const k = HexUtils.key(h);
    if (seen.has(k)) return false;
    seen.add(k);
    slots.push(h);
    return slots.length >= count;
  };

  // Apex-to-back fill. Rank 0 = apex (1 hex). Rank k = the hex-line between the k-th step on
  // each arm, growing wider toward the back.
  for (let k = 0; k < w; k++) {
    const rank = HexUtils.hexLine(rightArm[k], leftArm[k]);
    for (const h of rank) {
      if (push(h)) return { slots, headingForward };
    }
  }

  // Excess units: extend ranks behind the back edge in the snapped back direction.
  if (slots.length < count) {
    const backOut = HexUtils.directions[snapHeading(backX, backY)];
    let depth = 1;
    while (slots.length < count && depth < 30) {
      const rExt = addHex(rightArm[w - 1], backOut, depth);
      const lExt = addHex(leftArm[w - 1], backOut, depth);
      const extraRank = HexUtils.hexLine(rExt, lExt);
      for (const h of extraRank) {
        if (push(h)) return { slots, headingForward };
      }
      depth++;
    }
  }

  return { slots, headingForward };
};

/**
 * Hex disk laid out by a single drag, lieutenant at `startHex`, drag end is the opposite
 * corner. Disk center = the rounded midpoint of A and B; radius = ⌈D/2⌉ so both endpoints
 * are within. If the group has more units than fit, the radius auto-expands until the disk
 * is big enough (1 + 3r(r+1) ≥ count). If the group has fewer units than the disk holds,
 * we still keep slot[0] = startHex and take the `count` hexes nearest to it — the formation
 * concentrates around the press point.
 *
 * `headingForward` = direction from drag end back to the press hex, snapped to one of 6.
 */
export const computeHexDragSlots = (
  count: number,
  startHex: Hex,
  endHex: Hex,
): { slots: Hex[]; headingForward: number } => {
  if (count <= 0) return { slots: [], headingForward: 0 };

  const center = HexUtils.hexRound({
    q: (startHex.q + endHex.q) / 2,
    r: (startHex.r + endHex.r) / 2,
  });
  const D = HexUtils.distance(startHex, endHex);
  let radius = Math.max(0, Math.ceil(D / 2));
  while (1 + 3 * radius * (radius + 1) < count) radius++;

  const diskHexes: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      diskHexes.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  diskHexes.sort((a, b) => {
    const da = HexUtils.distance(a, startHex);
    const db = HexUtils.distance(b, startHex);
    if (da !== db) return da - db;
    const ka = HexUtils.key(a);
    const kb = HexUtils.key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const slots = diskHexes.slice(0, count);

  const aPx = HexUtils.hexToPixel(startHex);
  const bPx = HexUtils.hexToPixel(endHex);
  const headingForward = snapHeading(aPx.x - bPx.x, aPx.y - bPx.y);

  return { slots, headingForward };
};

/**
 * Pair units to slots by projection onto the march direction (group centroid → target),
 * with lateral position as a tiebreak. Sorted descending so the frontmost unit (closest
 * to target along march) gets slots[0] — which by convention across all slot generators
 * is the lieutenant slot at/near the attack target. Used exclusively at deploy time to
 * choose which unit teleports to which slot; the rigid-block march itself doesn't need
 * any pairing since every unit moves by the same delta.
 */
export const computeOrderedSlotAssignments = (
  units: Unit[],
  slots: Hex[],
  target: Hex,
): Map<string, Hex> => {
  const result = new Map<string, Hex>();
  if (units.length === 0 || slots.length === 0) return result;
  const targetPx = HexUtils.hexToPixel(target);
  let cx = 0, cy = 0;
  for (const u of units) {
    const p = HexUtils.hexToPixel(u.tacticalHex);
    cx += p.x; cy += p.y;
  }
  cx /= units.length; cy /= units.length;
  let fx = targetPx.x - cx;
  let fy = targetPx.y - cy;
  const flen = Math.hypot(fx, fy);
  if (flen < 1e-6) { fx = 1; fy = 0; } else { fx /= flen; fy /= flen; }
  // Left-perpendicular: rotates forward 90° counterclockwise (in screen coords with +y down).
  const px = -fy;
  const py = fx;
  const ranked = units.map((u, ui) => {
    const p = HexUtils.hexToPixel(u.tacticalHex);
    return { ui, f: p.x * fx + p.y * fy, perp: p.x * px + p.y * py };
  });
  ranked.sort((a, b) => {
    if (a.f !== b.f) return b.f - a.f;
    if (a.perp !== b.perp) return b.perp - a.perp;
    const ida = units[a.ui].id;
    const idb = units[b.ui].id;
    return ida < idb ? -1 : ida > idb ? 1 : 0;
  });
  for (let i = 0; i < ranked.length && i < slots.length; i++) {
    result.set(units[ranked[i].ui].id, slots[i]);
  }
  return result;
};

export const computeSlotAssignments = (
  units: Unit[],
  target: Hex,
  formation: FormationType,
  heading: number,
  depth: number,
): Map<string, Hex> => {
  if (units.length === 0) return new Map();
  const slots = computeFormationPreview(units.length, target, heading, formation, depth);
  return computeOrderedSlotAssignments(units, slots, target);
};

export interface DefendFormation {
  /** Home-terrain blob the group is defending. */
  blob: Set<string>;
  /** Rank (BFS distance from any segment border) for each blob hex. */
  rank: Map<string, number>;
  /** Unit id → assigned formation slot. */
  assignment: Map<string, Hex>;
}

/**
 * Build the defendHeight formation: BFS the home blob, derive the perimeter segment,
 * compute ranks via BFS-from-segment, perimeter-walk to index rank-0 hexes, inherit
 * indices for rank-1+ hexes, sort slots by (rank, index, key), take the first N as the
 * formation, then global-pair the units to formation slots by their projected index
 * along the perimeter axis.
 *
 * Pure: deterministic for given inputs. Returns `null` when there's nothing to defend
 * (no home terrain set, no blob reachable, no borders, no segment).
 *
 * Called by `simulateTick` every tick in the no-sticky path AND by the canvas at
 * activation time to compute the initial `defendAssignments` to store on the order.
 */
export const computeDefendFormation = (
  groupUnits: Unit[],
  order: GroupOrder,
  config: SimulationConfig,
): DefendFormation | null => {
  const homeTerrain = order.defendTerrain;
  if (!homeTerrain) return null;

  // Blob BFS — connected home-terrain region reachable from the group.
  const blob = new Set<string>();
  const bfsQueue: Hex[] = [];
  for (const u of groupUnits) {
    if (config.mapApi.getTerrainType(u.tacticalHex) === homeTerrain) bfsQueue.push(u.tacticalHex);
  }
  if (bfsQueue.length === 0) {
    for (const u of groupUnits) {
      for (const n of HexUtils.getNeighbors(u.tacticalHex)) {
        if (config.mapApi.getTerrainType(n) === homeTerrain) { bfsQueue.push(n); break; }
      }
    }
  }
  if (bfsQueue.length === 0) return null;
  while (bfsQueue.length) {
    const h = bfsQueue.shift()!;
    const k = HexUtils.key(h);
    if (blob.has(k)) continue;
    if (!config.mapApi.isInside(h)) continue;
    if (config.mapApi.getTerrainType(h) !== homeTerrain) continue;
    blob.add(k);
    for (const n of HexUtils.getNeighbors(h)) bfsQueue.push(n);
  }

  // Borders: blob hexes with ≥1 walkable non-home neighbor. defendFrom further narrows.
  const borders: Hex[] = [];
  for (const k of blob) {
    const h = HexUtils.fromKey(k);
    for (const n of HexUtils.getNeighbors(h)) {
      if (!config.mapApi.isInside(n)) continue;
      if (!config.mapApi.isWalkable(n)) continue;
      const nt = config.mapApi.getTerrainType(n);
      if (nt === homeTerrain) continue;
      if (order.defendFrom && nt !== order.defendFrom) continue;
      borders.push(h);
      break;
    }
  }
  if (borders.length === 0) return null;

  // Segment BFS from anchor — barrier-flanked borders are terminal.
  let segmentBorders = borders;
  if (order.defendAnchor) {
    const anchor = order.defendAnchor;
    const borderKeys = new Set(borders.map(b => HexUtils.key(b)));
    let nearest: Hex | null = null;
    let nearestD = Infinity;
    for (const b of borders) {
      const d = HexUtils.distance(anchor, b);
      if (d < nearestD) { nearestD = d; nearest = b; }
    }
    if (nearest) {
      const segment = new Set<string>();
      const segQueue: Hex[] = [nearest];
      while (segQueue.length) {
        const h = segQueue.shift()!;
        const hk = HexUtils.key(h);
        if (segment.has(hk)) continue;
        segment.add(hk);
        let flanked = false;
        for (const n of HexUtils.getNeighbors(h)) {
          if (blob.has(HexUtils.key(n))) continue;
          if (config.mapApi.isBarrier(n)) { flanked = true; break; }
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
  }
  if (segmentBorders.length === 0) return null;

  // Rank BFS through the blob from segment borders.
  const rank = new Map<string, number>();
  const rankQueue: Hex[] = [];
  for (const b of segmentBorders) {
    rank.set(HexUtils.key(b), 0);
    rankQueue.push(b);
  }
  while (rankQueue.length) {
    const h = rankQueue.shift()!;
    const r = rank.get(HexUtils.key(h))!;
    for (const n of HexUtils.getNeighbors(h)) {
      const nk = HexUtils.key(n);
      if (!blob.has(nk)) continue;
      if (rank.has(nk)) continue;
      rank.set(nk, r + 1);
      rankQueue.push(n);
    }
  }

  // Back-rank extension: when there are more live units than blob hexes, continue
  // the rank BFS outward into walkable non-threat hexes so the surplus units get
  // formation slots (behind the front line). Without this, surplus units never
  // receive an assignment and just stand wherever they were placed, producing the
  // "stacking in the rear" symptom. Safety cap = 3 × slotsNeeded so a degenerate
  // map (everything walkable in every direction) can't blow up the BFS.
  const liveUnitCount = groupUnits.filter(u => u.hp > 0).length;
  if (liveUnitCount > blob.size) {
    const slotsNeeded = liveUnitCount - blob.size;
    const extQueue: Hex[] = [];
    for (const k of rank.keys()) extQueue.push(HexUtils.fromKey(k));
    // Process in ascending-rank order so the extension grows layer by layer
    // outward, not jumping ahead from deep hexes first.
    extQueue.sort((a, b) => rank.get(HexUtils.key(a))! - rank.get(HexUtils.key(b))!);
    const cap = slotsNeeded * 3;
    let added = 0;
    while (extQueue.length > 0 && added < slotsNeeded && added < cap) {
      const h = extQueue.shift()!;
      const r = rank.get(HexUtils.key(h))!;
      for (const n of HexUtils.getNeighbors(h)) {
        const nk = HexUtils.key(n);
        if (rank.has(nk)) continue;
        if (blob.has(nk)) continue;
        if (!config.mapApi.isInside(n)) continue;
        if (!config.mapApi.isWalkable(n)) continue;
        if (order.defendFrom && config.mapApi.getTerrainType(n) === order.defendFrom) continue;
        rank.set(nk, r + 1);
        extQueue.push(n);
        added++;
        if (added >= slotsNeeded) break;
      }
    }
  }

  // Perimeter walk over segment borders for rank-0 indexing.
  const segSet = new Set(segmentBorders.map(b => HexUtils.key(b)));
  const adj = new Map<string, string[]>();
  for (const b of segmentBorders) {
    const k = HexUtils.key(b);
    const nbrs: string[] = [];
    for (const n of HexUtils.getNeighbors(b)) {
      const nk = HexUtils.key(n);
      if (segSet.has(nk)) nbrs.push(nk);
    }
    nbrs.sort();
    adj.set(k, nbrs);
  }
  let startKey: string | null = null;
  for (const [k, nbrs] of adj) {
    if (nbrs.length <= 1 && (startKey === null || k < startKey)) startKey = k;
  }
  if (startKey === null) {
    for (const k of adj.keys()) {
      if (startKey === null || k < startKey) startKey = k;
    }
  }
  const r0Index = new Map<string, number>();
  const orderedR0: Hex[] = [];
  {
    let cur: string | null = startKey;
    let prev: string | null = null;
    while (cur && !r0Index.has(cur)) {
      r0Index.set(cur, orderedR0.length);
      orderedR0.push(HexUtils.fromKey(cur));
      const nbrs = adj.get(cur) ?? [];
      let next: string | null = null;
      for (const n of nbrs) {
        if (n === prev) continue;
        if (r0Index.has(n)) continue;
        if (next === null || n < next) next = n;
      }
      prev = cur;
      cur = next;
    }
  }
  for (const k of segSet) {
    if (!r0Index.has(k)) {
      r0Index.set(k, orderedR0.length);
      orderedR0.push(HexUtils.fromKey(k));
    }
  }

  // Rank-1+ hexes inherit nearest rank-0 hex's index (column structure).
  // Iterates over `rank.keys()` so back-rank extension hexes also get a slotIndex.
  const slotIndex = new Map<string, number>();
  for (const k of rank.keys()) {
    if (r0Index.has(k)) { slotIndex.set(k, r0Index.get(k)!); continue; }
    const h = HexUtils.fromKey(k);
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < orderedR0.length; i++) {
      const d = HexUtils.distance(h, orderedR0[i]);
      if (d < bestD || (d === bestD && i < bestIdx)) { bestD = d; bestIdx = i; }
    }
    slotIndex.set(k, bestIdx);
  }

  // Sort all ranked hexes (blob + back-rank extension) by (rank, slotIndex, key).
  // First N = formation.
  const allSlots: Hex[] = [];
  for (const k of rank.keys()) allSlots.push(HexUtils.fromKey(k));
  allSlots.sort((a, b) => {
    const ka = HexUtils.key(a);
    const kb = HexUtils.key(b);
    const dr = rank.get(ka)! - rank.get(kb)!;
    if (dr !== 0) return dr;
    const di = (slotIndex.get(ka) ?? 0) - (slotIndex.get(kb) ?? 0);
    if (di !== 0) return di;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const liveUnits = groupUnits.filter(u => u.hp > 0);
  const formation = allSlots.slice(0, liveUnits.length);

  // Global pairing: sort units by projected index, pair to formation slots.
  const unitsWithIdx = liveUnits.map(u => {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < orderedR0.length; i++) {
      const d = HexUtils.distance(u.tacticalHex, orderedR0[i]);
      if (d < bestD || (d === bestD && i < bestIdx)) { bestD = d; bestIdx = i; }
    }
    return { unit: u, idx: bestIdx };
  });
  unitsWithIdx.sort((a, b) => {
    if (a.idx !== b.idx) return a.idx - b.idx;
    return a.unit.id < b.unit.id ? -1 : a.unit.id > b.unit.id ? 1 : 0;
  });
  const assignment = new Map<string, Hex>();
  for (let i = 0; i < unitsWithIdx.length && i < formation.length; i++) {
    assignment.set(unitsWithIdx[i].unit.id, formation[i]);
  }

  return { blob, rank, assignment };
};

/**
 * Run one simulation tick. Returns surviving units and (possibly mutated) orders.
 * Pure: no mutation of inputs; deterministic given inputs.
 *
 * Motion model is selected per-group by `order.mode`:
 * - 'march' (default): all-or-nothing rigid block advance in `heading`. Combat freezes.
 * - 'charge': per-unit advance in `heading`, CHARGE_SPEED_HEXES sub-steps per tick.
 *   Stragglers stay behind, the rest keep going. Each sub-step lances impact damage in
 *   the next CHARGE_IMPACT_RANGE hexes ahead of every charging unit. Auto-reverts to
 *   'march' after CHARGE_DURATION_TICKS ticks. HOLD pauses motion AND the countdown.
 * - 'retreat': rigid-block advance in the OPPOSITE of `heading`. Combat does NOT freeze
 *   the block — disengage is allowed.
 * - 'unleash': each unit independently moves one hex toward its nearest enemy.
 */
export const simulateTick = (
  units: Unit[],
  orders: Map<string, GroupOrder>,
  config: SimulationConfig,
): SimulationResult => {
  const occupiedByHex = new Map<string, Unit>();
  for (const u of units) occupiedByHex.set(HexUtils.key(u.tacticalHex), u);

  const working: Unit[] = units.map(u => ({ ...u, state: 'idle' as UnitState }));
  const byId = new Map<string, Unit>(working.map(u => [u.id, u]));

  // Combat phase: each unit with adjacent enemies deals damage to the weakest one.
  // Per-pair damage = damagePerTick * (1 + heightBonus) / defenderDefenseMult. Attacker
  // terrain contributes ONLY via the height bonus (offensive lever); defender terrain
  // contributes the cover divisor (defenseMult > 1 = better cover, < 1 = worse cover).
  const damage = new Map<string, number>();
  for (const u of working) {
    const adjacentEnemies = HexUtils.getNeighbors(u.tacticalHex)
      .map(h => occupiedByHex.get(HexUtils.key(h)))
      .filter((other): other is Unit => !!other && other.team !== u.team);
    if (adjacentEnemies.length > 0) {
      let target = adjacentEnemies[0];
      for (let i = 1; i < adjacentEnemies.length; i++) {
        const e = adjacentEnemies[i];
        if (e.hp < target.hp || (e.hp === target.hp && e.id < target.id)) target = e;
      }
      const hAtt = config.mapApi.getTerrainHeight(u.tacticalHex);
      const hDef = config.mapApi.getTerrainHeight(target.tacticalHex);
      const defenseMult = config.mapApi.getTerrainMods(target.tacticalHex).defenseMult;
      const dmg = (config.damagePerTick * (1 + heightDamageBonus(hAtt, hDef))) / defenseMult;
      damage.set(target.id, (damage.get(target.id) ?? 0) + dmg);
      u.state = 'fighting';
    }
  }
  damage.forEach((dmg, id) => {
    const t = byId.get(id);
    if (t) t.hp -= dmg;
  });

  // Build occupancy of living units (dying ones drop out of collision checks immediately).
  const occupancy = new Map<string, Unit>();
  for (const u of working) {
    if (u.hp > 0) occupancy.set(HexUtils.key(u.tacticalHex), u);
  }

  // Bucket living units by group.
  const groupsByKey = new Map<string, Unit[]>();
  for (const u of working) {
    if (u.hp <= 0) continue;
    const k = groupOrderKey(u.team, u.groupId);
    const arr = groupsByKey.get(k);
    if (arr) arr.push(u);
    else groupsByKey.set(k, [u]);
  }

  // Orders Map mutations (charge countdown, mode auto-revert) are written through this
  // lazy clone so we only allocate when something actually changes.
  let ordersOut: Map<string, GroupOrder> = orders;
  const writeOrder = (key: string, next: GroupOrder) => {
    if (ordersOut === orders) ordersOut = new Map(orders);
    ordersOut.set(key, next);
  };

  // Cooldown helpers. Cooldown is checked ONCE per tick at the start of each unit's
  // movement attempt — not between charge sub-steps — so charge can still cover
  // CHARGE_SPEED_HEXES hexes within a single tick even after writing its own cooldown.
  const isOnCooldown = (u: Unit): boolean => config.currentTick < u.nextMoveTick;
  // Penalty in extra ticks when entering `hex`. Charge halves the entry moveCost (floor)
  // so momentum partially overrides terrain.
  const entryPenalty = (hex: Hex, isCharge: boolean): number => {
    const cost = config.mapApi.getTerrainMods(hex).moveCost;
    return isCharge ? Math.floor(cost / 2) : cost;
  };
  // Write the cooldown that will block the unit's NEXT tick movement attempt.
  const applyEntryCooldown = (u: Unit, hex: Hex, isCharge: boolean): void => {
    u.nextMoveTick = config.currentTick + 1 + entryPenalty(hex, isCharge);
  };

  // Rigid-block helper: validate every unit's projected position; commit all-or-nothing.
  // Used by 'march' and 'retreat'. Returns true on commit, false if blocked.
  // Blocks when ANY unit is still on cooldown — the block moves as one or not at all.
  const tryRigidBlockStep = (groupUnits: Unit[], delta: Hex): boolean => {
    if (groupUnits.some(isOnCooldown)) return false;
    const groupIds = new Set(groupUnits.map(u => u.id));
    const projected: { unit: Unit; next: Hex }[] = [];
    for (const u of groupUnits) {
      const next: Hex = { q: u.tacticalHex.q + delta.q, r: u.tacticalHex.r + delta.r };
      if (!config.mapApi.isInside(next) || !config.mapApi.isWalkable(next)) return false;
      const occupant = occupancy.get(HexUtils.key(next));
      if (occupant && !groupIds.has(occupant.id)) return false;
      projected.push({ unit: u, next });
    }
    for (const u of groupUnits) occupancy.delete(HexUtils.key(u.tacticalHex));
    for (const p of projected) {
      p.unit.tacticalHex = p.next;
      p.unit.state = 'moving';
      applyEntryCooldown(p.unit, p.next, false);
      occupancy.set(HexUtils.key(p.next), p.unit);
    }
    return true;
  };

  // Per-group motion dispatch.
  for (const [key, groupUnits] of groupsByKey) {
    const order = orders.get(key);
    if (!order?.attackTarget) continue;
    if (order.hold) continue;

    const mode = order.mode ?? 'march';

    if (mode === 'march') {
      if (groupUnits.some(u => u.state === 'fighting')) continue;
      tryRigidBlockStep(groupUnits, HexUtils.directions[order.heading]);
    } else if (mode === 'retreat') {
      // Disengage allowed: do NOT skip on 'fighting'. Opposite of heading.
      tryRigidBlockStep(groupUnits, HexUtils.directions[(order.heading + 3) % 6]);
    } else if (mode === 'unleash') {
      // Per-unit greedy step toward an enemy, with engagement spreading and a lateral
      // fallback that breaks ally jams. Combat phase already handled adjacency damage;
      // here we only do movement.
      const enemies = working.filter(u => u.hp > 0 && u.team !== groupUnits[0].team);
      if (enemies.length === 0) continue;

      // Base engagement: allies of this group already adjacent to each enemy at the
      // start of the tick. Cap-aware target pick subtracts this from the slots
      // available, so a heavily-engaged enemy doesn't keep attracting new attackers.
      const groupTeam = groupUnits[0].team;
      const baseEngagement = new Map<string, number>();
      for (const e of enemies) {
        let count = 0;
        for (const n of HexUtils.getNeighbors(e.tacticalHex)) {
          const occ = occupancy.get(HexUtils.key(n));
          if (occ && occ.team === groupTeam) count++;
        }
        baseEngagement.set(e.id, count);
      }
      const claimsThisTick = new Map<string, number>();

      for (const u of groupUnits) {
        if (u.hp <= 0) continue;
        if (isOnCooldown(u)) continue;

        // First pass: pick the closest enemy whose engagement (baseline + already-
        // claimed-this-tick) is still below the cap. Spreads new attackers across
        // less-crowded enemies instead of piling on the nearest one.
        let target: Unit | null = null;
        let bestD = Infinity;
        for (const e of enemies) {
          const total = (baseEngagement.get(e.id) ?? 0) + (claimsThisTick.get(e.id) ?? 0);
          if (total >= UNLEASH_MAX_ENGAGERS) continue;
          const d = HexUtils.distance(u.tacticalHex, e.tacticalHex);
          if (d < bestD || (d === bestD && (target === null || e.id < target.id))) {
            target = e;
            bestD = d;
          }
        }
        // Fallback: every enemy is at the cap → take absolute closest. The unit still
        // engages and helps absorb attention; better than freezing.
        if (!target) {
          for (const e of enemies) {
            const d = HexUtils.distance(u.tacticalHex, e.tacticalHex);
            if (d < bestD || (d === bestD && (target === null || e.id < target.id))) {
              target = e;
              bestD = d;
            }
          }
        }
        if (!target) continue;
        claimsThisTick.set(target.id, (claimsThisTick.get(target.id) ?? 0) + 1);

        // Best neighbor minimizing distance to target.
        let bestNext: Hex | null = null;
        let bestNextD = bestD;
        for (const dir of HexUtils.directions) {
          const next: Hex = { q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r };
          const d = HexUtils.distance(next, target.tacticalHex);
          if (d >= bestNextD) continue;
          if (!config.mapApi.isInside(next) || !config.mapApi.isWalkable(next)) continue;
          const occupant = occupancy.get(HexUtils.key(next));
          if (occupant) continue;
          bestNext = next;
          bestNextD = d;
        }
        // Lateral fallback: if no strict-decrease neighbor (blocked by allies, usually),
        // try equal-distance neighbors that aren't the unit's previous hex (anti-
        // backtrack). Lowest-key tiebreak for determinism.
        if (!bestNext) {
          const prev = u.prevTacticalHex;
          let bestLat: Hex | null = null;
          let bestLatKey: string | null = null;
          for (const dir of HexUtils.directions) {
            const next: Hex = { q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r };
            if (!config.mapApi.isInside(next) || !config.mapApi.isWalkable(next)) continue;
            if (occupancy.get(HexUtils.key(next))) continue;
            if (prev && next.q === prev.q && next.r === prev.r) continue;
            const d = HexUtils.distance(next, target.tacticalHex);
            if (d !== bestD) continue;
            const nk = HexUtils.key(next);
            if (bestLatKey === null || nk < bestLatKey) {
              bestLat = next;
              bestLatKey = nk;
            }
          }
          bestNext = bestLat;
        }
        if (bestNext) {
          occupancy.delete(HexUtils.key(u.tacticalHex));
          u.prevTacticalHex = { q: u.tacticalHex.q, r: u.tacticalHex.r };
          u.tacticalHex = bestNext;
          u.state = 'moving';
          applyEntryCooldown(u, bestNext, false);
          occupancy.set(HexUtils.key(bestNext), u);
        }
      }
    } else if (mode === 'charge') {
      const delta = HexUtils.directions[order.heading];
      // Per-charge "already lanced" set: each enemy can be hit at most once per charge
      // cycle. Without this, the lance re-fires every sub-step and stacks damage on an
      // enemy as the unit closes in (effectively eternal damage).
      const damaged = new Set(order.chargeDamagedIds ?? []);
      // Snapshot which units are cooldown-blocked AT START of this tick. Cooldown is a
      // next-tick gate, not a within-tick gate — so once a charging unit starts moving
      // this tick, its own freshly-written cooldown does NOT prevent later sub-steps
      // within the same tick. A unit cooldown-blocked at start sits out the whole charge
      // tick (it can still apply impact damage from its current position, mirroring how
      // a non-charging straggler still threatens its arc).
      const chargeBlocked = new Set(groupUnits.filter(isOnCooldown).map(u => u.id));
      for (let step = 0; step < CHARGE_SPEED_HEXES; step++) {
        // Step forward-most unit first, so a rear unit's check of occupancy.get(next)
        // happens AFTER any ally ahead of it has attempted its own step (and either
        // moved, freeing the hex, or stayed put as a genuine spatial blocker). Without
        // this spatial-order sort, the per-unit advance ends up array-order-dependent:
        // a rear unit can be ally-blocked by a forward unit that hasn't moved yet this
        // sub-step, costing it a hex of travel and producing fake stragglers.
        // Projection q*delta.q + r*delta.r is monotonic along the charge direction.
        const stepOrder = [...groupUnits].sort((a, b) =>
          (b.tacticalHex.q * delta.q + b.tacticalHex.r * delta.r)
          - (a.tacticalHex.q * delta.q + a.tacticalHex.r * delta.r)
        );
        for (const u of stepOrder) {
          if (u.hp <= 0) continue;
          if (chargeBlocked.has(u.id)) continue;
          const next: Hex = { q: u.tacticalHex.q + delta.q, r: u.tacticalHex.r + delta.r };
          if (!config.mapApi.isInside(next) || !config.mapApi.isWalkable(next)) continue;
          const occupant = occupancy.get(HexUtils.key(next));
          // Any occupant blocks (enemy or ally that already chose not to move this
          // sub-step). With spatial-order iteration above, the ally-block degenerates
          // into the correct straggler-behind-blocker chain.
          if (occupant) continue;
          occupancy.delete(HexUtils.key(u.tacticalHex));
          u.tacticalHex = next;
          u.state = 'moving';
          // Overwrite each substep so the cooldown carried to the next tick reflects the
          // unit's FINAL hex this tick — the terrain it's standing on after the charge.
          applyEntryCooldown(u, next, true);
          occupancy.set(HexUtils.key(next), u);
        }
        // Impact damage: each charging unit lances CHARGE_IMPACT_RANGE hexes ahead, but
        // skips any enemy already lanced earlier in this charge.
        for (const u of groupUnits) {
          if (u.hp <= 0) continue;
          for (let i = 1; i <= CHARGE_IMPACT_RANGE; i++) {
            const hex: Hex = { q: u.tacticalHex.q + delta.q * i, r: u.tacticalHex.r + delta.r * i };
            const target = occupancy.get(HexUtils.key(hex));
            if (!target || target.team === u.team) continue;
            if (damaged.has(target.id)) continue;
            target.hp -= CHARGE_IMPACT_DAMAGE;
            damaged.add(target.id);
            if (target.hp <= 0) occupancy.delete(HexUtils.key(hex));
          }
        }
      }
      // Decrement charge countdown; persist damaged-ids; revert to march on expiry.
      const remaining = (order.chargeTicksRemaining ?? CHARGE_DURATION_TICKS) - 1;
      if (remaining <= 0) {
        writeOrder(key, {
          ...order, mode: 'march',
          chargeTicksRemaining: undefined, chargeDamagedIds: undefined,
        });
      } else {
        writeOrder(key, {
          ...order,
          chargeTicksRemaining: remaining,
          chargeDamagedIds: Array.from(damaged),
        });
      }
    } else if (mode === 'defendHeight') {
      const result = computeDefendFormation(groupUnits, order, config);
      if (!result) continue;
      const { rank } = result;

      // Sticky path: if the order carries a pre-computed `defendAssignments` (set by the
      // canvas at commitDefend time), use it directly. This avoids the per-tick re-pair
      // that previously caused units to oscillate when their projected index shifted as
      // they moved. Fall back to the freshly computed assignment when no sticky map is
      // present (legacy / first-tick orders).
      let assignment: Map<string, Hex>;
      if (order.defendAssignments) {
        assignment = new Map<string, Hex>();
        for (const [id, hex] of Object.entries(order.defendAssignments)) {
          assignment.set(id, hex);
        }
      } else {
        assignment = result.assignment;
      }

      const liveUnits = groupUnits.filter(u => u.hp > 0);

      // Process units in DESCENDING order of their assigned slot's rank — deep-rank
      // targets (rank 2+, interior) move first within a tick, so they can traverse
      // through still-empty border hexes before front-targeted units claim them.
      const processOrder = [...liveUnits].sort((a, b) => {
        const aTarget = assignment.get(a.id);
        const bTarget = assignment.get(b.id);
        const aRank = aTarget ? (rank.get(HexUtils.key(aTarget)) ?? 0) : 0;
        const bRank = bTarget ? (rank.get(HexUtils.key(bTarget)) ?? 0) : 0;
        if (aRank !== bRank) return bRank - aRank;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      // Per-unit step: walk one hex toward the assigned slot. First try strict-decrease
      // neighbor (current behavior). If blocked (no strict decrease available — usually
      // because allies occupy the closer hexes), try a LATERAL step (same distance to
      // target) that isn't the unit's previous-tick position. The lateral fallback breaks
      // crowd-jam stalls; the anti-backtrack guard prevents A→B→A→B oscillation across
      // ticks. Lowest-key tiebreak among lateral candidates for determinism.
      for (const u of processOrder) {
        const target = assignment.get(u.id);
        if (!target) continue;
        if (target.q === u.tacticalHex.q && target.r === u.tacticalHex.r) continue;
        if (isOnCooldown(u)) continue;

        // "Formation footprint" = blob + back-rank extension (both live in `rank`).
        // If currently inside the footprint, only step within it — preserves tight
        // formation. Outside-footprint units (still marching in) move freely.
        const onFormation = rank.has(HexUtils.key(u.tacticalHex));
        const curD = HexUtils.distance(u.tacticalHex, target);
        let bestNext: Hex | null = null;
        let bestNextD = curD;
        for (const dir of HexUtils.directions) {
          const next: Hex = { q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r };
          if (onFormation && !rank.has(HexUtils.key(next))) continue;
          if (!config.mapApi.isInside(next)) continue;
          if (!config.mapApi.isWalkable(next)) continue;
          if (occupancy.get(HexUtils.key(next))) continue;
          const d = HexUtils.distance(next, target);
          if (d >= bestNextD) continue;
          bestNext = next; bestNextD = d;
        }
        if (!bestNext) {
          // Lateral fallback.
          const prev = u.prevTacticalHex;
          let bestLat: Hex | null = null;
          let bestLatKey: string | null = null;
          for (const dir of HexUtils.directions) {
            const next: Hex = { q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r };
            if (onFormation && !rank.has(HexUtils.key(next))) continue;
            if (!config.mapApi.isInside(next)) continue;
            if (!config.mapApi.isWalkable(next)) continue;
            if (occupancy.get(HexUtils.key(next))) continue;
            if (prev && next.q === prev.q && next.r === prev.r) continue;
            const d = HexUtils.distance(next, target);
            if (d !== curD) continue;
            const nk = HexUtils.key(next);
            if (bestLatKey === null || nk < bestLatKey) {
              bestLat = next;
              bestLatKey = nk;
            }
          }
          bestNext = bestLat;
        }
        if (bestNext) {
          occupancy.delete(HexUtils.key(u.tacticalHex));
          u.prevTacticalHex = { q: u.tacticalHex.q, r: u.tacticalHex.r };
          u.tacticalHex = bestNext;
          u.state = 'moving';
          applyEntryCooldown(u, bestNext, false);
          occupancy.set(HexUtils.key(bestNext), u);
        }
      }
    }
  }

  // End-of-tick phase. Two effects, run after damage + movement resolve:
  //   1. Attrition: hostile terrain (RIVER, ROCKY, HILL) drains HP. Routed through the
  //      same accumulator + apply pattern as combat damage so the death path is shared
  //      (groups can dissolve from attrition alone if they sit on bad ground).
  //   2. Vision refresh: each living unit's `visionRadius` is set from its current hex's
  //      terrain. Data-only this pass — no consumer reads it yet.
  // Units that die during attrition are filtered out of the returned `units` below.
  const attritionDamage = new Map<string, number>();
  for (const u of working) {
    if (u.hp <= 0) continue;
    const mods = config.mapApi.getTerrainMods(u.tacticalHex);
    if (mods.attritionPerTick > 0) {
      attritionDamage.set(u.id, (attritionDamage.get(u.id) ?? 0) + mods.attritionPerTick);
    }
    u.visionRadius = mods.visionRadius;
  }
  attritionDamage.forEach((dmg, id) => {
    const t = byId.get(id);
    if (t) t.hp -= dmg;
  });

  return { units: working.filter(u => u.hp > 0), orders: ordersOut };
};
