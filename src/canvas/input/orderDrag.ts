import * as PIXI from 'pixi.js';
import type React from 'react';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import {
  groupHeading, snapHeading, computeFormationPreview, computeLineDragSlots,
  computeWedgeDragSlots, computeHexDragSlots, computeOrderedSlotAssignments,
  computeLineSlotAssignmentsByType, snapToForwardCone,
  type Team, type GroupId, type FormationType,
} from '../../battle/simulate';
import type { Unit } from '../../battle/simulate';
import type { OrderChange } from '../../battle/ai';
import {
  DRAG_THRESHOLD_PX, HEADING_ARROWS, TEAM_TINTS, groupOrderKey,
  type Armies, type GroupOrders, type GroupFormations, type GroupDepths, type InputMode,
} from '../constants';
import { TERRAINS } from '../terrain-defs';

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
  previewGfx: React.MutableRefObject<PIXI.Container>;
  zoom: React.MutableRefObject<number>;
  orderDragRef: React.MutableRefObject<OrderDrag | null>;
  selectedTeamRef: React.MutableRefObject<Team>;
  selectedGroupRef: React.MutableRefObject<GroupId>;
  currentStrategicHexRef: React.MutableRefObject<Hex | null>;
  armiesRef: React.MutableRefObject<Armies>;
  groupOrdersRef: React.MutableRefObject<GroupOrders>;
  groupFormationsRef: React.MutableRefObject<GroupFormations>;
  groupDepthsRef: React.MutableRefObject<GroupDepths>;
  gridDataRef: React.MutableRefObject<{ hex: Hex; type: string }[]>;
  setArmies: React.Dispatch<React.SetStateAction<Armies>>;
  setInputMode: React.Dispatch<React.SetStateAction<InputMode | null>>;
  issueOrder: (team: Team, groupId: GroupId, change: OrderChange) => void;
}

export function beginOrderDrag(e: PIXI.FederatedPointerEvent, world: PIXI.Container, ctx: OrderDragCtx): void {
  const team = ctx.selectedTeamRef.current;
  const groupId = ctx.selectedGroupRef.current;
  const strategicKey = HexUtils.key(ctx.currentStrategicHexRef.current!);
  const groupUnits = (ctx.armiesRef.current.get(strategicKey) ?? []).filter(
    u => u.team === team && u.groupId === groupId,
  );
  if (groupUnits.length === 0) return;
  const local = world.toLocal(e.global);
  const targetHex = HexUtils.pixelToHex({ x: local.x, y: local.y });
  const formation = ctx.groupFormationsRef.current.get(groupOrderKey(team, groupId)) ?? 'line';
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

  const gridSet = new Set(ctx.gridDataRef.current.map(d => HexUtils.key(d.hex)));
  const terrainAt = new Map(ctx.gridDataRef.current.map(d => [HexUtils.key(d.hex), d.type]));
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

  slots.forEach((slot, i) => {
    const pos = HexUtils.hexToPixel(slot);
    const tile = ctx.gridDataRef.current.find(d => d.hex.q === slot.q && d.hex.r === slot.r);
    const topY = pos.y - (tile ? TERRAINS[tile.type].height : 0);

    const isLieutenant = i === 0;
    const hex = new PIXI.Graphics();
    hex.lineStyle(isLieutenant ? 3 : 2, isLieutenant ? 0xfacc15 : teamColor, isLieutenant ? 0.95 : 0.75);
    hex.beginFill(isLieutenant ? 0xfacc15 : teamColor, 0.18);
    const s = HexUtils.size;
    for (let k = 0; k < 6; k++) {
      const r = Math.PI / 180 * (60 * k);
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
}
