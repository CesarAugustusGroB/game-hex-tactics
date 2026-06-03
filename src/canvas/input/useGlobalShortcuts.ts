import { useEffect } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import type { Team, GroupId, UnitType } from '../../battle/simulate';
import { GROUP_IDS } from '../constants';
import type { InputMode, Rosters, Armies } from '../constants';

export interface GlobalShortcutsCtx {
  viewMode: 'STRATEGIC' | 'TACTICAL';
  selectedTeamRef: MutableRefObject<Team>;
  selectedGroupRef: MutableRefObject<GroupId>;
  selectedUnitTypeRef: MutableRefObject<UnitType>;
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  inputModeRef: MutableRefObject<InputMode | null>;
  rostersRef: MutableRefObject<Rosters>;
  armiesRef: MutableRefObject<Armies>;
  setIsBattleRunning: Dispatch<SetStateAction<boolean>>;
  setSelectedTeam: Dispatch<SetStateAction<Team>>;
  setSelectedGroup: Dispatch<SetStateAction<GroupId>>;
  setSelectedUnitType: Dispatch<SetStateAction<UnitType>>;
  setInputMode: Dispatch<SetStateAction<InputMode | null>>;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  setArmies: Dispatch<SetStateAction<Armies>>;
  clearOrder: (team: Team, gid: GroupId) => void;
}

export function useGlobalShortcuts(ctx: GlobalShortcutsCtx): void {
  const { viewMode, selectedTeamRef, selectedGroupRef, selectedUnitTypeRef,
    currentStrategicHexRef, inputModeRef, rostersRef, armiesRef,
    setIsBattleRunning, setSelectedTeam, setSelectedGroup, setSelectedUnitType,
    setInputMode, setIsScanning, setArmies, clearOrder } = ctx;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (viewMode !== 'TACTICAL') return;
      // Enter / P pause-toggle the battle.
      if (e.key === 'Enter' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setIsBattleRunning(b => !b);
        return;
      }
      // SPACE cycles selection to the next EMPTY group (the next one free to deploy into).
      if (e.key === ' ') {
        e.preventDefault();
        const strategic = currentStrategicHexRef.current;
        if (!strategic) return;
        const team = selectedTeamRef.current;
        const units = armiesRef.current.get(HexUtils.key(strategic)) ?? [];
        const isEmpty = (g: GroupId) =>
          !units.some(u => u.team === team && u.groupId === g && u.hp > 0);
        const start = GROUP_IDS.indexOf(selectedGroupRef.current);
        for (let i = 1; i <= GROUP_IDS.length; i++) {
          const g = GROUP_IDS[(start + i) % GROUP_IDS.length];
          if (isEmpty(g)) { setSelectedGroup(g); break; }
        }
        return;
      }
      if (e.key === '<' || e.key === ',') {
        setSelectedTeam(prev => (prev === 'red' ? 'blue' : 'red'));
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
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
    currentStrategicHexRef, inputModeRef, rostersRef, armiesRef,
    setIsBattleRunning, setSelectedTeam, setSelectedGroup, setSelectedUnitType,
    setInputMode, setIsScanning, setArmies]);
}
