import { useState, useEffect, useRef, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';
import './DebugPanel.css';

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
}

// Global log storage
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

/**
 * Debug Panel component for production debugging
 */
export function DebugPanel({ 
  isConnected, 
  isConnecting, 
  reconnectAttempt,
  wsError 
}: DebugPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(globalLogs);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // WS URL from env
  const wsUrl = import.meta.env.VITE_WS_URL || '/ws';
  
  // Telegram info
  const initData = WebApp.initData;
  const hasInitData = Boolean(initData && initData.length > 0);
  const platform = WebApp.platform;
  const version = WebApp.version;

  // Subscribe to log updates
  useEffect(() => {
    const updateLogs = () => setLogs([...globalLogs]);
    listeners.add(updateLogs);
    return () => { listeners.delete(updateLogs); };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isExpanded) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isExpanded]);

  // Test WebSocket URL directly
  const testConnection = useCallback(async () => {
    debugLog('info', 'Testing connection...', { wsUrl });
    
    try {
      // Test /ws/info endpoint (SockJS info endpoint)
      const infoUrl = wsUrl.replace(/\/$/, '') + '/info';
      debugLog('info', `Fetching ${infoUrl}`);
      
      const response = await fetch(infoUrl);
      const text = await response.text();
      
      if (response.ok) {
        debugLog('success', 'SockJS info endpoint OK', { status: response.status, body: text });
      } else {
        debugLog('error', 'SockJS info endpoint failed', { status: response.status, body: text });
      }
    } catch (error) {
      debugLog('error', 'Connection test failed', { error: String(error) });
    }
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

  const statusIcon = isConnected ? '🟢' : isConnecting ? '🟡' : '🔴';
  const statusText = isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected';

  return (
    <div className={`debug-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      {/* Toggle button */}
      <button 
        className="debug-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        🐛 Debug {statusIcon}
      </button>

      {isExpanded && (
        <div className="debug-content">
          {/* Status section */}
          <div className="debug-section">
            <h4>Connection Status</h4>
            <div className="debug-status">
              <span className="debug-label">Status:</span>
              <span className={`debug-value status-${isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}>
                {statusText}
              </span>
            </div>
            {reconnectAttempt > 0 && (
              <div className="debug-status">
                <span className="debug-label">Reconnect attempt:</span>
                <span className="debug-value">{reconnectAttempt}</span>
              </div>
            )}
            {wsError && (
              <div className="debug-status error">
                <span className="debug-label">Error:</span>
                <span className="debug-value">{wsError.type}: {wsError.message}</span>
              </div>
            )}
          </div>

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
            <button onClick={testConnection}>Test /ws/info</button>
            <button onClick={copyLogs}>Copy Logs</button>
            <button onClick={clearDebugLogs}>Clear</button>
          </div>

          {/* Logs section */}
          <div className="debug-section">
            <h4>Logs ({logs.length})</h4>
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
        </div>
      )}
    </div>
  );
}
