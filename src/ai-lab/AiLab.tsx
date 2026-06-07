import React, { useState } from 'react';
import type { Team, UnitType } from '../battle/simulate';
import type { TeamAiProfile } from '../data/ai-profile';
import { loadAiProfiles, saveAiProfiles, resolveProfile, profileFromDifficulty } from '../data/ai-profile';
import { DOCTRINES, DIFFICULTIES, ALL_CAPABILITIES } from '../data/ai';
import type { Doctrine, Difficulty, AiCapability } from '../data/ai';
import { PROFILE_NUM_FIELDS, effectiveNum, setNum } from './profileFields';
import { runSeries, type SimResult } from '../sim/runMatch';

const UNIT_TYPES: UnitType[] = ['infantry', 'skirmisher', 'cavalry'];
const FLAGS: Array<'frontLines' | 'serialWaves' | 'horizontalFront' | 'fastDeploy'> =
  ['frontLines', 'serialWaves', 'horizontalFront', 'fastDeploy'];

// Hover tooltips. The numeric fields carry their own `desc` in PROFILE_NUM_FIELDS.
const DIFF_DESC: Record<string, string> = {
  easy: 'Base débil: reacciona lento (rt6) y carga charge — el repertorio distractor que la hace perder vs el camp-rush.',
  normal: 'Base neutra: sin capacidades, reacción rápida (rt2). El empuje-al-centro puro.',
  hard: 'Base disciplinada: raid + defend, reacción lenta (rt10). El campeador del centro.',
  test: 'Base más fuerte: doctrina de líneas rodantes (frontLines) + defend, rt10. Domina la escalera.',
};
const DOCTRINE_DESC: Record<string, string> = {
  balanced: 'Frente infantería · caballería · skirmisher; reserva infantería.',
  aggressive: 'Frente caballería · infantería · skirmisher; reserva caballería.',
  defensive: 'Frente skirmisher · caballería · infantería; reserva skirmisher.',
};
const CAP_DESC: Record<string, string> = {
  focusFire: 'Converge sobre el clúster enemigo más débil en vez de empujar el centro a ciegas.',
  charge: 'La caballería lancea cuando hay un enemigo a chargeReach.',
  unleash: 'Los skirmishers se sueltan a auto-adquirir y kitear a rango de misil.',
  raid: 'Cuando va perdiendo, las bandas bajas empujan a través del centro a la línea enemiga por puntos.',
  defend: 'La reserva tapa el carril de un raider detectado en su retaguardia (reactivo).',
  repel: 'Los grupos más cercanos se devuelven a interceptar una masa que entró en su mitad.',
  earlyLaunch: 'Lanza un frente a medio formar cuando sube el peligro de derrota.',
};
const FLAG_DESC: Record<string, string> = {
  frontLines: 'Líneas rodantes: UN grupo de ataque, líneas horizontales centro→flancos, un tipo por línea. Reemplaza el layout de chunks.',
  serialWaves: 'Amasa una banda completa y la lanza, luego la siguiente — olas en serie.',
  horizontalFront: 'Cada banda despliega como línea ancha a todo el mapa, no como columna lateral.',
  fastDeploy: 'Coloca una banda entera de anclas por tick (pincela rápido); igual gasta CP.',
};
const LINE_TYPES_DESC = 'Solo con frontLines: el tipo de unidad de cada línea sucesiva, del frente hacia atrás (cicla este orden).';

const box: React.CSSProperties = { background: '#111a2e', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14, marginBottom: 12 };
const label: React.CSSProperties = { fontSize: 10, letterSpacing: 1, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 };
const chip = (on: boolean, accent = '#0ea5e9'): React.CSSProperties => ({ padding: '4px 9px', borderRadius: 8, fontSize: 11, cursor: 'pointer', border: '1px solid rgba(255,255,255,.1)', background: on ? accent : 'rgba(255,255,255,.06)', color: '#e2e8f0' });
const numInput: React.CSSProperties = { width: 64, padding: '3px 6px', background: '#0a1020', color: '#e2e8f0', border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, fontSize: 12 };

const TeamColumn: React.FC<{ team: Team; profile: TeamAiProfile; onChange: (p: TeamAiProfile) => void }> = ({ team, profile, onChange }) => {
  const accent = team === 'red' ? '#dc2626' : '#1d4ed8';
  // Show EFFECTIVE (resolved) state so the difficulty's implied caps/flags/lines are visible; a
  // toggle then writes an explicit override on top.
  const r = resolveProfile(profile);
  const caps = new Set(r.capabilities);
  const lt = r.lineTypes;
  const groups = [...new Set(PROFILE_NUM_FIELDS.map(f => f.group))];
  return (
    <div style={{ flex: 1, minWidth: 300 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: accent, marginBottom: 10 }}>{team.toUpperCase()}</div>

      <div style={box}>
        <div style={label}>Difficulty (base)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {DIFFICULTIES.map(d => (
            <button key={d} title={DIFF_DESC[d]} style={chip(profile.difficulty === d, '#d97706')} onClick={() => onChange({ ...profile, difficulty: d as Difficulty })}>{d}</button>
          ))}
        </div>
        <div style={label}>Doctrine</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DOCTRINES.map(d => (
            <button key={d} title={DOCTRINE_DESC[d]} style={chip(profile.doctrine === d)} onClick={() => onChange({ ...profile, doctrine: d as Doctrine })}>{d}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label} title="Comportamientos tácticos que ejecuta esta IA (contraintuitivo: casi todos pierden vs el camp-rush puro).">Capabilities</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ALL_CAPABILITIES.map(c => (
            <button key={c} title={CAP_DESC[c]} style={chip(caps.has(c))} onClick={() => {
              const next = new Set(caps);
              if (next.has(c)) next.delete(c); else next.add(c);
              onChange({ ...profile, capabilities: [...next] as AiCapability[] });
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label} title="Cómo dibuja el ejército en la zona de despliegue.">Deploy flags</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FLAGS.map(f => (
            <button key={f} title={FLAG_DESC[f]} style={chip(!!r[f])} onClick={() => onChange({ ...profile, [f]: !r[f] })}>{f}</button>
          ))}
        </div>
      </div>

      <div style={box}>
        <div style={label} title={LINE_TYPES_DESC}>Line types (front → back)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <select key={i} title={LINE_TYPES_DESC} value={lt[i] ?? 'infantry'} style={numInput}
              onChange={e => { const next = [...lt]; next[i] = e.target.value as UnitType; onChange({ ...profile, lineTypes: next }); }}>
              {UNIT_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          ))}
        </div>
      </div>

      {groups.map(g => (
        <div key={g} style={box}>
          <div style={label}>{g}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {PROFILE_NUM_FIELDS.filter(f => f.group === g).map(f => (
              <label key={f.path} title={f.desc}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  background: 'rgba(255,255,255,.03)', borderRadius: 6, padding: '4px 8px', cursor: 'help' }}>
                <span style={{ fontSize: 12, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
                <input type="number" step={f.step} value={effectiveNum(profile, f.path)} style={{ ...numInput, width: 56, flex: 'none' }}
                  onChange={e => onChange(setNum(profile, f.path, Number(e.target.value)))} />
              </label>
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

  const [reps, setReps] = useState(20);
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    setResult(null);
    // Defer so the "Running…" label paints before the synchronous sim blocks the thread.
    setTimeout(() => {
      setResult(runSeries(profiles.red, profiles.blue, reps));
      setRunning(false);
    }, 20);
  };

  // Benchmark: run one side's profile (in its real color) vs the other configured profile and the
  // standard difficulties, reporting that side's win% per opponent. Opponents run one at a time
  // (setTimeout) so results stream in and the UI doesn't freeze for the whole batch.
  type BenchRow = { label: string; winPct: number; wins: number; reps: number };
  const [bench, setBench] = useState<{ side: Team; rows: BenchRow[]; total: number } | null>(null);
  const benchmark = (side: Team) => {
    const me = profiles[side];
    const opps: { label: string; p: TeamAiProfile }[] = [
      { label: 'OTHER', p: side === 'red' ? profiles.blue : profiles.red },
      { label: 'normal', p: profileFromDifficulty('normal') },
      { label: 'hard', p: profileFromDifficulty('hard') },
      { label: 'test', p: profileFromDifficulty('test') },
    ];
    setBench({ side, rows: [], total: opps.length });
    setRunning(true);
    let i = 0;
    const step = () => {
      if (i >= opps.length) { setRunning(false); return; }
      const opp = opps[i];
      const res = side === 'red' ? runSeries(me, opp.p, reps) : runSeries(opp.p, me, reps);
      const wins = side === 'red' ? res.redWins : res.blueWins;
      setBench(b => b && { ...b, rows: [...b.rows, { label: opp.label, winPct: Math.round(100 * wins / res.reps), wins, reps: res.reps }] });
      i++;
      setTimeout(step, 20);
    };
    setTimeout(step, 20);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: '#e2e8f0', padding: 24, fontFamily: '"Inter", sans-serif', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button onClick={onExit} title="Volver al juego. Al volver, el juego arranca con los perfiles que hayas guardado con Go." style={chip(false)}>← BACK TO GAME</button>
        <h1 style={{ fontSize: 22, margin: 0 }}>AI LAB</h1>
        <button onClick={go} title="Guarda ambos perfiles (rojo/azul) en localStorage como los defaults que usará el juego al abrir." style={{ ...chip(true, '#10b981'), marginLeft: 'auto', fontWeight: 800, padding: '8px 16px' }}>GO — save as game defaults</button>
        {saved && <span style={{ color: '#10b981', fontSize: 13 }}>✓ saved</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <TeamColumn team="red" profile={profiles.red} onChange={p => setTeam('red', p)} />
        <TeamColumn team="blue" profile={profiles.blue} onChange={p => setTeam('blue', p)} />
      </div>
      <div style={{ ...box, marginTop: 16 }}>
        <div style={label} title="Enfrenta el perfil de ROJO contra el de AZUL durante N partidas y agrega el resultado.">Simulation — RED profile vs BLUE profile</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: '#cbd5e1', cursor: 'help' }} title="Cuántas partidas correr. Más reps = resultado menos ruidoso (pero más lento; test arrastra partidas largas).">reps</span>
          <input type="number" min={1} step={1} value={reps} style={numInput} title="Cuántas partidas correr."
            onChange={e => setReps(Math.max(1, Number(e.target.value)))} />
          <button onClick={run} disabled={running} title="Corre la simulación AI-vs-AI con los perfiles de arriba."
            style={{ ...chip(true, '#0ea5e9'), padding: '8px 16px', fontWeight: 800, opacity: running ? 0.6 : 1 }}>
            {running ? 'Running…' : 'RUN'}
          </button>
        </div>
        {result && (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <div><b style={{ color: '#dc2626' }}>RED</b> {Math.round(100 * result.redWins / result.reps)}% <span style={{ color: '#64748b' }}>({result.redWins})</span></div>
            <div><b style={{ color: '#1d4ed8' }}>BLUE</b> {Math.round(100 * result.blueWins / result.reps)}% <span style={{ color: '#64748b' }}>({result.blueWins})</span></div>
            <div><b style={{ color: '#94a3b8' }}>DRAW</b> {Math.round(100 * result.draws / result.reps)}% <span style={{ color: '#64748b' }}>({result.draws})</span></div>
            <div>avg score <b style={{ color: '#dc2626' }}>{result.avgScoreRed.toFixed(0)}</b> : <b style={{ color: '#1d4ed8' }}>{result.avgScoreBlue.toFixed(0)}</b></div>
            <div>avg ticks <b>{result.avgTicks.toFixed(0)}</b></div>
          </div>
        )}
      </div>

      <div style={box}>
        <div style={label} title="Corre el perfil de un bando (en su color real) contra el otro perfil configurado y las dificultades estándar. Muestra el win% del bando contra cada oponente.">Benchmark — un bando vs la otra ai y las dificultades</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button onClick={() => benchmark('red')} disabled={running} title="Corre el perfil de ROJO (como rojo) vs el perfil de azul, normal, hard y test."
            style={{ ...chip(true, '#dc2626'), padding: '8px 16px', fontWeight: 800, opacity: running ? 0.6 : 1 }}>Benchmark RED</button>
          <button onClick={() => benchmark('blue')} disabled={running} title="Corre el perfil de AZUL (como azul) vs el perfil de rojo, normal, hard y test."
            style={{ ...chip(true, '#1d4ed8'), padding: '8px 16px', fontWeight: 800, opacity: running ? 0.6 : 1 }}>Benchmark BLUE</button>
          <span style={{ fontSize: 12, color: '#64748b' }}>usa el campo «reps» de arriba ({reps}/oponente)</span>
        </div>
        {bench && (
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 6 }}>
              <b style={{ color: bench.side === 'red' ? '#dc2626' : '#1d4ed8' }}>{bench.side.toUpperCase()}</b> win% por oponente
              <span style={{ color: '#64748b' }}> — {bench.rows.length}/{bench.total}{running && bench.rows.length < bench.total ? ' …' : ''}</span>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {bench.rows.map(row => (
                <div key={row.label}>
                  <span style={{ color: '#94a3b8' }}>vs {row.label}</span>{' '}
                  <b style={{ color: row.winPct >= 50 ? '#10b981' : '#ef4444' }}>{row.winPct}%</b>
                  <span style={{ color: '#64748b' }}> ({row.wins}/{row.reps})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
