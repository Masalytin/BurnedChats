import { useState, useEffect, useRef, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';
import { StatusTab } from './tabs/StatusTab';
import { FlowTab } from './tabs/FlowTab';
import { CryptoTab } from './tabs/CryptoTab';
import { useDebugState } from './hooks/useDebugState';
import type { CreateSessionResult } from '@/hooks/useSession';
import type { HandshakeResult } from '@/hooks/useHandshake';
import './DebugPanel.css';

// ============================================
// Types
// ============================================

interface LogEntry {
  id: number;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: unknown;
}

interface DebugPanelProps {
  isConnected: boolean;
  isConnecting: boolean;
  reconnectAttempt: number;
  wsError: { type: string; message: string; recoverable: boolean } | null;
  /** Active WebSocket subscriptions */
  activeSubscriptions?: string[];
  /** Stored subscriptions (for reconnect) */
  storedSubscriptions?: string[];
  /** Session creation result from useSession */
  sessionResult?: CreateSessionResult;
  /** Handshake result from useHandshake */
  handshakeResult?: HandshakeResult;
}

type TabId = 'status' | 'flow' | 'crypto' | 'logs';

// ============================================
// Global Log Storage
// ============================================

let globalLogs: LogEntry[] = [];
let logId = 0;
let listeners: Set<() => void> = new Set();

/**
 * Add a debug log entry from anywhere in the app
 */
export function debugLog(
  level: LogEntry['level'], 
  message: string, 
  data?: unknown
) {
  const entry: LogEntry = {
    id: logId++,
    timestamp: new Date(),
    level,
    message,
    data,
  };
  
  globalLogs = [...globalLogs.slice(-99), entry]; // Keep last 100
  listeners.forEach(fn => fn());
  
  // Also log to console
  const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[consoleMethod](`[Debug] ${message}`, data ?? '');
}

/**
 * Clear all debug logs
 */
export function clearDebugLogs() {
  globalLogs = [];
  listeners.forEach(fn => fn());
}

// ============================================
// Tab Configuration
// ============================================

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'status', label: 'Status', icon: '📡' },
  { id: 'flow', label: 'Flow', icon: '🔄' },
  { id: 'crypto', label: 'Crypto', icon: '🔐' },
  { id: 'logs', label: 'Logs', icon: '📋' },
];

// ============================================
// Component
// ============================================

/**
 * Debug Panel component for production debugging
 */
export function DebugPanel({ 
  isConnected, 
  isConnecting, 
  reconnectAttempt,
  wsError,
  activeSubscriptions = [],
  storedSubscriptions = [],
  sessionResult,
  handshakeResult,
}: DebugPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('status');
  const [logs, setLogs] = useState<LogEntry[]>(globalLogs);
  const [isPaused, setIsPaused] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // WS URL from env
  const wsUrl = import.meta.env.VITE_WS_URL || '/ws';
  
  // Telegram info
  const initData = WebApp.initData;
  const hasInitData = Boolean(initData && initData.length > 0);
  const platform = WebApp.platform;
  const version = WebApp.version;

  // Use centralized debug state
  const debugState = useDebugState({
    isConnected,
    isConnecting,
    reconnectAttempt,
    wsError,
    activeSubscriptions,
    storedSubscriptions,
    sessionResult,
    handshakeResult,
  });

  // Subscribe to log updates (respects pause)
  useEffect(() => {
    const updateLogs = () => {
      if (!isPaused) {
        setLogs([...globalLogs]);
      }
    };
    listeners.add(updateLogs);
    return () => { listeners.delete(updateLogs); };
  }, [isPaused]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isExpanded && !isPaused && activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isExpanded, isPaused, activeTab]);

  // Test WebSocket URL directly - copies result to clipboard
  const testConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    
    const infoUrl = wsUrl.replace(/\/$/, '') + '/info';
    let resultText = `=== /ws/info Test ===\nURL: ${infoUrl}\nTime: ${new Date().toISOString()}\n\n`;
    
    try {
      const response = await fetch(infoUrl);
      const text = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      
      resultText += `Status: ${response.status} ${response.statusText}\n`;
      resultText += `Headers: ${JSON.stringify(headers, null, 2)}\n`;
      resultText += `Body: ${text}\n`;
      
      if (response.ok) {
        resultText += `\n✅ SUCCESS`;
      } else {
        resultText += `\n❌ FAILED`;
      }
    } catch (error) {
      resultText += `Error: ${String(error)}\n`;
      resultText += `\n❌ FAILED (network error)`;
    }
    
    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(resultText);
      resultText += `\n\n📋 Copied to clipboard!`;
    } catch {
      resultText += `\n\n⚠️ Could not copy to clipboard`;
    }
    
    setTestResult(resultText);
    setIsTesting(false);
  }, [wsUrl]);

  // Copy logs to clipboard
  const copyLogs = useCallback(() => {
    const logText = logs.map(l => 
      `[${l.timestamp.toISOString()}] [${l.level.toUpperCase()}] ${l.message}${l.data ? '\n  ' + JSON.stringify(l.data) : ''}`
    ).join('\n');
    
    navigator.clipboard.writeText(logText).then(() => {
      debugLog('success', 'Logs copied to clipboard');
    }).catch(err => {
      debugLog('error', 'Failed to copy logs', { error: String(err) });
    });
  }, [logs]);

  // Export full debug state
  const exportState = useCallback(() => {
    const exportData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      env: {
        mode: import.meta.env.MODE,
        wsUrl,
        telegram: {
          initData: hasInitData,
          platform,
          version,
        },
      },
      websocket: debugState.websocket,
      sessionFlow: debugState.sessionFlow,
      crypto: {
        sessionCount: debugState.crypto.sessions.length,
        sessions: debugState.crypto.sessions.map(s => ({
          sessionId: s.sessionId.slice(0, 8) + '...',
          hasKeyPair: s.hasKeyPair,
          hasPeerPublicKey: s.hasPeerPublicKey,
          hasSharedSecret: s.hasSharedSecret,
          fingerprint: s.fingerprint,
        })),
        recentOperations: debugState.crypto.operations.slice(-10),
      },
      timeline: debugState.timeline,
      logs: logs.slice(-50).map(l => ({
        time: l.timestamp.toISOString(),
        level: l.level,
        message: l.message,
        data: l.data,
      })),
    };

    const json = JSON.stringify(exportData, null, 2);
    
    navigator.clipboard.writeText(json).then(() => {
      debugLog('success', 'Debug state exported to clipboard');
    }).catch(err => {
      debugLog('error', 'Failed to export state', { error: String(err) });
    });
  }, [debugState, logs, wsUrl, hasInitData, platform, version]);

  const statusIcon = isConnected ? '🟢' : isConnecting ? '🟡' : '🔴';
  const hasErrors = logs.some(l => l.level === 'error');
  const errorCount = logs.filter(l => l.level === 'error').length;

  return (
    <div className={`debug-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      {/* Toggle button */}
      <button 
        className={`debug-toggle ${hasErrors ? 'has-errors' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        🐛 Debug {statusIcon}
        {hasErrors && <span className="debug-error-count">{errorCount}</span>}
      </button>

      {isExpanded && (
        <div className="debug-content">
          {/* Tab Navigation */}
          <div className="debug-tabs">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`debug-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="debug-tab-icon">{tab.icon}</span>
                <span className="debug-tab-label">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="debug-tab-container">
            {activeTab === 'status' && (
              <StatusTab state={debugState.websocket} />
            )}

            {activeTab === 'flow' && (
              <FlowTab 
                state={debugState.sessionFlow} 
                timeline={debugState.timeline}
              />
            )}

            {activeTab === 'crypto' && (
              <CryptoTab state={debugState.crypto} />
            )}

            {activeTab === 'logs' && (
              <>
                {/* Config section */}
                <div className="debug-section">
                  <h4>Configuration</h4>
                  <div className="debug-status">
                    <span className="debug-label">WS URL:</span>
                    <span className="debug-value mono">{wsUrl}</span>
                  </div>
                  <div className="debug-status">
                    <span className="debug-label">Mode:</span>
                    <span className="debug-value">{import.meta.env.MODE}</span>
                  </div>
                </div>

                {/* Telegram section */}
                <div className="debug-section">
                  <h4>Telegram</h4>
                  <div className="debug-status">
                    <span className="debug-label">initData:</span>
                    <span className={`debug-value ${hasInitData ? 'status-connected' : 'status-disconnected'}`}>
                      {hasInitData ? `Yes (${initData.length} chars)` : 'No'}
                    </span>
                  </div>
                  <div className="debug-status">
                    <span className="debug-label">Platform:</span>
                    <span className="debug-value">{platform || 'unknown'}</span>
                  </div>
                  <div className="debug-status">
                    <span className="debug-label">Version:</span>
                    <span className="debug-value">{version || 'unknown'}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="debug-actions">
                  <button onClick={testConnection} disabled={isTesting}>
                    {isTesting ? 'Testing...' : 'Test /ws/info'}
                  </button>
                  <button onClick={copyLogs}>Copy Logs</button>
                  <button onClick={exportState}>Export State</button>
                  <button 
                    onClick={() => setIsPaused(!isPaused)}
                    className={isPaused ? 'active' : ''}
                  >
                    {isPaused ? '▶️ Resume' : '⏸️ Pause'}
                  </button>
                  <button onClick={clearDebugLogs}>Clear</button>
                </div>

                {/* Test Result (shown prominently) */}
                {testResult && (
                  <div className="debug-section">
                    <h4>
                      Test Result 
                      <button 
                        className="debug-close-btn"
                        onClick={() => setTestResult(null)}
                      >
                        ✕
                      </button>
                    </h4>
                    <pre className="debug-test-result">{testResult}</pre>
                  </div>
                )}

                {/* Logs section */}
                <div className="debug-section">
                  <h4>
                    Logs ({logs.length})
                    {isPaused && <span className="debug-paused-badge">PAUSED</span>}
                  </h4>
                  <div className="debug-logs">
                    {logs.length === 0 ? (
                      <div className="debug-log-empty">No logs yet</div>
                    ) : (
                      logs.map(log => (
                        <div key={log.id} className={`debug-log-entry log-${log.level}`}>
                          <span className="debug-log-time">
                            {log.timestamp.toLocaleTimeString()}
                          </span>
                          <span className="debug-log-level">{log.level.toUpperCase()}</span>
                          <span className="debug-log-message">{log.message}</span>
                          {log.data !== undefined && (
                            <pre className="debug-log-data">
                              {typeof log.data === 'string' 
                                ? log.data 
                                : JSON.stringify(log.data, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))
                    )}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
