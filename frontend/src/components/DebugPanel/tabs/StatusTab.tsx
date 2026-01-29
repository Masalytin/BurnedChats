/**
 * WebSocket Status Tab for Debug Panel.
 * Displays connection status, subscriptions, and message stats.
 */

import type { WebSocketDebugState } from '../hooks/useDebugState';
import './tabs.css';

interface StatusTabProps {
  state: WebSocketDebugState;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString();
}

export function StatusTab({ state }: StatusTabProps) {
  const statusEmoji = {
    connected: '🟢',
    connecting: '🟡',
    reconnecting: '🟠',
    disconnected: '🔴',
  }[state.status];

  const statusLabel = {
    connected: 'Connected',
    connecting: 'Connecting...',
    reconnecting: 'Reconnecting...',
    disconnected: 'Disconnected',
  }[state.status];

  return (
    <div className="debug-tab-content">
      {/* Connection Status */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Connection</span>
          <span className={`debug-status-badge status-${state.status}`}>
            {statusEmoji} {statusLabel}
          </span>
        </div>
        
        <div className="debug-card-body">
          {state.status === 'connected' && state.connectionDuration > 0 && (
            <div className="debug-row">
              <span className="debug-row-label">Uptime:</span>
              <span className="debug-row-value">{formatDuration(state.connectionDuration)}</span>
            </div>
          )}
          
          {state.reconnectAttempt > 0 && (
            <div className="debug-row">
              <span className="debug-row-label">Reconnect attempts:</span>
              <span className="debug-row-value warn">{state.reconnectAttempt}</span>
            </div>
          )}

          {state.lastConnectedAt && (
            <div className="debug-row">
              <span className="debug-row-label">Last connected:</span>
              <span className="debug-row-value mono">{formatTime(state.lastConnectedAt)}</span>
            </div>
          )}

          {state.lastDisconnectedAt && (
            <div className="debug-row">
              <span className="debug-row-label">Last disconnected:</span>
              <span className="debug-row-value mono">{formatTime(state.lastDisconnectedAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {state.error && (
        <div className="debug-card error">
          <div className="debug-card-header">
            <span className="debug-card-title">Error</span>
            <span className={`debug-error-badge ${state.error.recoverable ? 'recoverable' : 'fatal'}`}>
              {state.error.recoverable ? 'Recoverable' : 'Fatal'}
            </span>
          </div>
          <div className="debug-card-body">
            <div className="debug-row">
              <span className="debug-row-label">Type:</span>
              <span className="debug-row-value mono">{state.error.type}</span>
            </div>
            <div className="debug-row">
              <span className="debug-row-label">Message:</span>
              <span className="debug-row-value">{state.error.message}</span>
            </div>
          </div>
        </div>
      )}

      {/* Subscriptions */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Active Subscriptions</span>
          <span className="debug-count-badge">{state.activeSubscriptions.length}</span>
        </div>
        
        <div className="debug-card-body">
          {state.activeSubscriptions.length === 0 ? (
            <div className="debug-empty">No active subscriptions</div>
          ) : (
            <ul className="debug-subscription-list">
              {state.activeSubscriptions.map((sub, i) => (
                <li key={i} className="debug-subscription-item">
                  <span className="debug-subscription-icon">✓</span>
                  <span className="debug-subscription-dest">{sub}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Stored Subscriptions (for reconnect) */}
      {state.storedSubscriptions.length > state.activeSubscriptions.length && (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Pending Subscriptions</span>
            <span className="debug-count-badge warn">
              {state.storedSubscriptions.length - state.activeSubscriptions.length}
            </span>
          </div>
          
          <div className="debug-card-body">
            <ul className="debug-subscription-list">
              {state.storedSubscriptions
                .filter(sub => !state.activeSubscriptions.includes(sub))
                .map((sub, i) => (
                  <li key={i} className="debug-subscription-item pending">
                    <span className="debug-subscription-icon">○</span>
                    <span className="debug-subscription-dest">{sub}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {/* Message Stats */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Message Stats</span>
        </div>
        
        <div className="debug-card-body">
          <div className="debug-stats-row">
            <div className="debug-stat">
              <span className="debug-stat-icon">↑</span>
              <span className="debug-stat-value">{state.messagesSent}</span>
              <span className="debug-stat-label">sent</span>
            </div>
            <div className="debug-stat">
              <span className="debug-stat-icon">↓</span>
              <span className="debug-stat-value">{state.messagesReceived}</span>
              <span className="debug-stat-label">received</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
