import { useEffect } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import type { Team, GroupId, OrderMode } from '../../battle/simulate';
import type { InputMode, Armies } from '../constants';

export interface TacticalKeyboardCtx {
  viewMode: 'STRATEGIC' | 'TACTICAL';
  selectedGroupRef: MutableRefObject<GroupId>;
  selectedTeamRef: MutableRefObject<Team>;
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  armiesRef: MutableRefObject<Armies>;
  setInputMode: Dispatch<SetStateAction<InputMode | null>>;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  toggleMode: (mode: Exclude<OrderMode, 'march'>) => void;
  marchForward: () => void;
  cycleFormation: (gid: GroupId) => void;
}

export function useTacticalKeyboard(ctx: TacticalKeyboardCtx): void {
  const { viewMode, selectedGroupRef, selectedTeamRef, currentStrategicHexRef, armiesRef,
    setInputMode, setIsScanning, toggleMode, marchForward, cycleFormation } = ctx;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!'qwerasdf'.includes(k)) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (viewMode !== 'TACTICAL') return;
      const gid = selectedGroupRef.current;
      const team = selectedTeamRef.current;

      if (k === 'q') {
        const hex = currentStrategicHexRef.current;
        const units = hex ? armiesRef.current.get(HexUtils.key(hex)) ?? [] : [];
        const count = units.filter(u => u.team === team && u.groupId === gid).length;
        if (count === 0) return;
        setInputMode(prev => (prev === 'order' ? null : 'order'));
        setIsScanning(false);
      } else if (k === 'w') {
        toggleMode('hold');
      } else if (k === 'e') {
        toggleMode('charge');
      } else if (k === 'r') {
        toggleMode('unleash');
      } else if (k === 's') {
        toggleMode('idle');
      } else if (k === 'a') {
        marchForward();
      } else if (k === 'd') {
        cycleFormation(gid);
      } else if (k === 'f') {
        toggleMode('retreat');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, toggleMode, marchForward, cycleFormation, selectedGroupRef, selectedTeamRef,
    currentStrategicHexRef, armiesRef, setInputMode, setIsScanning]);
}
