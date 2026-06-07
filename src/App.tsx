import { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { AiLab } from './ai-lab/AiLab';

type Screen = 'game' | 'ai-lab';

function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(window.location.search).get('screen') === 'ai-lab' ? 'ai-lab' : 'game');

  if (screen === 'ai-lab') return <AiLab onExit={() => setScreen('game')} />;

  return (
    <div className="App">
      <GameCanvas />
      <button
        onClick={() => setScreen('ai-lab')}
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 200, padding: '10px 16px', borderRadius: 10,
          background: '#0ea5e9', color: '#04121c', border: 'none', fontWeight: 800, cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,.5)',
        }}>
        AI LAB
      </button>
    </div>
  );
}

export default App;
