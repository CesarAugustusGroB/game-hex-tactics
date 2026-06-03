import { useEffect } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { HexUtils, type Hex } from '../../hex-engine/HexUtils';
import type { Team, GroupId, OrderMode } from '../../battle/simulate';
import { GROUP_IDS } from '../../battle/groups';
import type { InputMode, Armies } from '../constants';

export interface TacticalKeyboardCtx {
  viewMode: 'STRATEGIC' | 'TACTICAL';
  selectedGroupRef: MutableRefObject<GroupId>;
  selectedTeamRef: MutableRefObject<Team>;
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  armiesRef: MutableRefObject<Armies>;
  setInputMode: Dispatch<SetStateAction<InputMode | null>>;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  // gid defaults to the selected group; pass an explicit one to drive a specific group (Ctrl = all).
  toggleMode: (mode: Exclude<OrderMode, 'march'>, gid?: GroupId) => void;
  marchForward: (gid?: GroupId) => void;
  banishGroup: (gid?: GroupId) => void;
  toggleFormation: (gid?: GroupId) => void;
}

export function useTacticalKeyboard(ctx: TacticalKeyboardCtx): void {
  const { viewMode, selectedGroupRef, selectedTeamRef, currentStrategicHexRef, armiesRef,
    setInputMode, setIsScanning, toggleMode, marchForward, banishGroup, toggleFormation } = ctx;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!'qwerasdfg'.includes(k)) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (viewMode !== 'TACTICAL') return;
      const team = selectedTeamRef.current;

      // Shift = broadcast the order to ALL of this team's groups instead of just the selected one.
      // (Shift+<letter> fires no browser shortcut, unlike Ctrl+W/Ctrl+R — nothing to suppress.)
      const all = e.shiftKey;
      const run = (fn: (gid: GroupId) => void) => {
        if (all) for (const g of GROUP_IDS) fn(g);
        else fn(selectedGroupRef.current);
      };

      if (k === 'q') {
        // Order-drag is a single-group interactive mode — "all groups" has no meaning here.
        const gid = selectedGroupRef.current;
        const hex = currentStrategicHexRef.current;
        const units = hex ? armiesRef.current.get(HexUtils.key(hex)) ?? [] : [];
        const count = units.filter(u => u.team === team && u.groupId === gid).length;
        if (count === 0) return;
        setInputMode(prev => (prev === 'order' ? null : 'order'));
        setIsScanning(false);
      } else if (k === 'w') {
        run(g => toggleMode('hold', g));
      } else if (k === 'e') {
        run(g => toggleMode('charge', g));
      } else if (k === 'r') {
        run(g => toggleMode('unleash', g));
      } else if (k === 's') {
        run(g => toggleMode('idle', g));
      } else if (k === 'a') {
        run(g => marchForward(g));
      } else if (k === 'd') {
        run(g => banishGroup(g));
      } else if (k === 'f') {
        run(g => toggleMode('retreat', g));
      } else if (k === 'g') {
        run(g => toggleFormation(g));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, toggleMode, marchForward, banishGroup, toggleFormation, selectedGroupRef, selectedTeamRef,
    currentStrategicHexRef, armiesRef, setInputMode, setIsScanning]);
}
