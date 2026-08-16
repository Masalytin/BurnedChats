/**
 * Advanced tab for Debug Panel — Replay only (IMP-DBGPANEL-10).
 * Mock server and unwired Metrics (timing/latency that never started) were removed.
 */

import { useState, useCallback } from 'react';
import { useReplay } from '../hooks/useReplay';
import './tabs.css';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatSpeed(speed: number): string {
  return speed === 1 ? '1x' : `${speed}x`;
}

function ReplaySection() {
  const {
    state,
    importMessages,
    importFromDebugExport,
    play,
    pause,
    stop,
    stepForward,
    stepBackward,
    jumpTo,
    setPlaybackSpeed,
    saveSession,
    loadSession,
    deleteSession,
    clearSession,
  } = useReplay();

  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImport = useCallback(() => {
    setImportError(null);

    let success = importFromDebugExport(importText);

    if (!success) {
      success = importMessages(importText);
    }

    if (success) {
      setImportText('');
      setShowImport(false);
    } else {
      setImportError('Invalid format. Expected STOMP messages array or debug export JSON.');
    }
  }, [importText, importMessages, importFromDebugExport]);

  const handlePasteImport = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setImportText(text);
    } catch {
      setImportError('Failed to read clipboard');
    }
  }, []);

  const statusIcon = {
    idle: '⏹',
    playing: '▶',
    paused: '⏸',
    complete: '✓',
  }[state.status];

  const speedOptions = [0.25, 0.5, 1, 2, 4, 10];

  return (
    <div className="debug-advanced-section">
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Replay</span>
          <span className="debug-replay-status">{statusIcon} {state.status}</span>
        </div>
        <div className="debug-card-body">
          {state.session ? (
            <>
              <div className="debug-row">
                <span className="debug-row-label">Session:</span>
                <span className="debug-row-value">{state.session.name}</span>
              </div>
              <div className="debug-row">
                <span className="debug-row-label">Messages:</span>
                <span className="debug-row-value">
                  {state.currentIndex + 1} / {state.session.messages.length}
                </span>
              </div>
              <div className="debug-row">
                <span className="debug-row-label">Duration:</span>
                <span className="debug-row-value">
                  {formatDuration(state.session.totalDuration)}
                </span>
              </div>

              <div className="debug-replay-progress">
                <div
                  className="debug-replay-progress-bar"
                  style={{ transform: `scaleX(${state.progress / 100})` }}
                />
              </div>

              <div className="debug-replay-controls">
                <button onClick={stepBackward} disabled={state.currentIndex <= 0} title="Step Back">
                  ⏮
                </button>
                {state.status === 'playing' ? (
                  <button onClick={pause} title="Pause">⏸</button>
                ) : (
                  <button onClick={play} title="Play">▶</button>
                )}
                <button onClick={stop} title="Stop">⏹</button>
                <button
                  onClick={stepForward}
                  disabled={state.session && state.currentIndex >= state.session.messages.length - 1}
                  title="Step Forward"
                >
                  ⏭
                </button>
              </div>

              <div className="debug-replay-speed">
                <span className="debug-replay-speed-label">Speed:</span>
                <div className="debug-replay-speed-buttons">
                  {speedOptions.map((speed) => (
                    <button
                      key={speed}
                      className={state.playbackSpeed === speed ? 'active' : ''}
                      onClick={() => setPlaybackSpeed(speed)}
                    >
                      {formatSpeed(speed)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="debug-replay-session-actions">
                {import.meta.env.DEV && (
                  <button onClick={saveSession}>Save Session</button>
                )}
                <button onClick={clearSession}>Clear</button>
              </div>
            </>
          ) : (
            <div className="debug-empty">
              No replay session loaded. Import messages to start.
            </div>
          )}
        </div>
      </div>

      {showImport ? (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Import Messages</span>
          </div>
          <div className="debug-card-body">
            <textarea
              className="debug-import-textarea"
              value={importText}
              onChange={(e) => { setImportText(e.target.value); setImportError(null); }}
              placeholder="Paste exported STOMP messages or debug state JSON..."
              rows={6}
            />
            {importError && (
              <div className="debug-import-error">{importError}</div>
            )}
            <div className="debug-form-actions">
              <button onClick={handlePasteImport}>Paste from Clipboard</button>
              <button onClick={handleImport} disabled={!importText}>Import</button>
              <button onClick={() => { setShowImport(false); setImportError(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        !state.session && (
          <div className="debug-replay-import-actions">
            <button onClick={() => setShowImport(true)}>Import Messages</button>
          </div>
        )
      )}

      {state.savedSessions.length > 0 && (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Saved Sessions</span>
            <span className="debug-count-badge">{state.savedSessions.length}</span>
          </div>
          <div className="debug-card-body debug-card-body-scroll">
            <div className="debug-saved-sessions">
              {state.savedSessions.map((session) => (
                <div
                  key={session.id}
                  className={`debug-saved-session ${state.session?.id === session.id ? 'active' : ''}`}
                >
                  <div className="debug-saved-session-info">
                    <span className="debug-saved-session-name">{session.name}</span>
                    <span className="debug-saved-session-meta">
                      {session.messages.length} msgs • {formatDuration(session.totalDuration)}
                    </span>
                  </div>
                  <div className="debug-saved-session-actions">
                    <button onClick={() => loadSession(session.id)} title="Load">▶</button>
                    <button onClick={() => deleteSession(session.id)} title="Delete">✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {state.session && state.session.messages.length > 1 && (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Message Timeline</span>
          </div>
          <div className="debug-card-body">
            <input
              type="range"
              min={0}
              max={state.session.messages.length - 1}
              value={state.currentIndex}
              onChange={(e) => jumpTo(parseInt(e.target.value))}
              className="debug-replay-scrubber"
            />
            <div className="debug-replay-scrubber-labels">
              <span>0</span>
              <span>{state.session.messages.length - 1}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdvancedTab() {
  return (
    <div className="debug-tab-content">
      <ReplaySection />
    </div>
  );
}
