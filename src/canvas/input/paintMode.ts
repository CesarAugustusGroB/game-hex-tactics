import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { getTerrainMods } from '../../battle/terrain';
import { MAX_HP_BY_TYPE, type Team, type GroupId, type UnitType, type Unit } from '../../battle/simulate';
import {
  COHORT_SIZE, INITIAL_ROSTER, deployZoneFor, terrainMapFor, isGroupSealed, activeFillGroup,
  type Armies, type Rosters, type InputMode, type GroupOrders,
} from '../constants';
import type { CpIntent } from '../../battle/command-points';

export interface PaintModeCtx {
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  lastPaintedKeyRef: MutableRefObject<string | null>;
  selectedTeamRef: MutableRefObject<Team>;
  selectedGroupRef: MutableRefObject<GroupId>;
  selectedUnitTypeRef: MutableRefObject<UnitType>;
  armiesRef: MutableRefObject<Armies>;
  groupOrdersRef: MutableRefObject<GroupOrders>;
  rostersRef: MutableRefObject<Rosters>;
  gridDataRef: MutableRefObject<{ hex: Hex; type: string }[]>;
  inputModeRef: MutableRefObject<InputMode | null>;
  setArmies: Dispatch<SetStateAction<Armies>>;
  setRosters: Dispatch<SetStateAction<Rosters>>;
  setSelectedGroup: Dispatch<SetStateAction<GroupId>>;
  chargeCP: (team: Team, intent: CpIntent) => boolean;
  triggerBrokeFlash: (team: Team) => void;
}

export function paintPlace(hex: Hex, ctx: PaintModeCtx): void {
  const strategicHex = ctx.currentStrategicHexRef.current;
  if (!strategicHex) return;
  const hexKey = HexUtils.key(hex);
  if (ctx.lastPaintedKeyRef.current === hexKey) return;
  ctx.lastPaintedKeyRef.current = hexKey;
  const team = ctx.selectedTeamRef.current;
  const zone = deployZoneFor(team, ctx.gridDataRef.current);
  if (!zone.has(hexKey)) return;
  const unitType = ctx.selectedUnitTypeRef.current;
  const remaining = ctx.rostersRef.current.get(team)?.[unitType] ?? 0;
  if (remaining <= 0) return;
  const strategicKey = HexUtils.key(strategicHex);
  const existing = ctx.armiesRef.current.get(strategicKey) ?? [];
  // New cohorts fill the SELECTED group — the player picks which band to build (click a unit,
  // a HUD group button, or 1-4) and can fill any group in any order. The only block is a
  // SEALED group: one that has marched/launched stays locked until it empties or redeploys
  // home, so its slot can't be refilled mid-attack.
  const aliveTeam = existing.filter(u => u.team === team && u.hp > 0);
  let groupId = ctx.selectedGroupRef.current;
  if (isGroupSealed(aliveTeam, ctx.groupOrdersRef.current, zone, team, groupId)) {
    // Selected group is sealed (launched) — fall back to the next fillable group and select it,
    // instead of refusing the placement. If every group is sealed there's nowhere to deploy.
    const next = activeFillGroup(aliveTeam, ctx.groupOrdersRef.current, zone, team);
    if (next === null) { ctx.triggerBrokeFlash(team); return; }
    groupId = next;
    ctx.setSelectedGroup(next);
  }
  const occupied = new Set(existing.map(u => HexUtils.key(u.tacticalHex)));
  const target: Hex[] = [];
  const candidates: Hex[] = [hex, ...HexUtils.getNeighbors(hex)];
  const cap = Math.min(COHORT_SIZE, remaining);
  for (const c of candidates) {
    if (target.length >= cap) break;
    const k = HexUtils.key(c);
    if (!zone.has(k) || occupied.has(k)) continue;
    target.push(c);
    occupied.add(k);
  }
  if (target.length === 0) return;
  if (!ctx.chargeCP(team, 'placeCohort')) {
    ctx.triggerBrokeFlash(team);
    return;
  }
  const terrainAt = terrainMapFor(ctx.gridDataRef.current);
  const newUnits: Unit[] = target.map(h => {
    const placementType = terrainAt.get(HexUtils.key(h));
    return {
      id: crypto.randomUUID(),
      team,
      unitType,
      tacticalHex: h,
      homeHex: h,
      groupId,
      hp: MAX_HP_BY_TYPE[unitType],
      state: 'idle',
      nextMoveTick: 0,
      visionRadius: getTerrainMods(placementType).visionRadius,
    };
  });
  ctx.setArmies(prev => {
    const next = new Map(prev);
    const cur = next.get(strategicKey) ?? [];
    next.set(strategicKey, [...cur, ...newUnits]);
    return next;
  });
  ctx.setRosters(prev => {
    const next = new Map(prev);
    const r = next.get(team) ?? { ...INITIAL_ROSTER };
    next.set(team, { ...r, [unitType]: r[unitType] - newUnits.length });
    return next;
  });
}

export function paintAt(hex: Hex, ctx: PaintModeCtx): void {
  if (ctx.inputModeRef.current === 'place') paintPlace(hex, ctx);
}
