import React, { useState } from 'react';
import type { Team, UnitType } from '../battle/simulate';
import type { TeamAiProfile } from '../data/ai-profile';
import { loadAiProfiles, saveAiProfiles } from '../data/ai-profile';
import { DOCTRINES, DIFFICULTIES, ALL_CAPABILITIES } from '../data/ai';
import type { Doctrine, Difficulty, AiCapability } from '../data/ai';
import { PROFILE_NUM_FIELDS, effectiveNum, setNum } from './profileFields';

const UNIT_TYPES: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];
const FLAGS: Array<'frontLines' | 'serialWaves' | 'horizontalFront' | 'fastDeploy'> =
  ['frontLines', 'serialWaves', 'horizontalFront', 'fastDeploy'];

const box: React.CSSProperties = { background: '#111a2e', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14, marginBottom: 12 };
const label: React.CSSProperties = { fontSize: 10, letterSpacing: 1, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 };
const chip = (on: boolean, accent = '#0ea5e9'): React.CSSProperties => ({ padding: '4px 9px', borderRadius: 8, fontSize: 11, cursor: 'pointer', border: '1px solid rgba(255,255,255,.1)', background: on ? accent : 'rgba(255,255,255,.06)', color: '#e2e8f0' });
const numInput: React.CSSProperties = { width: 64, padding: '3px 6px', background: '#0a1020', color: '#e2e8f0', border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, fontSize: 12 };

const TeamColumn: React.FC<{ team: Team; profile: TeamAiProfile; onChange: (p: TeamAiProfile) => void }> = ({ team, profile, onChange }) => {
  const accent = team === 'red' ? '#dc2626' : '#1d4ed8';
  const caps = new Set(profile.capabilities ?? []);
  const lt = profile.lineTypes ?? ['infantry', 'skirmisher', 'cavalry'];
  const groups = [...new Set(PROFILE_NUM_FIELDS.map(f => f.group))];
  return (
    <div style={{ flex: 1, minWidth: 300 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: accent, marginBottom: 10 }}>{team.toUpperCase()}</div>

      <div style={box}>
        <div style={label}>Difficulty (base)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {DIFFICULTIES.map(d => (
            <button key={d} style={chip(profile.difficulty === d, '#d97706')} onClick={() => onChange({ ...profile, difficulty: d as Difficulty })}>{d}</button>
          ))}
        </div>
        <div style={label}>Doctrine</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DOCTRINES.map(d => (
            <button key={d} style={chip(profile.doctrine === d)} onClick={() => onChange({ ...profile, doctrine: d as Doctrine })}>{d}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label}>Capabilities</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ALL_CAPABILITIES.map(c => (
            <button key={c} style={chip(caps.has(c))} onClick={() => {
              const next = new Set(caps);
              if (next.has(c)) next.delete(c); else next.add(c);
              onChange({ ...profile, capabilities: [...next] as AiCapability[] });
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label}>Deploy flags</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FLAGS.map(f => (
            <button key={f} style={chip(!!profile[f])} onClick={() => onChange({ ...profile, [f]: !profile[f] })}>{f}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label}>Line types (front → back)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <select key={i} value={lt[i] ?? 'infantry'} style={numInput}
              onChange={e => { const next = [...lt]; next[i] = e.target.value as UnitType; onChange({ ...profile, lineTypes: next }); }}>
              {UNIT_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          ))}
        </div>
      </div>

      {groups.map(g => (
        <div key={g} style={box}>
          <div style={label}>{g}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 8px', alignItems: 'center' }}>
            {PROFILE_NUM_FIELDS.filter(f => f.group === g).map(f => (
              <React.Fragment key={f.path}>
                <span style={{ fontSize: 12, color: '#cbd5e1' }}>{f.label}</span>
                <input type="number" step={f.step} value={effectiveNum(profile, f.path)} style={numInput}
                  onChange={e => onChange(setNum(profile, f.path, Number(e.target.value)))} />
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export const AiLab: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [profiles, setProfiles] = useState(() => loadAiProfiles());
  const [saved, setSaved] = useState(false);
  const setTeam = (team: Team, p: TeamAiProfile) => { setProfiles(prev => ({ ...prev, [team]: p })); setSaved(false); };
  const go = () => { saveAiProfiles(profiles); setSaved(true); };

  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: '#e2e8f0', padding: 24, fontFamily: '"Inter", sans-serif', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button onClick={onExit} style={chip(false)}>← BACK TO GAME</button>
        <h1 style={{ fontSize: 22, margin: 0 }}>AI LAB</h1>
        <button onClick={go} style={{ ...chip(true, '#10b981'), marginLeft: 'auto', fontWeight: 800, padding: '8px 16px' }}>GO — save as game defaults</button>
        {saved && <span style={{ color: '#10b981', fontSize: 13 }}>✓ saved</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', maxWidth: 1100 }}>
        <TeamColumn team="red" profile={profiles.red} onChange={p => setTeam('red', p)} />
        <TeamColumn team="blue" profile={profiles.blue} onChange={p => setTeam('blue', p)} />
      </div>
      {/* SIM_PANEL (Task 3 inserts the simulation panel here) */}
    </div>
  );
};
