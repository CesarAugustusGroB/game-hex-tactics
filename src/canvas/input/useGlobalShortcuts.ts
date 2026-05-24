import { useEffect } from 'react';
import type React from 'react';
import { HexUtils } from '../../hex-engine/HexUtils';
import type { Team, GroupId, UnitType } from '../../battle/simulate';
import type { InputMode, Rosters } from '../constants';

export interface GlobalShortcutsCtx {
  viewMode: 'STRATEGIC' | 'TACTICAL';
  selectedTeamRef: React.MutableRefObject<Team>;
  selectedGroupRef: React.MutableRefObject<GroupId>;
  selectedUnitTypeRef: React.MutableRefObject<UnitType>;
  currentStrategicHexRef: React.MutableRefObject<import('../../hex-engine/HexUtils').Hex | null>;
  inputModeRef: React.MutableRefObject<InputMode | null>;
  rostersRef: React.MutableRefObject<Rosters>;
  setIsBattleRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedTeam: React.Dispatch<React.SetStateAction<Team>>;
  setSelectedGroup: React.Dispatch<React.SetStateAction<GroupId>>;
  setSelectedUnitType: React.Dispatch<React.SetStateAction<UnitType>>;
  setInputMode: React.Dispatch<React.SetStateAction<InputMode | null>>;
  setIsScanning: React.Dispatch<React.SetStateAction<boolean>>;
  setArmies: React.Dispatch<React.SetStateAction<import('../constants').Armies>>;
  clearOrder: (team: Team, gid: GroupId) => void;
}

export function useGlobalShortcuts(ctx: GlobalShortcutsCtx): void {
  const { viewMode, selectedTeamRef, selectedGroupRef, selectedUnitTypeRef,
    currentStrategicHexRef, inputModeRef, rostersRef,
    setIsBattleRunning, setSelectedTeam, setSelectedGroup, setSelectedUnitType,
    setInputMode, setIsScanning, setArmies, clearOrder } = ctx;

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
        const team = selectedTeamRef.current;
        if ((rostersRef.current.get(team)?.[type] ?? 0) <= 0) return;
        const samePlacing = inputModeRef.current === 'place' && selectedUnitTypeRef.current === type;
        setSelectedUnitType(type);
        setInputMode(samePlacing ? null : 'place');
        setIsScanning(false);
      };
      if (e.key === 'z' || e.key === 'Z') { setPlacementType('infantry'); return; }
      if (e.key === 'x' || e.key === 'X') { setPlacementType('cavalry'); return; }
      if (e.key === 'c' || e.key === 'C') { setPlacementType('skirmisher'); return; }
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
        clearOrder(team, gid);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, clearOrder, selectedTeamRef, selectedGroupRef, selectedUnitTypeRef,
    currentStrategicHexRef, inputModeRef, rostersRef,
    setIsBattleRunning, setSelectedTeam, setSelectedGroup, setSelectedUnitType,
    setInputMode, setIsScanning, setArmies]);
}
