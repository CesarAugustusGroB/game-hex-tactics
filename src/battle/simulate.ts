import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { heightDamageBonus, type TerrainMods } from './terrain';

export type Team = 'red' | 'blue';
export type GroupId = 1 | 2 | 3;
export type UnitState = 'idle' | 'moving' | 'fighting';
export type FormationType = 'hex' | 'line' | 'wedge' | 'column';
/** Distinguishes the unit roles. Per-type tunables (speed, max HP, charge damage, missile
 *  range) live in the *_BY_TYPE records below.
 *  - infantry:    baseline foot. 1 hex/tick, 100 HP.
 *  - cavalry:     2 hex/tick on march, 3 on charge. 60 HP. 2× lance impact.
 *  - skirmisher:  1.5 hex/tick (alternates 1/2 per tick). 40 HP. Throws a javelin at the
 *                 closest enemy within 3 hexes if NOT in melee — see ranged phase. Weak
 *                 in melee and on charge.
 *  Mixed groups take the slowest unit's speed for free (the rigid-block step waits on
 *  every unit; the multi-step loop bound is `Math.min` over the group). */
export type UnitType = 'infantry' | 'cavalry' | 'skirmisher';

export interface Unit {
  id: string;
  team: Team;
  /** Infantry (default) or cavalry. Optional in the type for forgiving deserialization
   *  during hot-reload of pre-feature state; every consumer falls back to 'infantry' via
   *  `u.unitType ?? 'infantry'`. */
  unitType?: UnitType;
  tacticalHex: Hex;
  homeHex: Hex;
  groupId: GroupId;
  hp: number;
  state: UnitState;
  /** Position the unit occupied at the start of the most recent tick during which it
   *  moved. Used by `unleash`'s lateral fallback to avoid backtracking (so a unit that
   *  side-stepped tick N doesn't immediately step back to its previous hex tick N+1,
   *  which would oscillate). Optional — undefined for units that have never moved. */
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
  /** Persistent unleash lock. Set the first sub-step a target is acquired; cleared when
   *  resolved (enemy `hp <= 0` for `kind: 'enemy'`; any ally occupying the hex for
   *  `kind: 'hex'`). Survives across ticks via the unit object identity, so a charging
   *  cavalry stays committed instead of flip-flopping between equidistant enemies. */
  unleashTarget?:
    | { kind: 'enemy'; id: string }
    | { kind: 'hex'; q: number; r: number };
}

/**
 * Player-selectable motion modes layered on top of an active attack order.
 * - 'march'   : rigid-block advance, all-or-nothing, combat freezes the block. (HUD label = ADVANCE.)
 * - 'hold'    : stand still and accrue defensive damage reduction. Counter `holdTicks`
 *               increments each tick; reduction = min(holdTicks * HOLD_REDUCTION_PER_TICK,
 *               HOLD_REDUCTION_CAP). When holdTicks reaches HOLD_AUTO_IDLE_AFTER_TICKS the
 *               mode auto-flips to 'idle' and the counter clears (defensive ceiling).
 * - 'idle'    : stand still, no movement, no defensive bonus.
 * - 'charge'  : per-unit advance at CHARGE_SPEED_HEXES per tick for CHARGE_DURATION_TICKS
 *               ticks; stragglers get left behind; deals impact damage in a 3-hex lance.
 * - 'retreat' : rigid-block advance in team-absolute backward direction (red→S, blue→N),
 *               ignores 'fighting' state so the block can disengage. Auto-clears the order
 *               when the group lands fully back in its deploy zone. One-way commit.
 * - 'unleash' : break formation; each unit greedily steps toward its nearest enemy. Sets
 *               `committed=true` — group is locked out of further orders until retreat
 *               returns it home.
 */
export type OrderMode = 'march' | 'hold' | 'idle' | 'charge' | 'retreat' | 'unleash';

export interface GroupOrder {
  team: Team;
  groupId: GroupId;
  attackTarget: Hex | null;
  /** Snapped 0..5 hex direction. UI clamps to the team's forward cone (red:{NW,N,NE},
   *  blue:{SW,S,SE}); retreat ignores it and uses the team-absolute backward direction. */
  heading: number;
  /** Player-selected motion mode. Undefined = 'march' (default). */
  mode?: OrderMode;
  /** Ticks the group has been in 'hold' mode. Drives the per-tick damage reduction
   *  computed in the combat phase. Reset to undefined whenever mode leaves 'hold'
   *  (including the auto-transition to 'idle' at the cap). */
  holdTicks?: number;
  /** Set when mode='charge' is engaged; counts down to 0, then mode reverts to 'march'.
   *  HOLD pauses the countdown (so a charge can be paused and resumed intact). */
  chargeTicksRemaining?: number;
  /** Enemy unit ids already hit by this group's lance during the current charge. Each
   *  enemy takes impact damage at most ONCE per charge — the lance is a one-shot impact
   *  on contact, not a sustained beam that re-damages as the unit advances. Cleared when
   *  the charge ends. */
  chargeDamagedIds?: string[];
  /** Lifecycle lock. Set true when the player commits via `unleash`; once committed, the
   *  UI rejects all order changes except `mode: 'retreat'`. Cleared by the sim when the
   *  retreating group lands every living unit back inside its team's deploy zone (so the
   *  player may issue a fresh order on the redeployed group). */
  committed?: boolean;
}

export interface MapApi {
  /** Whether the hex is on the playable grid. */
  isInside(hex: Hex): boolean;
  /** Whether terrain at the hex permits unit occupation. */
  isWalkable(hex: Hex): boolean;
  /** Terrain key at the given hex (e.g. 'HILL', 'GRASSLAND'), or undefined if off-map. */
  getTerrainType(hex: Hex): string | undefined;
  /** Mechanical mods (defenseMult / moveCost / attritionPerTick / visionRadius) for the
   *  terrain at this hex. Off-map / unknown terrain returns neutral defaults. Sim reads
   *  through this method so the same code path works in-engine and in the harness. */
  getTerrainMods(hex: Hex): TerrainMods;
  /** Terrain elevation at the given hex, in the same height units as `TerrainDef.height`.
   *  Used by the damage step to compute the downhill attack bonus. Off-map hexes return
   *  0 (no bonus, no penalty). */
  getTerrainHeight(hex: Hex): number;
  /** Whether the given hex belongs to the team's deploy zone. The sim queries this on
   *  every retreat tick to decide when a retreating group has "safely returned home" —
   *  at which point the order is cleared and the group becomes re-orderable. */
  isInDeployZone(team: Team, hex: Hex): boolean;
}

export interface SimulationConfig {
  damagePerTick: number;
  mapApi: MapApi;
  /** Monotonic tick counter supplied by the caller (the GameCanvas setInterval / the
   *  harness loop). Used by movement to compare against each unit's `nextMoveTick`
   *  cooldown. Callers must increment this each tick; the sim itself is stateless. */
  currentTick: number;
  /** Capture-zone hexes (the 7-hex flower at the centre of the tactical map). When
   *  provided, units in `unleash` mode consider unoccupied-by-friendly capture hexes
   *  alongside enemies when picking a target. Omitted in the harness → unleash falls
   *  back to enemies-only behaviour, preserving existing regression scenarios. */
  captureZone?: ReadonlyArray<Hex>;
}

/** A projectile thrown during this tick, surfaced to the renderer for animation. The sim
 *  itself only records the event — damage was already applied in the combat phase. The
 *  canvas spawns a sprite that tweens fromHex → toHex over a sub-tick duration. */
export interface Projectile {
  fromHex: Hex;
  toHex: Hex;
  attackerId: string;
  targetId: string;
}

export interface SimulationResult {
  units: Unit[];
  /** Reference-equal to the input orders Map when no order needed mutation this tick,
   *  so React `setGroupOrders(result.orders)` is a cheap no-op when nothing changed. */
  orders: Map<string, GroupOrder>;
  /** Ranged attacks fired this tick. Empty when no skirmisher threw. The renderer reads
   *  this each tick; consumers that don't draw projectiles (the sim harness) ignore it. */
  projectiles: Projectile[];
}

/** CHARGE tuning. Duration in ticks; at TICK_MS=500 this is 1.5s real-time. */
export const CHARGE_DURATION_TICKS = 3;
export const CHARGE_IMPACT_RANGE = 2;

/** Per-unit-type hexes advanced per tick on march/retreat/unleash. Mixed groups march at
 *  the GROUP MIN — `Math.min(...groupUnits.map(u => MARCH_HEXES_PER_TICK[u.unitType]))`.
 *  Fractional values (skirmisher 1.5) resolve to alternating integer steps per tick via
 *  `stepsForTick(speed, currentTick)` so the rigid-block step stays integer-axial. */
export const MARCH_HEXES_PER_TICK: Record<UnitType, number> = {
  infantry: 2,
  cavalry: 4,
  skirmisher: 3,
};

/** Per-unit-type hexes advanced per tick during a CHARGE. Same group-min rule as
 *  `MARCH_HEXES_PER_TICK`: mixed cavalry+infantry charge runs at infantry speed.
 *  Skirmisher charges at infantry pace — "no shock bonus." */
export const CHARGE_HEXES_PER_TICK: Record<UnitType, number> = {
  infantry: 4,
  cavalry: 6,
  skirmisher: 4,
};

/** Lance impact damage on a single enemy per CHARGE pass, keyed by the ATTACKER's type.
 *  Each enemy is hit at most once per charge cycle (`chargeDamagedIds` tracks that). */
export const CHARGE_IMPACT_DAMAGE_BY_TYPE: Record<UnitType, number> = {
  infantry: 10,
  cavalry: 20,
  skirmisher: 5,
};

/** Per-unit-type spawn HP. Cavalry is glass-fragile; skirmisher even more so. Used by
 *  `paintPlace` in the engine and by the HP-bar denominator in `drawUnits`. */
export const MAX_HP_BY_TYPE: Record<UnitType, number> = {
  infantry: 100,
  cavalry: 60,
  skirmisher: 40,
};

/** Max axial distance a skirmisher can throw a javelin. Pure radius — no line-of-sight
 *  blocking by terrain, consistent with the vision model. */
export const SKIRMISHER_MISSILE_RANGE = 3;
/** Damage of one javelin hit. Defender's `defenseMult` still applies (terrain cover
 *  works against missiles). One throw per skirmisher per tick, ONLY when not in melee. */
export const SKIRMISHER_MISSILE_DAMAGE = 5;
/** Hit-and-run trigger distance. In `unleash`, a skirmisher within this many hexes of
 *  its closest enemy switches from "approach in cone" to "kite (any direction, max
 *  distance)". At MISSILE_RANGE - 1 step beyond this, the skirmisher stands still and
 *  the combat phase throws the javelin. */
export const SKIRMISHER_KITE_THRESHOLD = 2;

/** Resolve a fractional per-tick speed (e.g. 1.5) to integer hexes for THIS tick using a
 *  difference-of-floors. Guarantees the long-run average equals `speed` while staying
 *  integer per tick: 1.5 → 1, 2, 1, 2, ... ; 1.0 → 1, 1, 1, ... ; 2.0 → 2, 2, 2, ... */
export const stepsForTick = (speed: number, tick: number): number =>
  Math.floor((tick + 1) * speed) - Math.floor(tick * speed);

/** UNLEASH engagement cap: max allies attacking a single enemy at once. Above the cap,
 *  new units pick a less-crowded enemy instead of dogpiling. 3 covers a clean half-arc
 *  (a hex has 6 neighbors, 3 from one side is plenty). If every enemy is at the cap,
 *  units fall back to closest-overall so they still engage. */
export const UNLEASH_MAX_ENGAGERS = 3;

/** Hold-mode defensive bonus: each tick spent in `hold` adds `HOLD_REDUCTION_PER_TICK`
 *  to the damage-taken reduction, capped at `HOLD_REDUCTION_CAP`. After
 *  `HOLD_AUTO_IDLE_AFTER_TICKS` ticks the bonus is at the cap and the sim flips the
 *  group to `idle` (counter clears, no more bonus). Player has to re-engage hold from
 *  scratch to rebuild the bonus. */
export const HOLD_REDUCTION_PER_TICK = 0.05;
export const HOLD_REDUCTION_CAP = 0.40;
export const HOLD_AUTO_IDLE_AFTER_TICKS = 8;
export const holdReduction = (holdTicks: number): number =>
  Math.min(holdTicks * HOLD_REDUCTION_PER_TICK, HOLD_REDUCTION_CAP);

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

// Flat-top direction indices: 0=SE, 1=NE, 2=N, 3=NW, 4=SW, 5=S (see HEADING_ARROWS).
// Red deploys south, attacks north → forward cone = {NE, N, NW}.
// Blue deploys north, attacks south → forward cone = {SE, S, SW}.
const FORWARD_CONE_RED  = new Set<number>([1, 2, 3]);
const FORWARD_CONE_BLUE = new Set<number>([0, 4, 5]);

/** The 3 hex directions a team is allowed to advance / charge / unleash into. */
export const forwardCone = (team: Team): Set<number> =>
  team === 'red' ? FORWARD_CONE_RED : FORWARD_CONE_BLUE;

/** The single hex direction a team retreats into (team-absolute, NOT heading-relative). */
export const backwardDir = (team: Team): number => team === 'red' ? 5 : 2;

/** Returns the in-cone direction nearest to `heading`, picked by maximizing the dot
 *  product between the two directions' pixel vectors. Used to snap drag-derived
 *  headings to the legal cone. */
export const snapToForwardCone = (team: Team, heading: number): number => {
  const cone = forwardCone(team);
  if (cone.has(heading)) return heading;
  const src = HexUtils.hexToPixel(HexUtils.directions[heading]);
  let bestIdx = -1;
  let bestDot = -Infinity;
  for (const idx of cone) {
    const d = HexUtils.hexToPixel(HexUtils.directions[idx]);
    const dot = src.x * d.x + src.y * d.y;
    if (dot > bestDot) { bestDot = dot; bestIdx = idx; }
  }
  return bestIdx === -1 ? heading : bestIdx;
};

// Visual left → right cycle order for each team's cone. Used by the A-key / HUD button
// to step through the 3 valid forward headings (replaces the old E↔W mirror, which
// can't apply when only 3 directions are legal).
const CONE_CYCLE_RED:  number[] = [3, 2, 1]; // NW → N → NE
const CONE_CYCLE_BLUE: number[] = [4, 5, 0]; // SW → S → SE

/** Returns the next-in-cycle forward heading for this team. Snaps `heading` into the
 *  cone first if needed, then advances by one visual position (wrapping). */
export const cycleConeHeading = (team: Team, heading: number): number => {
  const cycle = team === 'red' ? CONE_CYCLE_RED : CONE_CYCLE_BLUE;
  const cur = snapToForwardCone(team, heading);
  const idx = cycle.indexOf(cur);
  return cycle[(idx + 1) % cycle.length];
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
): { slots: Hex[]; headingForward: number; frontWidth: number } => {
  if (count <= 0) return { slots: [], headingForward: 0, frontWidth: 0 };
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
  return { slots, headingForward, frontWidth: w };
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
 * March-projection ranking shared by all deploy-time pairing functions. Projects each
 * unit onto the march axis (group centroid → target) and returns unit indices sorted
 * descending — the frontmost unit (closest to target along the march vector) comes first.
 * Lateral position is the tiebreak, unit id is the final deterministic tiebreak. Pure.
 */
const projectedRanking = (units: Unit[], target: Hex): number[] => {
  if (units.length === 0) return [];
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
  return ranked.map(r => r.ui);
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
  const ranked = projectedRanking(units, target);
  for (let i = 0; i < ranked.length && i < slots.length; i++) {
    result.set(units[ranked[i]].id, slots[i]);
  }
  return result;
};

/**
 * LINE-formation pairing that respects unit role. Used at deploy time when the formation
 * is `line`. Slot index 0..frontWidth-1 is the front rank; frontWidth..2·frontWidth-1 is
 * the second rank; etc. Per-type preferences:
 *   - cavalry    → front-rank flanks first (outside-in), then flanks of subsequent ranks
 *   - skirmisher → front-rank center first (center-out), then center of subsequent ranks
 *   - infantry   → rank 1, rank 2, ..., last rank (left-to-right per rank), then rank 0
 * Within a type, units are taken in projection order (frontmost-first) so a type's
 * "leader" lands on its highest-priority slot. Overflow inside a type spills into any
 * remaining unused slot, in slot-index order. Processing order is fixed: cavalry, then
 * skirmishers, then infantry — so infantry overflow can't displace skirmishers from the
 * front-rank center.
 */
export const computeLineSlotAssignmentsByType = (
  units: Unit[],
  slots: Hex[],
  target: Hex,
  frontWidth: number,
): Map<string, Hex> => {
  const result = new Map<string, Hex>();
  if (units.length === 0 || slots.length === 0 || frontWidth <= 0) return result;

  const rankedUis = projectedRanking(units, target);
  const buckets: Record<UnitType, string[]> = { infantry: [], cavalry: [], skirmisher: [] };
  for (const ui of rankedUis) {
    const t = units[ui].unitType ?? 'infantry';
    buckets[t].push(units[ui].id);
  }

  const totalRanks = Math.ceil(slots.length / frontWidth);
  const flanksOutsideIn = (w: number): number[] => {
    const out: number[] = [];
    let l = 0, r = w - 1;
    while (l <= r) { out.push(l); if (r !== l) out.push(r); l++; r--; }
    return out;
  };
  const centerOut = (w: number): number[] => {
    const mid = Math.floor((w - 1) / 2);
    const out: number[] = [mid];
    for (let d = 1; d <= w; d++) {
      if (mid - d >= 0) out.push(mid - d);
      if (mid + d <= w - 1) out.push(mid + d);
    }
    return out;
  };
  const rankRange = (r: number, w: number): number[] => {
    const start = r * frontWidth;
    const end = Math.min(start + w, slots.length);
    const out: number[] = [];
    for (let i = start; i < end; i++) out.push(i);
    return out;
  };

  const cavPrefs: number[] = [];
  const skirPrefs: number[] = [];
  const infPrefs: number[] = [];
  for (let r = 0; r < totalRanks; r++) {
    const rankStart = r * frontWidth;
    const w = Math.min(frontWidth, slots.length - rankStart);
    cavPrefs.push(...flanksOutsideIn(w).map(i => rankStart + i));
    skirPrefs.push(...centerOut(w).map(i => rankStart + i));
  }
  for (let r = 1; r < totalRanks; r++) {
    const rankStart = r * frontWidth;
    const w = Math.min(frontWidth, slots.length - rankStart);
    infPrefs.push(...rankRange(r, w));
  }
  infPrefs.push(...rankRange(0, Math.min(frontWidth, slots.length)));

  const used = new Set<number>();
  const assignFromPrefs = (ids: string[], prefs: number[]) => {
    let unitIdx = 0;
    for (const slotIdx of prefs) {
      if (unitIdx >= ids.length) return;
      if (used.has(slotIdx)) continue;
      used.add(slotIdx);
      result.set(ids[unitIdx++], slots[slotIdx]);
    }
    // Fallback: drop any remaining units of this type into the first available slots in
    // index order. Triggers only when a type has more units than its preferred ranks hold.
    for (let i = 0; i < slots.length && unitIdx < ids.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      result.set(ids[unitIdx++], slots[i]);
    }
  };

  assignFromPrefs(buckets.cavalry, cavPrefs);
  assignFromPrefs(buckets.skirmisher, skirPrefs);
  assignFromPrefs(buckets.infantry, infPrefs);

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

  // Hold-mode defensive reduction per defender (looked up via team:groupId → order).
  // Computed once here so the per-pair damage loop below doesn't have to re-resolve the
  // order on every hit.
  const holdReductionByUnit = new Map<string, number>();
  for (const u of working) {
    const order = orders.get(groupOrderKey(u.team, u.groupId));
    if (order?.mode === 'hold' && (order.holdTicks ?? 0) > 0) {
      holdReductionByUnit.set(u.id, holdReduction(order.holdTicks ?? 0));
    }
  }

  // Combat phase: each unit attacks. MELEE for anyone with adjacent enemies; RANGED for
  // skirmishers with NO adjacent enemy and at least one enemy within
  // SKIRMISHER_MISSILE_RANGE. A skirmisher engaged in melee drops their javelins and
  // fights hand-to-hand — they don't get to both attack at melee range AND throw.
  // Per-pair melee damage = damagePerTick * (1 + heightBonus) / defenderDefenseMult *
  //   (1 - defenderHoldReduction).
  // Attacker terrain contributes ONLY via the height bonus (offensive lever); defender
  // terrain contributes the cover divisor (defenseMult > 1 = better cover, < 1 = worse)
  // and the hold-mode reduction (defensive stance accrues over time, capped).
  // Missile damage = SKIRMISHER_MISSILE_DAMAGE / defenderDefenseMult * (1 - hold) —
  // same defensive levers, no height bonus (throwing parabolic javelins).
  const damage = new Map<string, number>();
  const projectiles: Projectile[] = [];
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
      const holdRed = holdReductionByUnit.get(target.id) ?? 0;
      const dmg = ((config.damagePerTick * (1 + heightDamageBonus(hAtt, hDef))) / defenseMult) * (1 - holdRed);
      damage.set(target.id, (damage.get(target.id) ?? 0) + dmg);
      u.state = 'fighting';
    } else if ((u.unitType ?? 'infantry') === 'skirmisher') {
      // RANGED: find closest enemy within SKIRMISHER_MISSILE_RANGE. Distance>=2 because
      // distance<=0 is self and distance==1 would have shown up as an adjacent enemy above.
      let target: Unit | null = null;
      let bestD = Infinity;
      for (const e of working) {
        if (e.hp <= 0 || e.team === u.team) continue;
        const d = HexUtils.distance(u.tacticalHex, e.tacticalHex);
        if (d > SKIRMISHER_MISSILE_RANGE) continue;
        if (d < bestD || (d === bestD && (target === null || e.id < target.id))) {
          target = e;
          bestD = d;
        }
      }
      if (target) {
        const defenseMult = config.mapApi.getTerrainMods(target.tacticalHex).defenseMult;
        const holdRed = holdReductionByUnit.get(target.id) ?? 0;
        const dmg = (SKIRMISHER_MISSILE_DAMAGE / defenseMult) * (1 - holdRed);
        damage.set(target.id, (damage.get(target.id) ?? 0) + dmg);
        projectiles.push({
          fromHex: u.tacticalHex,
          toHex: target.tacticalHex,
          attackerId: u.id,
          targetId: target.id,
        });
        // Skirmisher state stays 'idle' — ranged is not melee, march mode still moves
        // them next phase. (Per-tick semantics: throw THEN reposition.)
      }
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
  // `blockedSnapshot`: when provided, the cooldown gate uses the START-OF-TICK set instead
  // of the live `isOnCooldown` predicate. Required for multi-step ticks (cavalry march /
  // unleash) because step-1 writes a cooldown that would otherwise block step-2.
  const tryRigidBlockStep = (
    groupUnits: Unit[],
    delta: Hex,
    blockedSnapshot?: Set<string>,
  ): boolean => {
    const blocked = blockedSnapshot
      ? groupUnits.some(u => blockedSnapshot.has(u.id))
      : groupUnits.some(isOnCooldown);
    if (blocked) return false;
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

    const mode = order.mode ?? 'march';

    if (mode === 'idle') continue;

    if (mode === 'hold') {
      // Stand still + accrue defensive reduction. Combat phase reads `holdTicks` to
      // dampen incoming damage (see damage formula above). When the counter hits the
      // ceiling the order flips to 'idle' and the counter clears.
      const cur = (order.holdTicks ?? 0) + 1;
      if (cur >= HOLD_AUTO_IDLE_AFTER_TICKS) {
        writeOrder(key, { ...order, mode: 'idle', holdTicks: undefined });
      } else {
        writeOrder(key, { ...order, holdTicks: cur });
      }
      continue;
    }

    if (mode === 'march') {
      if (groupUnits.some(u => u.state === 'fighting')) continue;
      // Group march speed = MIN over the group, so mixed cavalry+infantry advances at
      // infantry pace and mixed skirmisher+infantry at infantry pace. `stepsForTick`
      // resolves fractional speed (1.5) to alternating 1/2 hexes per tick. Cooldown is
      // snapshotted at start-of-tick so sub-step 2 isn't blocked by sub-step 1's
      // freshly-written nextMoveTick.
      const groupSpeed = Math.min(
        ...groupUnits.map(u => MARCH_HEXES_PER_TICK[u.unitType ?? 'infantry']),
      );
      const steps = stepsForTick(groupSpeed, config.currentTick);
      const startBlocked = new Set(groupUnits.filter(isOnCooldown).map(u => u.id));
      for (let step = 0; step < steps; step++) {
        if (!tryRigidBlockStep(groupUnits, HexUtils.directions[order.heading], startBlocked)) break;
      }
    } else if (mode === 'retreat') {
      // Disengage allowed: do NOT skip on 'fighting'. Direction is team-absolute backward
      // (red→S, blue→N) regardless of `heading`, since the player's deploy zone is on a
      // fixed edge of the map.
      const groupSpeed = Math.min(
        ...groupUnits.map(u => MARCH_HEXES_PER_TICK[u.unitType ?? 'infantry']),
      );
      const steps = stepsForTick(groupSpeed, config.currentTick);
      const startBlocked = new Set(groupUnits.filter(isOnCooldown).map(u => u.id));
      const retreatDelta = HexUtils.directions[backwardDir(order.team)];
      for (let step = 0; step < steps; step++) {
        if (!tryRigidBlockStep(groupUnits, retreatDelta, startBlocked)) break;
      }
      // Redeploy reset: when every living unit of a retreating group is back in its
      // team's deploy zone, the order is cleared. The group becomes re-orderable as if
      // freshly arrived from the roster pool (committed flag dropped, mode reset).
      const alive = groupUnits.filter(u => u.hp > 0);
      if (alive.length > 0 && alive.every(u => config.mapApi.isInDeployZone(order.team, u.tacticalHex))) {
        writeOrder(key, {
          team: order.team,
          groupId: order.groupId,
          attackTarget: null,
          heading: order.heading,
        });
      }
    } else if (mode === 'unleash') {
      // Each unit holds a persistent lock (`u.unleashTarget`) on either an enemy unit
      // (released when that enemy dies) or a capture-zone hex (released when any ally
      // lands there). When no lock is set, a fresh target is acquired as the closest
      // of (engagement-cap-aware closest enemy) vs (closest unoccupied-by-friendly
      // capture hex). Smaller HexUtils.distance wins; ties → enemy.
      const enemies = working.filter(u => u.hp > 0 && u.team !== groupUnits[0].team);
      const captureHexes = config.captureZone ?? [];
      if (enemies.length === 0 && captureHexes.length === 0) continue;

      // Engagement-cap accounting (enemy targets only): allies of this group already
      // adjacent to each enemy at the start of the tick. New attackers spread across
      // less-crowded enemies instead of piling on the nearest.
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
      // Cooldown snapshot at start-of-tick. Within a tick a cavalry unit takes multiple
      // sub-steps; without the snapshot, sub-step 1's freshly-written nextMoveTick would
      // block sub-step 2. A unit cooldown-blocked at start sits out the WHOLE tick
      // (mirrors charge mode's `chargeBlocked`).
      const unleashStartBlocked = new Set(groupUnits.filter(isOnCooldown).map(u => u.id));

      for (const u of groupUnits) {
        if (u.hp <= 0) continue;
        if (unleashStartBlocked.has(u.id)) continue;

        const unitSpeed = MARCH_HEXES_PER_TICK[u.unitType ?? 'infantry'];
        const unitSteps = stepsForTick(unitSpeed, config.currentTick);
        for (let step = 0; step < unitSteps; step++) {
          // 1. Validate the existing lock — clear it if the target has resolved.
          if (u.unleashTarget?.kind === 'enemy') {
            const lockedEnemy = byId.get(u.unleashTarget.id);
            if (!lockedEnemy || lockedEnemy.hp <= 0) u.unleashTarget = undefined;
          } else if (u.unleashTarget?.kind === 'hex') {
            const occ = occupancy.get(HexUtils.key({ q: u.unleashTarget.q, r: u.unleashTarget.r }));
            if (occ && occ.team === u.team) u.unleashTarget = undefined;
          }

          // 2. Acquire a fresh lock if missing. Closest enemy (cap-aware) vs closest
          //    non-friendly-occupied capture hex; ties broken in favour of enemies.
          if (!u.unleashTarget) {
            let bestEnemy: Unit | null = null;
            let bestEnemyD = Infinity;
            for (const e of enemies) {
              const total = (baseEngagement.get(e.id) ?? 0) + (claimsThisTick.get(e.id) ?? 0);
              if (total >= UNLEASH_MAX_ENGAGERS) continue;
              const d = HexUtils.distance(u.tacticalHex, e.tacticalHex);
              if (d < bestEnemyD || (d === bestEnemyD && (bestEnemy === null || e.id < bestEnemy.id))) {
                bestEnemy = e;
                bestEnemyD = d;
              }
            }
            // Cap-saturated fallback: every enemy is at the cap → take absolute closest.
            // Better to engage at the cap than to freeze.
            if (!bestEnemy) {
              for (const e of enemies) {
                const d = HexUtils.distance(u.tacticalHex, e.tacticalHex);
                if (d < bestEnemyD || (d === bestEnemyD && (bestEnemy === null || e.id < bestEnemy.id))) {
                  bestEnemy = e;
                  bestEnemyD = d;
                }
              }
            }
            let bestHex: Hex | null = null;
            let bestHexD = Infinity;
            for (const h of captureHexes) {
              const occ = occupancy.get(HexUtils.key(h));
              if (occ && occ.team === u.team) continue;
              const d = HexUtils.distance(u.tacticalHex, h);
              if (d < bestHexD) {
                bestHex = { q: h.q, r: h.r };
                bestHexD = d;
              }
            }
            if (bestEnemy && (!bestHex || bestEnemyD <= bestHexD)) {
              u.unleashTarget = { kind: 'enemy', id: bestEnemy.id };
              if (step === 0) claimsThisTick.set(bestEnemy.id, (claimsThisTick.get(bestEnemy.id) ?? 0) + 1);
            } else if (bestHex) {
              u.unleashTarget = { kind: 'hex', q: bestHex.q, r: bestHex.r };
            } else {
              break; // nothing to do this tick.
            }
          }

          // 3. Build a concrete target hex from the lock, used by the movement step.
          const lock = u.unleashTarget!;
          const targetHex: Hex = lock.kind === 'enemy'
            ? byId.get(lock.id)!.tacticalHex
            : { q: lock.q, r: lock.r };
          const bestD = HexUtils.distance(u.tacticalHex, targetHex);

          // 4. Movement. Skirmisher hit-and-run only against an enemy lock (no kite vs
          //    a capture hex — there's no projectile thrower-and-runner target).
          const cone = forwardCone(u.team);
          let bestNext: Hex | null = null;
          let bestNextD = bestD;

          const isSkirm = (u.unitType ?? 'infantry') === 'skirmisher';
          if (lock.kind === 'enemy' && isSkirm && bestD > SKIRMISHER_KITE_THRESHOLD && bestD <= SKIRMISHER_MISSILE_RANGE) {
            break; // stand still — combat phase throws the javelin.
          }
          if (lock.kind === 'enemy' && isSkirm && bestD <= SKIRMISHER_KITE_THRESHOLD) {
            const prev = u.prevTacticalHex;
            let bestRunD = bestD;
            for (const dir of HexUtils.directions) {
              const next: Hex = { q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r };
              if (!config.mapApi.isInside(next) || !config.mapApi.isWalkable(next)) continue;
              if (occupancy.get(HexUtils.key(next))) continue;
              if (prev && next.q === prev.q && next.r === prev.r) continue;
              const d = HexUtils.distance(next, targetHex);
              if (d <= bestRunD) continue;
              bestNext = next;
              bestRunD = d;
            }
            if (!bestNext) break;
            occupancy.delete(HexUtils.key(u.tacticalHex));
            u.prevTacticalHex = { q: u.tacticalHex.q, r: u.tacticalHex.r };
            u.tacticalHex = bestNext;
            u.state = 'moving';
            applyEntryCooldown(u, bestNext, false);
            occupancy.set(HexUtils.key(bestNext), u);
            continue;
          }

          // Cone-bounded approach: best neighbor that strictly decreases distance.
          for (const idx of cone) {
            const dir = HexUtils.directions[idx];
            const next: Hex = { q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r };
            const d = HexUtils.distance(next, targetHex);
            if (d >= bestNextD) continue;
            if (!config.mapApi.isInside(next) || !config.mapApi.isWalkable(next)) continue;
            if (occupancy.get(HexUtils.key(next))) continue;
            bestNext = next;
            bestNextD = d;
          }
          // Lateral fallback: equal-distance neighbor (anti-backtrack, deterministic).
          if (!bestNext) {
            const prev = u.prevTacticalHex;
            let bestLat: Hex | null = null;
            let bestLatKey: string | null = null;
            for (const idx of cone) {
              const dir = HexUtils.directions[idx];
              const next: Hex = { q: u.tacticalHex.q + dir.q, r: u.tacticalHex.r + dir.r };
              if (!config.mapApi.isInside(next) || !config.mapApi.isWalkable(next)) continue;
              if (occupancy.get(HexUtils.key(next))) continue;
              if (prev && next.q === prev.q && next.r === prev.r) continue;
              const d = HexUtils.distance(next, targetHex);
              if (d !== bestD) continue;
              const nk = HexUtils.key(next);
              if (bestLatKey === null || nk < bestLatKey) {
                bestLat = next;
                bestLatKey = nk;
              }
            }
            bestNext = bestLat;
          }
          if (!bestNext) break;
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
      // Group charge speed = MIN over the group. Mixed cavalry+infantry charges at
      // infantry speed (2); pure cavalry sprints at 3. Using MIN (not MAX) keeps
      // infantry's lance from firing phantom hits from a final hex while cavalry races
      // on ahead. `stepsForTick` here is a no-op (all charge speeds are integers) but
      // kept for symmetry with march/unleash.
      const groupChargeSpeed = Math.min(
        ...groupUnits.map(u => CHARGE_HEXES_PER_TICK[u.unitType ?? 'infantry']),
      );
      const chargeSteps = stepsForTick(groupChargeSpeed, config.currentTick);
      for (let step = 0; step < chargeSteps; step++) {
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
            // Lance damage is keyed by the ATTACKER's type — cavalry's lance hits twice
            // as hard regardless of who it spears.
            target.hp -= CHARGE_IMPACT_DAMAGE_BY_TYPE[u.unitType ?? 'infantry'];
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

  return { units: working.filter(u => u.hp > 0), orders: ordersOut, projectiles };
};
