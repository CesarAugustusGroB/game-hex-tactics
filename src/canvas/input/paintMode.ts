import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import { getTerrainMods } from '../../battle/terrain';
import { MAX_HP_BY_TYPE, type Team, type GroupId, type UnitType, type Unit } from '../../battle/simulate';
import {
  COHORT_SIZE, INITIAL_ROSTER, deployZoneFor,
  type Armies, type Rosters, type InputMode,
} from '../constants';

export interface PaintModeCtx {
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  lastPaintedKeyRef: MutableRefObject<string | null>;
  selectedTeamRef: MutableRefObject<Team>;
  selectedGroupRef: MutableRefObject<GroupId>;
  selectedUnitTypeRef: MutableRefObject<UnitType>;
  armiesRef: MutableRefObject<Armies>;
  rostersRef: MutableRefObject<Rosters>;
  gridDataRef: MutableRefObject<{ hex: Hex; type: string }[]>;
  inputModeRef: MutableRefObject<InputMode | null>;
  setArmies: Dispatch<SetStateAction<Armies>>;
  setRosters: Dispatch<SetStateAction<Rosters>>;
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
  const groupId = ctx.selectedGroupRef.current;
  const newUnits: Unit[] = target.map(h => {
    const placementType = ctx.gridDataRef.current.find(d => d.hex.q === h.q && d.hex.r === h.r)?.type;
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

export function paintAssign(hex: Hex, ctx: PaintModeCtx): void {
  const strategicHex = ctx.currentStrategicHexRef.current;
  if (!strategicHex) return;
  const hexKey = HexUtils.key(hex);
  if (ctx.lastPaintedKeyRef.current === hexKey) return;
  ctx.lastPaintedKeyRef.current = hexKey;
  const strategicKey = HexUtils.key(strategicHex);
  const team = ctx.selectedTeamRef.current;
  const groupId = ctx.selectedGroupRef.current;
  ctx.setArmies(prev => {
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
}

export function paintAt(hex: Hex, ctx: PaintModeCtx): void {
  if (ctx.inputModeRef.current === 'place') paintPlace(hex, ctx);
  else if (ctx.inputModeRef.current === 'assign') paintAssign(hex, ctx);
}
