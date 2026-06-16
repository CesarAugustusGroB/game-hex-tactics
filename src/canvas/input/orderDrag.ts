import * as PIXI from 'pixi.js';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import {
  groupHeading, snapHeading, computeFormationPreview, computeLineDragSlots,
  computeWedgeDragSlots, computeHexDragSlots, computeOrderedSlotAssignments,
  computeLineSlotAssignmentsByType, snapToForwardCone,
  type Team, type GroupId, type FormationType,
} from '../../battle/simulate';
import type { Unit } from '../../battle/simulate';
import type { OrderChange } from '../../battle/ai';
import type { CpIntent } from '../../battle/command-points';
import {
  DRAG_THRESHOLD_PX, HEADING_ARROWS, TEAM_TINTS, groupOrderKey,
  deployZoneFor, terrainMapFor, gridKeySetFor,
  type Armies, type GroupOrders, type GroupFormations, type GroupDepths, type InputMode,
} from '../constants';
import { TERRAINS } from '../terrain-defs';
import { STAR_STYLE } from '../render/drawUnits';

export interface OrderDrag {
  team: Team;
  groupId: GroupId;
  formation: FormationType;
  depth: number;
  unitCount: number;
  targetHex: Hex;
  startWorld: { x: number; y: number };
  currentWorld: { x: number; y: number };
}

export interface OrderDragCtx {
  previewGfx: MutableRefObject<PIXI.Container>;
  zoom: MutableRefObject<number>;
  orderDragRef: MutableRefObject<OrderDrag | null>;
  selectedTeamRef: MutableRefObject<Team>;
  selectedGroupRef: MutableRefObject<GroupId>;
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  armiesRef: MutableRefObject<Armies>;
  groupOrdersRef: MutableRefObject<GroupOrders>;
  groupFormationsRef: MutableRefObject<GroupFormations>;
  groupDepthsRef: MutableRefObject<GroupDepths>;
  gridDataRef: MutableRefObject<{ hex: Hex; type: string }[]>;
  setArmies: Dispatch<SetStateAction<Armies>>;
  setInputMode: Dispatch<SetStateAction<InputMode | null>>;
  issueOrder: (team: Team, groupId: GroupId, change: OrderChange) => void;
  chargeCP: (team: Team, intent: CpIntent) => boolean;
  triggerBrokeFlash: (team: Team) => void;
}

export function beginOrderDrag(e: PIXI.FederatedPointerEvent, world: PIXI.Container, ctx: OrderDragCtx): void {
  const team = ctx.selectedTeamRef.current;
  const groupId = ctx.selectedGroupRef.current;
  const strategicKey = HexUtils.key(ctx.currentStrategicHexRef.current!);
  const groupUnits = (ctx.armiesRef.current.get(strategicKey) ?? []).filter(
    u => u.team === team && u.groupId === groupId,
  );
  if (groupUnits.length === 0) return;
  // Committed (unleashed) groups are locked — don't begin a redeploy drag (it would charge
  // CP and teleport units before issueOrder rejects the change).
  if (ctx.groupOrdersRef.current.get(groupOrderKey(team, groupId))?.committed) return;
  const local = world.toLocal(e.global);
  const targetHex = HexUtils.pixelToHex({ x: local.x, y: local.y });
  const formation: FormationType = 'line';
  const depth = ctx.groupDepthsRef.current.get(groupOrderKey(team, groupId)) ?? 1;
  ctx.orderDragRef.current = {
    team,
    groupId,
    formation,
    depth,
    unitCount: groupUnits.length,
    targetHex,
    startWorld: { x: local.x, y: local.y },
    currentWorld: { x: local.x, y: local.y },
  };
  renderOrderPreview(ctx);
}

export function updateOrderDrag(localX: number, localY: number, ctx: OrderDragCtx): void {
  ctx.orderDragRef.current!.currentWorld = { x: localX, y: localY };
  renderOrderPreview(ctx);
}

export function commitOrderDrag(ctx: OrderDragCtx): void {
  const drag = ctx.orderDragRef.current;
  if (!drag) return;

  const zone = deployZoneFor(drag.team, ctx.gridDataRef.current);
  if (!zone.has(HexUtils.key(drag.targetHex))) {
    ctx.setInputMode(null);
    cancelOrderDrag(ctx);
    return;
  }

  const dx = drag.currentWorld.x - drag.startWorld.x;
  const dy = drag.currentWorld.y - drag.startWorld.y;
  const screenDist = Math.hypot(dx, dy) * ctx.zoom.current;
  const strategic = ctx.currentStrategicHexRef.current;
  const groupUnits = strategic
    ? (ctx.armiesRef.current.get(HexUtils.key(strategic)) ?? []).filter(
        u => u.team === drag.team && u.groupId === drag.groupId,
      )
    : [];
  const dragEndHex = HexUtils.pixelToHex({ x: drag.currentWorld.x, y: drag.currentWorld.y });
  const dragHexDist = HexUtils.distance(drag.targetHex, dragEndHex);

  let heading: number;
  let slots: Hex[];
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

  const pairing = lineFrontWidth > 0
    ? computeLineSlotAssignmentsByType(groupUnits, slots, drag.targetHex, lineFrontWidth)
    : computeOrderedSlotAssignments(groupUnits, slots, drag.targetHex);

  const gridSet = gridKeySetFor(ctx.gridDataRef.current);
  const terrainAt = terrainMapFor(ctx.gridDataRef.current);
  const allUnits = strategic ? ctx.armiesRef.current.get(HexUtils.key(strategic)) ?? [] : [];
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
    if (!ctx.chargeCP(drag.team, 'orderDrag')) {
      ctx.triggerBrokeFlash(drag.team);
      ctx.setInputMode(null);
      cancelOrderDrag(ctx);
      return;
    }
    ctx.setArmies(prev => {
      const updated = new Map(prev);
      const arr = (updated.get(HexUtils.key(strategic)) ?? []).map(u => {
        const slot = pairing.get(u.id);
        if (slot) return { ...u, tacticalHex: slot };
        return u;
      });
      updated.set(HexUtils.key(strategic), arr);
      return updated;
    });
    {
      const prior = ctx.groupOrdersRef.current.get(groupOrderKey(drag.team, drag.groupId));
      const change: OrderChange = { attackTarget: drag.targetHex, heading: snapToForwardCone(drag.team, heading) };
      if (!prior?.mode) change.mode = 'idle';
      ctx.issueOrder(drag.team, drag.groupId, change);
    }
  }
  ctx.setInputMode(null);
  cancelOrderDrag(ctx);
}

export function cancelOrderDrag(ctx: OrderDragCtx): void {
  ctx.orderDragRef.current = null;
  ctx.previewGfx.current.removeChildren();
}

export function renderOrderPreview(ctx: OrderDragCtx): void {
  const gfx = ctx.previewGfx.current;
  gfx.removeChildren();
  const drag = ctx.orderDragRef.current;
  if (!drag) return;

  const dx = drag.currentWorld.x - drag.startWorld.x;
  const dy = drag.currentWorld.y - drag.startWorld.y;
  const screenDist = Math.hypot(dx, dy) * ctx.zoom.current;
  const dragEndHex = HexUtils.pixelToHex({ x: drag.currentWorld.x, y: drag.currentWorld.y });
  const dragHexDist = HexUtils.distance(drag.targetHex, dragEndHex);

  let slots: Hex[];
  let heading: number;
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
      const strategic = ctx.currentStrategicHexRef.current;
      const groupUnits = strategic
        ? (ctx.armiesRef.current.get(HexUtils.key(strategic)) ?? []).filter(
            u => u.team === drag.team && u.groupId === drag.groupId,
          )
        : [];
      heading = groupHeading(groupUnits, drag.targetHex);
    }
    slots = computeFormationPreview(drag.unitCount, drag.targetHex, heading, drag.formation, drag.depth);
  }
  const teamColor = TEAM_TINTS[drag.team];
  const terrainAt = terrainMapFor(ctx.gridDataRef.current);

  slots.forEach((slot, i) => {
    const pos = HexUtils.hexToPixel(slot);
    const tType = terrainAt.get(HexUtils.key(slot));
    const topY = pos.y - (tType ? TERRAINS[tType].height : 0);

    const isLieutenant = i === 0;
    const hex = new PIXI.Graphics();
    const s = HexUtils.size;
    const pts: number[] = [];
    for (let k = 0; k < 6; k++) {
      const r = Math.PI / 180 * (60 * k);
      pts.push(pos.x + s * Math.cos(r), topY + s * Math.sin(r));
    }
    hex.poly(pts)
      .fill({ color: isLieutenant ? 0xfacc15 : teamColor, alpha: 0.18 })
      .stroke({ width: isLieutenant ? 3 : 2, color: isLieutenant ? 0xfacc15 : teamColor, alpha: isLieutenant ? 0.95 : 0.75 });
    gfx.addChild(hex);

    if (isLieutenant) {
      const star = new PIXI.Text({ text: '★', style: STAR_STYLE });
      star.anchor.set(0.5);
      star.x = pos.x;
      star.y = topY - 44;
      gfx.addChild(star);

      const arrow = new PIXI.Text({ text: HEADING_ARROWS[heading] ?? '→', style: STAR_STYLE });
      arrow.anchor.set(0.5);
      arrow.x = pos.x + 14;
      arrow.y = topY - 44;
      gfx.addChild(arrow);
    }
  });
}
