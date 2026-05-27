import React from 'react';
import { HexUtils } from '../hex-engine/HexUtils';
import type { Hex } from '../hex-engine/HexUtils';
import type { OrderMode, FormationType, Team, GroupId, UnitType } from '../battle/simulate';
import { HOLD_REDUCTION_PER_TICK, HOLD_REDUCTION_CAP, cycleConeHeading } from '../battle/simulate';
import type { InputMode, Armies, GroupOrders, GroupFormations, Rosters } from './constants';
import {
  POINTS_TO_WIN, COHORT_SIZE, RETREAT_REFUND_FRAC,
  FORMATION_LABELS, TEAM_TINTS, HEADING_ARROWS, groupOrderKey,
} from './constants';
import type { TerrainDef } from './terrain-defs';
import { CP_COSTS, type CpIntent } from '../battle/command-points';
import { MAP_TYPE_IDS, type MapTypeId } from '../data/world-gen';
import type { MapTypeChoice } from './world-gen';

export interface HUDProps {
  // ref
  containerRef: React.RefObject<HTMLDivElement | null>;
  // view state
  viewMode: 'STRATEGIC' | 'TACTICAL';
  isScanning: boolean;
  showGrid: boolean;
  fogOfWar: boolean;
  inputMode: InputMode | null;
  winBanner: Team | null;
  // battle state
  isBattleRunning: boolean;
  score: { red: number; blue: number };
  currentStrategicHex: Hex | null;
  armies: Armies;
  groupOrders: GroupOrders;
  groupFormations: GroupFormations;
  rosters: Rosters;
  // selection
  selectedTeam: Team;
  selectedGroup: GroupId;
  selectedUnitType: UnitType;
  commandPoints: { red: number; blue: number };
  brokeFlash: { red: boolean; blue: boolean };
  canAfford: (team: Team, intent: CpIntent) => boolean;
  cpMax: number;
  cpRegenN: number;
  setCpMax: (v: number) => void;
  setCpRegenN: (v: number) => void;
  // computed
  curT: TerrainDef | null;
  // setters
  setIsScanning: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;
  setFogOfWar: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedTeam: React.Dispatch<React.SetStateAction<Team>>;
  setSelectedGroup: React.Dispatch<React.SetStateAction<GroupId>>;
  setSelectedUnitType: React.Dispatch<React.SetStateAction<UnitType>>;
  setInputMode: React.Dispatch<React.SetStateAction<InputMode | null>>;
  setIsBattleRunning: React.Dispatch<React.SetStateAction<boolean>>;
  // action callbacks (non-trivial — defined in GameCanvas)
  toggleScan: () => void;
  toggleMode: (mode: Exclude<OrderMode, 'march'>) => void;
  marchForward: () => void;
  cycleFormation: (gid: GroupId) => void;
  resetBattle: () => void;
  returnToStrategic: () => void;
  regenerateWorld: () => void;
  // world-gen
  mapTypeChoice: MapTypeChoice;
  resolvedMapType: MapTypeId;
  seed: number;
  setMapTypeChoice: (c: MapTypeChoice) => void;
  setSeed: (n: number) => void;
  rerollSeed: () => void;
}

const MAP_TYPE_LABELS: Record<string, string> = {
  island: 'ISLAND',
  coastline: 'COAST',
  archipelago: 'ISLES',
  plains: 'PLAINS',
  inlandSea: 'INLAND SEA',
  highlands: 'HIGHLANDS',
  forest: 'FOREST',
  hills: 'HILLS',
  random: 'RANDOM',
};

const CostChip: React.FC<{ cost: number; affordable: boolean }> = ({ cost, affordable }) => {
  if (cost === 0) return null;
  return (
    <span style={{
      position: 'absolute',
      top: '-5px', right: '-5px',
      background: affordable ? '#facc15' : '#ef4444',
      color: affordable ? '#0b1220' : 'white',
      borderRadius: '8px',
      padding: '1px 5px',
      fontSize: '8px',
      fontWeight: 900,
      border: '1px solid #0b1220',
      pointerEvents: 'none',
    }}>{cost}</span>
  );
};

const cpInputStyle: React.CSSProperties = {
  width: '40px', marginLeft: '4px', padding: '2px 4px',
  background: 'rgba(0,0,0,0.5)', color: '#f8fafc',
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px',
  fontSize: '11px', fontWeight: 800, textAlign: 'center',
};

export const HUD: React.FC<HUDProps> = ({
  containerRef,
  viewMode,
  isScanning,
  showGrid,
  fogOfWar,
  inputMode,
  winBanner,
  isBattleRunning,
  score,
  currentStrategicHex,
  armies,
  groupOrders,
  groupFormations,
  rosters,
  selectedTeam,
  selectedGroup,
  selectedUnitType,
  commandPoints,
  brokeFlash,
  canAfford,
  cpMax,
  cpRegenN,
  setCpMax,
  setCpRegenN,
  curT,
  setIsScanning,
  setShowGrid,
  setFogOfWar,
  setSelectedTeam,
  setSelectedGroup,
  setSelectedUnitType,
  setInputMode,
  setIsBattleRunning,
  toggleScan,
  toggleMode,
  marchForward,
  cycleFormation,
  resetBattle,
  returnToStrategic,
  regenerateWorld,
  mapTypeChoice,
  resolvedMapType,
  seed,
  setMapTypeChoice,
  setSeed,
  rerollSeed,
}) => {
  const isPlacing = inputMode === 'place';

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

      {/* Victory-points strip — top-centre. Two bars race to POINTS_TO_WIN; visible once a battle is in progress. */}
      {viewMode === 'TACTICAL' && currentStrategicHex && (
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 18px',
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(250,204,21,0.5)',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          zIndex: 150,
          minWidth: '280px',
          pointerEvents: 'none',
        }}>
          <div style={{
            fontSize: '10px', color: '#facc15', fontWeight: 800, letterSpacing: '2px',
            marginBottom: '8px', textAlign: 'center',
          }}>
            VICTORY POINTS — FIRST TO {POINTS_TO_WIN}
          </div>
          {(['red', 'blue'] as const).map(team => {
            const v = score[team];
            const pct = Math.min(100, (v / POINTS_TO_WIN) * 100);
            const color = team === 'red' ? '#ef4444' : '#3b82f6';
            return (
              <div key={team} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: team === 'red' ? '6px' : 0 }}>
                <span style={{ fontSize: '10px', color, fontWeight: 800, width: '38px', letterSpacing: '1px' }}>
                  {team.toUpperCase()}
                </span>
                <div style={{
                  flex: 1, height: '8px', background: 'rgba(255,255,255,0.08)',
                  borderRadius: '4px', overflow: 'hidden',
                }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
                </div>
                <span style={{ fontSize: '10px', color: '#cbd5e1', fontWeight: 700, width: '40px', textAlign: 'right' }}>
                  {Math.round(v)}/{POINTS_TO_WIN}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'TACTICAL' && currentStrategicHex && (
        <div style={{
          position: 'absolute',
          bottom: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 20px',
          background: 'rgba(15,23,42,0.92)',
          border: '1px solid rgba(250,204,21,0.5)',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          backdropFilter: 'blur(12px)',
          zIndex: 150,
          minWidth: '300px',
          color: '#f8fafc',
          pointerEvents: 'none',
        }}>
          <div style={{
            textAlign: 'center', fontSize: '10px', letterSpacing: '2px',
            color: '#facc15', fontWeight: 800, marginBottom: '6px',
          }}>COMMAND POINTS</div>
          {(['red', 'blue'] as const).map(team => {
            const v = commandPoints[team];
            const pct = Math.min(100, (v / cpMax) * 100);
            const baseColor = team === 'red' ? '#ef4444' : '#3b82f6';
            const flashing = brokeFlash[team];
            return (
              <div key={team} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                marginBottom: team === 'red' ? '4px' : 0,
              }}>
                <span style={{
                  fontSize: '10px', color: baseColor, fontWeight: 800, width: '38px', letterSpacing: '1px',
                }}>{team.toUpperCase()}</span>
                <div style={{
                  flex: 1, height: '8px',
                  background: flashing
                    ? (team === 'red' ? 'rgba(239,68,68,0.6)' : 'rgba(59,130,246,0.6)')
                    : 'rgba(255,255,255,0.08)',
                  borderRadius: '4px', overflow: 'hidden',
                  transition: 'background 80ms',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: baseColor,
                    transition: 'width 120ms ease',
                  }} />
                </div>
                <span style={{
                  fontSize: '10px', color: '#cbd5e1', fontWeight: 700, width: '40px', textAlign: 'right',
                }}>{Math.floor(v)}/{cpMax}</span>
              </div>
            );
          })}
          {/* Simple CP economy config — interactive (parent strip is pointerEvents:none). */}
          <div style={{
            display: 'flex', gap: '16px', justifyContent: 'center',
            marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)',
            pointerEvents: 'auto',
          }}>
            <label
              title="CP capacity: both teams start full at this and regen is capped to it (applied immediately)"
              style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', display: 'flex', alignItems: 'center' }}
            >
              MAX
              <input type="number" min={1} max={999} value={cpMax}
                onChange={e => setCpMax(Number(e.target.value))} style={cpInputStyle} />
            </label>
            <label
              title="Gain rate: each team gains 0.1 × n CP per tick (higher = faster). Applies live."
              style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px', display: 'flex', alignItems: 'center' }}
            >
              REGEN
              <input type="number" min={1} max={50} value={cpRegenN}
                onChange={e => setCpRegenN(Number(e.target.value))} style={cpInputStyle} />
              <span style={{ marginLeft: '3px', color: '#64748b' }}>×0.1/t</span>
            </label>
          </div>
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
          onClick={toggleScan}
          style={{ width: '100%', padding: '18px', background: isScanning ? '#ef4444' : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', color: 'white', border: 'none', borderRadius: '16px', fontSize: '13px', fontWeight: '900', cursor: 'pointer', marginBottom: '12px', transition: '0.2s', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)' }}
        >
          {isScanning ? 'CANCEL SCAN' : '🎯 INITIATE TACTICAL DIVE'}
        </button>

        {/* Deploy row: each button drops a cohort of up to COHORT_SIZE units of that
            type into the selected team's zone on the next zone click. Button shows the
            remaining roster count for the active team; disabled when that count is 0. */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {(['infantry', 'cavalry', 'skirmisher'] as const).map(type => {
            const samePlacing = isPlacing && selectedUnitType === type;
            const remaining = rosters.get(selectedTeam)?.[type] ?? 0;
            const outOfStock = remaining <= 0;
            const disabled = viewMode !== 'TACTICAL' || outOfStock || (!samePlacing && !canAfford(selectedTeam, 'placeCohort'));
            const keyHint = type === 'infantry' ? '(Z)' : type === 'cavalry' ? '(X)' : '(C)';
            const label = type === 'infantry' ? 'INFANTRY' : type === 'cavalry' ? 'CAVALRY' : 'SKIRMISH';
            return (
              <button
                key={type}
                onClick={() => {
                  if (viewMode !== 'TACTICAL' || outOfStock) return;
                  setSelectedUnitType(type);
                  setInputMode(samePlacing ? null : 'place');
                  if (!samePlacing) setIsScanning(false);
                }}
                disabled={disabled}
                title={
                  viewMode !== 'TACTICAL' ? 'Dive into a tactical view first'
                  : outOfStock ? `No ${type} left in roster`
                  : `Deploy a cohort of up to ${COHORT_SIZE} ${type} — ${remaining} remaining`
                }
                style={{
                  flex: 1,
                  padding: '14px 6px',
                  position: 'relative',
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
                {samePlacing ? `STOP ${keyHint}` : `${label} ×${remaining} ${keyHint}`}
                {!samePlacing && <CostChip cost={CP_COSTS.placeCohort} affordable={canAfford(selectedTeam, 'placeCohort')} />}
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
              const order = groupOrders.get(formationKey);
              const canHold = !!order?.attackTarget;
              const committed = !!order?.committed;
              // Post-unleash lock: every interaction except RETREAT is disabled. The
              // group becomes re-orderable again only after retreat lands it back in
              // its deploy zone (sim auto-clears the order; see simulate.ts retreat).
              const canEdit = canHold && !committed;
              const orderMode: OrderMode = order?.mode ?? 'march';
              const chargeActive = orderMode === 'charge';
              const unleashActive = orderMode === 'unleash';
              const holdActive = orderMode === 'hold';
              const idleActive = orderMode === 'idle';
              const holdTicks = order?.holdTicks ?? 0;
              const holdPct = Math.round(Math.min(holdTicks * HOLD_REDUCTION_PER_TICK, HOLD_REDUCTION_CAP) * 100);
              const chargeRemaining = order?.chargeTicksRemaining;
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
                    {/* Q — DEPLOY (enter order mode for drag-deploy / direction set) */}
                    <button
                      disabled={count === 0 || (!orderActive && !canAfford(selectedTeam, 'orderDrag'))}
                      title="Deploy: drag from a deploy-zone hex to set heading + formation (shortcut: Q)"
                      onClick={() => {
                        setSelectedGroup(gid);
                        setInputMode(prev => (prev === 'order' && selectedGroup === gid) ? null : 'order');
                        setIsScanning(false);
                      }}
                      style={{
                        ...btnBase,
                        position: 'relative',
                        background: orderActive ? teamColorHex : 'rgba(255,255,255,0.04)',
                        color: count === 0 ? '#475569' : orderActive ? 'white' : '#94a3b8',
                        border: orderActive ? `1px solid ${teamColorHex}` : '1px solid rgba(255,255,255,0.1)',
                        cursor: count === 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      DEPLOY (Q)
                      {!orderActive && <CostChip cost={CP_COSTS.orderDrag} affordable={canAfford(selectedTeam, 'orderDrag')} />}
                    </button>
                    {/* W — HOLD: stand still + accrue defensive damage reduction up to a cap.
                        When the cap is reached the sim auto-flips the group to IDLE. */}
                    <button
                      disabled={!canEdit || (!holdActive && !canAfford(selectedTeam, 'hold'))}
                      title={
                        committed ? '🔒 Group committed — retreat to redeploy'
                        : !canHold ? 'No active order to hold'
                        : holdActive ? `Holding — ${holdPct}% damage reduction (cap ${Math.round(HOLD_REDUCTION_CAP * 100)}%). Click to cancel (shortcut: W).`
                        : `Hold: stand still, accrue +${Math.round(HOLD_REDUCTION_PER_TICK * 100)}% damage reduction per tick up to ${Math.round(HOLD_REDUCTION_CAP * 100)}% cap (shortcut: W)`
                      }
                      onClick={() => { if (canEdit) toggleMode('hold'); }}
                      style={{
                        ...btnBase,
                        position: 'relative',
                        background: holdActive ? '#f59e0b' : 'rgba(255,255,255,0.04)',
                        color: !canEdit ? '#475569' : holdActive ? 'white' : '#94a3b8',
                        border: holdActive ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canEdit ? 'not-allowed' : 'pointer',
                        opacity: !canEdit ? 0.5 : 1,
                      }}
                    >
                      {holdActive ? `HOLD ${holdPct}% (W)` : 'HOLD (W)'}
                      {!holdActive && <CostChip cost={CP_COSTS.hold} affordable={canAfford(selectedTeam, 'hold')} />}
                    </button>
                    {/* E — CHARGE */}
                    <button
                      disabled={!canEdit || (!chargeActive && !canAfford(selectedTeam, 'charge'))}
                      title={
                        committed ? '🔒 Group committed — retreat to redeploy'
                        : canEdit ? (chargeActive ? `Charge active${chargeRemaining != null ? ` (${chargeRemaining} ticks left)` : ''} — click to cancel (shortcut: E)` : 'Charge: 2 hexes/tick, lance damage, 1.5s burst (shortcut: E)')
                        : 'No active order'
                      }
                      onClick={() => { if (canEdit) toggleMode('charge'); }}
                      style={{
                        ...btnBase,
                        position: 'relative',
                        background: chargeActive ? '#dc2626' : 'rgba(255,255,255,0.04)',
                        color: !canEdit ? '#475569' : chargeActive ? 'white' : '#94a3b8',
                        border: chargeActive ? '1px solid #dc2626' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canEdit ? 'not-allowed' : 'pointer',
                        opacity: !canEdit ? 0.5 : 1,
                      }}
                    >
                      {chargeActive && chargeRemaining != null ? `CHG ${chargeRemaining} (E)` : 'CHARGE (E)'}
                      {!chargeActive && <CostChip cost={CP_COSTS.charge} affordable={canAfford(selectedTeam, 'charge')} />}
                    </button>
                    {/* R — UNLEASH (one-way commit) */}
                    <button
                      disabled={!canEdit || (!unleashActive && !committed && !canAfford(selectedTeam, 'unleash'))}
                      title={
                        committed ? '🔒 Unleashed — locked. Retreat to redeploy'
                        : canEdit ? (unleashActive ? 'Unleashed — units chase nearest enemy (shortcut: R)' : 'Unleash: ONE-WAY commit — no more orders until retreat reaches deploy zone (shortcut: R)')
                        : 'No active order'
                      }
                      onClick={() => { if (canEdit) toggleMode('unleash'); }}
                      style={{
                        ...btnBase,
                        position: 'relative',
                        background: unleashActive ? '#a855f7' : 'rgba(255,255,255,0.04)',
                        color: !canEdit ? '#475569' : unleashActive ? 'white' : '#94a3b8',
                        border: unleashActive ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canEdit ? 'not-allowed' : 'pointer',
                        opacity: !canEdit ? 0.5 : 1,
                      }}
                    >
                      {committed ? '🔒 UNLEASH' : 'UNLEASH (R)'}
                      {!unleashActive && !committed && <CostChip cost={CP_COSTS.unleash} affordable={canAfford(selectedTeam, 'unleash')} />}
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
                        position: 'relative',
                        background: assignActive ? teamColorHex : 'rgba(255,255,255,0.04)',
                        color: assignActive ? 'white' : '#94a3b8',
                        border: assignActive ? `1px solid ${teamColorHex}` : '1px solid rgba(255,255,255,0.1)',
                        cursor: 'pointer',
                      }}
                    >
                      ASSIGN (T)
                      <CostChip cost={CP_COSTS.assign} affordable={canAfford(selectedTeam, 'assign')} />
                    </button>
                  </div>
                  {/* Row 2 ──────── A  S  D  F ──────── */}
                  <div style={{ ...rowStyle, paddingLeft: '54px' /* aligns under the QWER cluster, past the G label */ }}>
                    {/* A — MARCH / cycle heading. Idle/no-order → starts forward march.
                        Already marching → cycles heading within the forward cone. Button
                        face shows the next heading when marching, "MARCH" otherwise. */}
                    {(() => {
                      const isMarching = orderMode === 'march' && !!order?.attackTarget;
                      const nextHeading = cycleConeHeading(selectedTeam, order?.heading ?? (selectedTeam === 'red' ? 2 : 5));
                      const marchIntent: CpIntent = isMarching ? 'cycleHeading' : 'march';
                      const marchDisabled = count === 0 || committed || !canAfford(selectedTeam, marchIntent);
                      return (
                        <button
                          disabled={marchDisabled}
                          title={
                            committed ? '🔒 Group committed — retreat to redeploy'
                            : count === 0 ? 'No units in this group'
                            : isMarching ? `Cycle heading ${HEADING_ARROWS[order!.heading]} → ${HEADING_ARROWS[nextHeading]} (shortcut: A)`
                            : 'March: start advancing forward (shortcut: A)'
                          }
                          onClick={() => { if (!marchDisabled) marchForward(); }}
                          style={{
                            ...btnBase, fontSize: '12px',
                            position: 'relative',
                            background: isMarching ? '#10b981' : 'rgba(255,255,255,0.04)',
                            color: marchDisabled ? '#475569' : isMarching ? 'white' : '#94a3b8',
                            border: isMarching ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                            cursor: marchDisabled ? 'not-allowed' : 'pointer',
                            opacity: marchDisabled ? 0.5 : 1,
                          }}
                        >
                          {isMarching ? `${HEADING_ARROWS[nextHeading]} (A)` : 'MARCH (A)'}
                          <CostChip cost={CP_COSTS[marchIntent]} affordable={canAfford(selectedTeam, marchIntent)} />
                        </button>
                      );
                    })()}
                    {/* S — IDLE: stand still, no defensive bonus accrual. Mutually
                        exclusive with HOLD (toggleMode auto-replaces). */}
                    <button
                      disabled={!canEdit}
                      title={
                        committed ? '🔒 Group committed — retreat to redeploy'
                        : !canHold ? 'No active order'
                        : idleActive ? 'Idle — standing by. Press A to march (shortcut: S)'
                        : 'Idle: stand still, no movement, no defensive bonus (shortcut: S)'
                      }
                      onClick={() => { if (canEdit) toggleMode('idle'); }}
                      style={{
                        ...btnBase,
                        position: 'relative',
                        background: idleActive ? '#64748b' : 'rgba(255,255,255,0.04)',
                        color: !canEdit ? '#475569' : idleActive ? 'white' : '#94a3b8',
                        border: idleActive ? '1px solid #64748b' : '1px solid rgba(255,255,255,0.1)',
                        cursor: !canEdit ? 'not-allowed' : 'pointer',
                        opacity: !canEdit ? 0.5 : 1,
                      }}
                    >
                      IDLE (S)
                      <CostChip cost={CP_COSTS.idle} affordable={canAfford(selectedTeam, 'idle')} />
                    </button>
                    {/* D — Cycle formation */}
                    <button
                      disabled={isBattleRunning || !canAfford(selectedTeam, 'cycleFormation')}
                      title={isBattleRunning ? 'Formation locked during battle' : `Formation: ${formation} (click to cycle, shortcut: D)`}
                      onClick={() => cycleFormation(gid)}
                      style={{
                        ...btnBase,
                        position: 'relative',
                        background: isBattleRunning ? 'rgba(255,255,255,0.02)' : formationIsDefault ? 'rgba(255,255,255,0.04)' : 'rgba(148,163,184,0.18)',
                        color: isBattleRunning ? '#475569' : formationIsDefault ? '#94a3b8' : '#e2e8f0',
                        border: '1px solid rgba(255,255,255,0.1)',
                        cursor: isBattleRunning ? 'not-allowed' : 'pointer',
                        opacity: isBattleRunning ? 0.5 : 1,
                      }}
                    >
                      {FORMATION_LABELS[formation]} (D)
                      <CostChip cost={CP_COSTS.cycleFormation} affordable={canAfford(selectedTeam, 'cycleFormation')} />
                    </button>
                    {/* F — RETREAT: vanish from field + refund 80% of each unit type
                        to roster. Blocked if any unit in the group has an enemy hex
                        adjacent (must fight out of melee). */}
                    {(() => {
                      const allUnitsHere = currentStrategicHex ? armies.get(HexUtils.key(currentStrategicHex)) ?? [] : [];
                      const groupUnitsHere = allUnitsHere.filter(u => u.team === selectedTeam && u.groupId === gid && u.hp > 0);
                      const enemyHexes = new Set(
                        allUnitsHere.filter(u => u.team !== selectedTeam && u.hp > 0).map(u => HexUtils.key(u.tacticalHex)),
                      );
                      const engaged = groupUnitsHere.some(u =>
                        HexUtils.getNeighbors(u.tacticalHex).some(n => enemyHexes.has(HexUtils.key(n))),
                      );
                      const retreatDisabled = count === 0 || engaged || !canAfford(selectedTeam, 'retreat');
                      const refundPct = Math.round(RETREAT_REFUND_FRAC * 100);
                      return (
                        <button
                          disabled={retreatDisabled}
                          title={
                            count === 0 ? 'No units in this group'
                            : engaged ? '⚔ In melee — break contact first'
                            : `Retreat: vanish from field + ${refundPct}% refund (shortcut: F)`
                          }
                          onClick={() => { if (!retreatDisabled) toggleMode('retreat'); }}
                          style={{
                            ...btnBase,
                            position: 'relative',
                            background: 'rgba(255,255,255,0.04)',
                            color: retreatDisabled ? '#475569' : '#3b82f6',
                            border: '1px solid rgba(255,255,255,0.1)',
                            cursor: retreatDisabled ? 'not-allowed' : 'pointer',
                            opacity: retreatDisabled ? 0.5 : 1,
                          }}
                        >
                          {engaged ? '⚔ RETREAT' : 'RETREAT (F)'}
                          <CostChip cost={CP_COSTS.retreat} affordable={canAfford(selectedTeam, 'retreat')} />
                        </button>
                      );
                    })()}
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

        {/* RESET BATTLE — wipe all units on the current tactical map, restore both
            rosters, clear orders + score + winBanner. Keeps the world and
            view; for replaying the same map without regenerating terrain. */}
        {viewMode === 'TACTICAL' && (
          <button
            onClick={resetBattle}
            style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '12px', fontWeight: 800, cursor: 'pointer', marginBottom: '12px' }}
          >RESET BATTLE</button>
        )}

        <button
          onClick={returnToStrategic}
          style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', marginBottom: '32px' }}
        >RETURN TO STRATEGIC OVERVIEW</button>

        {viewMode === 'STRATEGIC' && (
          <div style={{ background: 'rgba(0,0,0,0.4)', padding: '16px', borderRadius: '16px', marginBottom: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800, letterSpacing: '1px', marginBottom: '10px' }}>
              WORLD TYPE{mapTypeChoice === 'random' ? ` → ${MAP_TYPE_LABELS[resolvedMapType]}` : ''}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {([...MAP_TYPE_IDS, 'random'] as MapTypeChoice[]).map(choice => {
                const active = mapTypeChoice === choice;
                return (
                  <button
                    key={choice}
                    onClick={() => setMapTypeChoice(choice)}
                    style={{
                      flex: '1 0 30%', padding: '8px 4px', borderRadius: '8px',
                      fontSize: '10px', fontWeight: 800, letterSpacing: '0.5px',
                      background: active ? '#10b981' : 'rgba(255,255,255,0.04)',
                      color: active ? 'white' : '#94a3b8',
                      border: active ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                      cursor: 'pointer', transition: '0.2s',
                    }}
                  >
                    {MAP_TYPE_LABELS[choice]}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 700 }}>SEED</span>
              <input
                type="number"
                value={seed}
                onChange={e => setSeed(Number(e.target.value) >>> 0)}
                style={{
                  flex: 1, minWidth: 0, padding: '8px', borderRadius: '8px',
                  background: 'rgba(255,255,255,0.06)', color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.1)', fontSize: '11px', fontWeight: 700,
                }}
              />
              <button
                onClick={rerollSeed}
                title="New random seed + regenerate"
                style={{
                  padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', fontSize: '13px',
                }}
              >🎲</button>
            </div>
          </div>
        )}
        <button onClick={regenerateWorld} style={{ width: '100%', padding: '20px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '16px', fontSize: '14px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)' }}>
          REGENERATE ECOSYSTEM
        </button>
      </div>
    </div>
  );
};
