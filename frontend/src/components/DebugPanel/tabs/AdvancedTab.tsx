/**
 * Advanced Features Tab for Debug Panel (Phase 5).
 * Includes Mock Server Mode, Replay Mode, and Performance Metrics.
 */

import { useState, useCallback } from 'react';
import { useMockServer } from '../hooks/useMockServer';
import { useReplay } from '../hooks/useReplay';
import type { PerformanceMetrics, MockResponse } from '../hooks';
import './tabs.css';

// ============================================
// Types
// ============================================

interface AdvancedTabProps {
  performance: PerformanceMetrics;
}

type SubTab = 'metrics' | 'mock' | 'replay';

// ============================================
// Helper Functions
// ============================================

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString();
}

function formatSpeed(speed: number): string {
  return speed === 1 ? '1x' : `${speed}x`;
}

// ============================================
// Sub-Components
// ============================================

/** Performance Metrics Section */
function MetricsSection({ performance }: { performance: PerformanceMetrics }) {
  const [showLatencyChart, setShowLatencyChart] = useState(false);

  // Simple sparkline representation using unicode blocks
  const renderSparkline = () => {
    if (performance.latencySamples.length < 2) return null;
    
    const samples = performance.latencySamples.slice(-20);
    const max = Math.max(...samples.map(s => s.latency));
    const min = Math.min(...samples.map(s => s.latency));
    const range = max - min || 1;

    const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    
    return (
      <div className="debug-sparkline">
        {samples.map((s, i) => {
          const normalized = (s.latency - min) / range;
          const blockIndex = Math.min(Math.floor(normalized * blocks.length), blocks.length - 1);
          return (
            <span 
              key={i} 
              className="debug-sparkline-bar"
              title={`${s.latency}ms`}
            >
              {blocks[blockIndex]}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="debug-advanced-section">
      {/* Connection & Handshake Times */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Timing</span>
        </div>
        <div className="debug-card-body">
          <div className="debug-metrics-grid">
            <div className="debug-metric-item">
              <span className="debug-metric-label">Connection</span>
              <span className="debug-metric-value">
                {formatDuration(performance.connectionTime)}
              </span>
            </div>
            <div className="debug-metric-item">
              <span className="debug-metric-label">Handshake</span>
              <span className="debug-metric-value">
                {formatDuration(performance.handshakeDuration)}
              </span>
            </div>
            <div className="debug-metric-item">
              <span className="debug-metric-label">Avg Latency</span>
              <span className="debug-metric-value">
                {performance.avgMessageLatency > 0 
                  ? `${performance.avgMessageLatency}ms` 
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Message Stats */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Message Throughput</span>
        </div>
        <div className="debug-card-body">
          <div className="debug-throughput-stats">
            <div className="debug-throughput-item">
              <div className="debug-throughput-row">
                <span className="debug-throughput-icon">↑</span>
                <span className="debug-throughput-total">{performance.messageStats.totalSent}</span>
                <span className="debug-throughput-label">total sent</span>
              </div>
              <div className="debug-throughput-rate">
                {performance.messageStats.sentPerMinute}/min
              </div>
            </div>
            <div className="debug-throughput-item">
              <div className="debug-throughput-row">
                <span className="debug-throughput-icon">↓</span>
                <span className="debug-throughput-total">{performance.messageStats.totalReceived}</span>
                <span className="debug-throughput-label">total received</span>
              </div>
              <div className="debug-throughput-rate">
                {performance.messageStats.receivedPerMinute}/min
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Latency Trend */}
      {performance.latencySamples.length > 0 && (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Latency Trend</span>
            <button 
              className="debug-mini-btn"
              onClick={() => setShowLatencyChart(!showLatencyChart)}
            >
              {showLatencyChart ? 'Hide' : 'Show'}
            </button>
          </div>
          {showLatencyChart && (
            <div className="debug-card-body">
              {renderSparkline()}
              <div className="debug-latency-stats">
                <span>Samples: {performance.latencySamples.length}</span>
                <span>
                  Range: {Math.min(...performance.latencySamples.map(s => s.latency))}ms - 
                  {Math.max(...performance.latencySamples.map(s => s.latency))}ms
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Crypto Operations */}
      {Object.keys(performance.cryptoOperationTimes).length > 0 && (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Crypto Operations</span>
          </div>
          <div className="debug-card-body">
            <div className="debug-crypto-metrics">
              {Object.entries(performance.cryptoOperationTimes).map(([op, stats]) => (
                <div key={op} className="debug-crypto-metric-row">
                  <span className="debug-crypto-metric-name">{op}</span>
                  <div className="debug-crypto-metric-stats">
                    <span title="Average">avg: {stats.avg}ms</span>
                    <span title="Min/Max" className="debug-crypto-metric-range">
                      ({stats.min}-{stats.max}ms)
                    </span>
                    <span title="Count" className="debug-crypto-metric-count">
                      ×{stats.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mock Server Section */
function MockServerSection() {
  const {
    state,
    setEnabled,
    addMock,
    updateMock,
    removeMock,
    clearMocks,
    resetStats,
    importMocks,
    exportMocks,
  } = useMockServer();

  const [isAddingMock, setIsAddingMock] = useState(false);
  const [newMock, setNewMock] = useState<Partial<MockResponse>>({
    destination: '/app/',
    delay: 100,
    body: {},
    enabled: true,
  });
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const handleAddMock = useCallback(() => {
    if (newMock.destination) {
      addMock({
        destination: newMock.destination,
        delay: newMock.delay || 100,
        body: newMock.body || {},
        enabled: newMock.enabled !== false,
        description: newMock.description,
      });
      setNewMock({ destination: '/app/', delay: 100, body: {}, enabled: true });
      setIsAddingMock(false);
    }
  }, [newMock, addMock]);

  const handleImport = useCallback(() => {
    if (importMocks(importText)) {
      setImportText('');
      setShowImport(false);
    }
  }, [importText, importMocks]);

  const handleExport = useCallback(() => {
    const json = exportMocks();
    navigator.clipboard.writeText(json);
  }, [exportMocks]);

  return (
    <div className="debug-advanced-section">
      {/* Enable Toggle */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Mock Server</span>
          <label className="debug-toggle-switch">
            <input
              type="checkbox"
              checked={state.isEnabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="debug-toggle-slider"></span>
          </label>
        </div>
        <div className="debug-card-body">
          <div className="debug-row">
            <span className="debug-row-label">Status:</span>
            <span className={`debug-row-value ${state.isEnabled ? 'success' : ''}`}>
              {state.isEnabled ? 'Active' : 'Disabled'}
            </span>
          </div>
          <div className="debug-row">
            <span className="debug-row-label">Mocked:</span>
            <span className="debug-row-value">{state.mockedCount} responses</span>
          </div>
          {state.lastMockedAt && (
            <div className="debug-row">
              <span className="debug-row-label">Last mock:</span>
              <span className="debug-row-value mono">{formatTime(state.lastMockedAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Mock Configurations */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Mock Responses</span>
          <span className="debug-count-badge">{state.mocks.length}</span>
        </div>
        <div className="debug-card-body debug-card-body-scroll">
          {state.mocks.length === 0 ? (
            <div className="debug-empty">No mock responses configured</div>
          ) : (
            <div className="debug-mock-list">
              {state.mocks.map((mock) => (
                <div key={mock.id} className="debug-mock-item">
                  <div className="debug-mock-header">
                    <label className="debug-mock-enable">
                      <input
                        type="checkbox"
                        checked={mock.enabled}
                        onChange={(e) => updateMock(mock.id, { enabled: e.target.checked })}
                      />
                    </label>
                    <span className="debug-mock-dest">{mock.destination}</span>
                    <span className="debug-mock-delay">{mock.delay}ms</span>
                    <button 
                      className="debug-mock-remove"
                      onClick={() => removeMock(mock.id)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                  {mock.description && (
                    <div className="debug-mock-desc">{mock.description}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add New Mock */}
      {isAddingMock ? (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Add Mock Response</span>
          </div>
          <div className="debug-card-body">
            <div className="debug-mock-form">
              <div className="debug-form-row">
                <label>Destination:</label>
                <input
                  type="text"
                  value={newMock.destination || ''}
                  onChange={(e) => setNewMock({ ...newMock, destination: e.target.value })}
                  placeholder="/app/..."
                />
              </div>
              <div className="debug-form-row">
                <label>Delay (ms):</label>
                <input
                  type="number"
                  value={newMock.delay || 100}
                  onChange={(e) => setNewMock({ ...newMock, delay: parseInt(e.target.value) || 100 })}
                  min={0}
                  max={10000}
                />
              </div>
              <div className="debug-form-row">
                <label>Description:</label>
                <input
                  type="text"
                  value={newMock.description || ''}
                  onChange={(e) => setNewMock({ ...newMock, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <div className="debug-form-actions">
                <button onClick={handleAddMock}>Add</button>
                <button onClick={() => setIsAddingMock(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      ) : showImport ? (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Import Mocks</span>
          </div>
          <div className="debug-card-body">
            <textarea
              className="debug-import-textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste JSON array of mock configurations..."
              rows={4}
            />
            <div className="debug-form-actions">
              <button onClick={handleImport}>Import</button>
              <button onClick={() => setShowImport(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="debug-mock-actions">
          <button onClick={() => setIsAddingMock(true)}>Add Mock</button>
          <button onClick={() => setShowImport(true)}>Import</button>
          <button onClick={handleExport}>Export</button>
          <button onClick={clearMocks} disabled={state.mocks.length === 0}>Clear All</button>
          <button onClick={resetStats}>Reset Stats</button>
        </div>
      )}
    </div>
  );
}

/** Replay Section */
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
    
    // Try debug export format first
    let success = importFromDebugExport(importText);
    
    // Try raw messages array
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
      {/* Replay Status */}
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

              {/* Progress Bar */}
              <div className="debug-replay-progress">
                <div 
                  className="debug-replay-progress-bar"
                  style={{ transform: `scaleX(${state.progress / 100})` }}
                />
              </div>

              {/* Playback Controls */}
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

              {/* Speed Control */}
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

              {/* Session Actions — Save is DEV-only; persist is a no-op in production. */}
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

      {/* Import Section */}
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

      {/* Saved Sessions */}
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

      {/* Message Scrubber */}
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

// ============================================
// Main Component
// ============================================

export function AdvancedTab({ performance }: AdvancedTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('metrics');

  return (
    <div className="debug-tab-content">
      {/* Sub-Tab Navigation */}
      <div className="debug-subtabs">
        <button
          className={`debug-subtab ${activeSubTab === 'metrics' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('metrics')}
        >
          📊 Metrics
        </button>
        <button
          className={`debug-subtab ${activeSubTab === 'mock' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('mock')}
        >
          🎭 Mock
        </button>
        <button
          className={`debug-subtab ${activeSubTab === 'replay' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('replay')}
        >
          ⏮ Replay
        </button>
      </div>

      {/* Sub-Tab Content */}
      {activeSubTab === 'metrics' && <MetricsSection performance={performance} />}
      {activeSubTab === 'mock' && <MockServerSection />}
      {activeSubTab === 'replay' && <ReplaySection />}
    </div>
  );
}
