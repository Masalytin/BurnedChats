/**
 * Crypto State Tab for Debug Panel.
 * Displays keyStore state and crypto operation history.
 */

import type { CryptoDebugState, CryptoSessionDebugState, CryptoOperationEntry } from '../hooks/useDebugState';
import type { FingerprintColor } from '@/types';
import './tabs.css';

interface CryptoTabProps {
  state: CryptoDebugState;
}

/** Map fingerprint color name to CSS color value */
function getColorValue(color: FingerprintColor): string {
  const colorMap: Record<FingerprintColor, string> = {
    red: '#f87171',
    blue: '#60a5fa',
    green: '#4ade80',
    purple: '#c084fc',
    orange: '#fb923c',
    cyan: '#22d3d8',
  };
  return colorMap[color] || '#888';
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function SessionCard({ session }: { session: CryptoSessionDebugState }) {
  const completionSteps = [
    { label: 'Key Pair', has: session.hasKeyPair },
    { label: 'Peer Key', has: session.hasPeerPublicKey },
    { label: 'Shared Secret', has: session.hasSharedSecret },
    { label: 'AES Key', has: session.hasAESKey },
  ];

  const completedCount = completionSteps.filter(s => s.has).length;
  const isComplete = completedCount === completionSteps.length;

  return (
    <div className={`debug-crypto-session ${isComplete ? 'complete' : 'partial'}`}>
      <div className="debug-crypto-session-header">
        <span className="debug-crypto-session-id" title={session.sessionId}>
          {session.sessionId.slice(0, 12)}...
        </span>
        <span className={`debug-crypto-session-status ${isComplete ? 'complete' : 'partial'}`}>
          {isComplete ? '🔐 Complete' : `⏳ ${completedCount}/${completionSteps.length}`}
        </span>
      </div>

      <div className="debug-crypto-session-body">
        {/* Key completion checkmarks */}
        <div className="debug-crypto-keys">
          {completionSteps.map((step, i) => (
            <div key={i} className={`debug-crypto-key ${step.has ? 'has' : 'missing'}`}>
              <span className="debug-crypto-key-icon">{step.has ? '✓' : '○'}</span>
              <span className="debug-crypto-key-label">{step.label}</span>
            </div>
          ))}
        </div>

        {/* Fingerprint */}
        {session.fingerprint && (
          <div className="debug-crypto-fingerprint">
            <span className="debug-crypto-fingerprint-label">Fingerprint:</span>
            <code className="debug-crypto-fingerprint-value">{session.fingerprint}</code>
          </div>
        )}

        {/* Visual Fingerprint */}
        {session.visualFingerprint && session.visualFingerprint.length > 0 && (
          <div className="debug-crypto-visual">
            <span className="debug-crypto-visual-label">Visual:</span>
            <div className="debug-crypto-visual-grid">
              {session.visualFingerprint.map((element, index) => (
                <span 
                  key={index} 
                  className="debug-crypto-visual-cell"
                  style={{ color: getColorValue(element.color) }}
                >
                  {element.shape}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Created timestamp */}
        <div className="debug-crypto-created">
          Created: {formatTime(session.createdAt)}
        </div>
      </div>
    </div>
  );
}

function OperationLog({ operations }: { operations: CryptoOperationEntry[] }) {
  if (operations.length === 0) {
    return <div className="debug-empty">No crypto operations recorded</div>;
  }

  // Group operations by session
  const reversed = [...operations].reverse();

  return (
    <div className="debug-crypto-operations">
      {reversed.map((op, i) => (
        <div key={i} className={`debug-crypto-op ${op.success ? 'success' : 'error'}`}>
          <span className="debug-crypto-op-icon">{op.success ? '✓' : '✕'}</span>
          <span className="debug-crypto-op-name">{op.operation}</span>
          <span className="debug-crypto-op-duration">{formatDuration(op.durationMs)}</span>
          <span className="debug-crypto-op-time">{formatTime(op.timestamp)}</span>
          {op.error && (
            <span className="debug-crypto-op-error">{op.error}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function CryptoTab({ state }: CryptoTabProps) {
  return (
    <div className="debug-tab-content">
      {/* Sessions Overview */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Key Store Sessions</span>
          <span className="debug-count-badge">{state.sessions.length}</span>
        </div>
        
        <div className="debug-card-body">
          {state.sessions.length === 0 ? (
            <div className="debug-empty">No sessions in keyStore</div>
          ) : (
            <div className="debug-crypto-sessions">
              {state.sessions.map((session) => (
                <SessionCard key={session.sessionId} session={session} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Operations */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Recent Crypto Operations</span>
          <span className="debug-count-badge">{state.operations.length}</span>
        </div>
        
        <div className="debug-card-body debug-card-body-scroll">
          <OperationLog operations={state.operations} />
        </div>
      </div>

      {/* Crypto API Status */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Web Crypto API</span>
        </div>
        
        <div className="debug-card-body">
          <div className="debug-crypto-api-status">
            <div className="debug-row">
              <span className="debug-row-label">Available:</span>
              <span className={`debug-row-value ${typeof crypto !== 'undefined' && crypto.subtle ? 'success' : 'error'}`}>
                {typeof crypto !== 'undefined' && crypto.subtle ? '✓ Yes' : '✕ No'}
              </span>
            </div>
            <div className="debug-row">
              <span className="debug-row-label">Algorithms:</span>
              <span className="debug-row-value mono">ECDH P-256, AES-GCM, HKDF</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
