import { useState } from 'react';
import { GestureProvider, useGestures } from './gesture/GestureProvider';
import { HandOverlay } from './components/HandOverlay';
import { CameraPip } from './components/CameraPip';
import LayoutMode from './modes/LayoutMode';
import NodesMode from './modes/NodesMode';
import JarvisMode from './modes/JarvisMode';

type ModeId = 'layout' | 'nodes' | 'jarvis';

const MODES: Array<{ id: ModeId; label: string; hint: string }> = [
  { id: 'layout', label: 'Layout', hint: 'Pinch blocks from the shelf, drop them on the canvas' },
  { id: 'nodes', label: 'Nodes', hint: 'Pinch-drag nodes; pinch a port, release on another node to wire' },
  { id: 'jarvis', label: 'Jarvis', hint: 'Point at panels, pinch to press buttons' },
];

function Shell() {
  const [mode, setMode] = useState<ModeId>('layout');
  const [showHelp, setShowHelp] = useState(true);
  const { status, source, fps, setSource } = useGestures();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" /> GestureWatcher
        </div>
        <nav className="tabs">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`tab ${mode === m.id ? 'active' : ''}`}
              onClick={() => setMode(m.id)}
              data-mode-tab={m.id}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="statusbar">
          <button
            className="source-toggle"
            onClick={() => setSource(source === 'camera' ? 'mouse' : 'camera')}
            title="Toggle between camera hand-tracking and mouse simulation"
          >
            {source === 'camera' ? '📷 camera' : '🖱️ mouse'}
          </button>
          <span className={`status-pill status-${status}`}>{status}</span>
          <span className="fps">{fps} fps</span>
          <button className="help-btn" onClick={() => setShowHelp((v) => !v)}>
            ?
          </button>
        </div>
      </header>

      <main className="stage">
        {mode === 'layout' && <LayoutMode />}
        {mode === 'nodes' && <NodesMode />}
        {mode === 'jarvis' && <JarvisMode />}
      </main>

      {showHelp && (
        <div className="help-card" onClick={() => setShowHelp(false)}>
          <h2>Hand controls</h2>
          <ul>
            <li><b>Move</b> — raise a hand; the ring follows your thumb + index</li>
            <li><b>Pinch</b> (thumb + index) — grab / click / drag</li>
            <li><b>Release pinch</b> — drop</li>
            <li><b>Two hands</b> — supported everywhere</li>
          </ul>
          <p className="help-mode-hint">{MODES.find((m) => m.id === mode)?.hint}</p>
          <p className="help-dismiss">
            No camera? It falls back to mouse mode (click = pinch). Click to dismiss.
          </p>
        </div>
      )}

      {status === 'loading' && (
        <div className="loading-veil">Warming up hand tracking…</div>
      )}

      <HandOverlay />
      <CameraPip />
    </div>
  );
}

export default function App() {
  return (
    <GestureProvider>
      <Shell />
    </GestureProvider>
  );
}
