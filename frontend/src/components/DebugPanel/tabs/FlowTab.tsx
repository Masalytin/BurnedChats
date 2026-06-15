/**
 * Session Flow Tab for Debug Panel.
 * Displays current session flow state and timeline.
 */

import type { SessionFlowState, TimelineEvent } from '../hooks/useDebugState';
import './tabs.css';

interface FlowTabProps {
  state: SessionFlowState;
  timeline: TimelineEvent[];
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function getFlowLabel(flow: SessionFlowState['currentFlow']): string {
  return {
    none: 'Idle',
    searching: 'Searching User',
    creating: 'Creating Session',
    pending: 'Waiting for Accept',
    incoming: 'Incoming Request',
    handshaking: 'Key Exchange',
    active: 'Chat Active',
  }[flow];
}

function getFlowEmoji(flow: SessionFlowState['currentFlow']): string {
  return {
    none: '⚪',
    searching: '🔍',
    creating: '📝',
    pending: '⏳',
    incoming: '📥',
    handshaking: '🔐',
    active: '💬',
  }[flow];
}

export function FlowTab({ state, timeline }: FlowTabProps) {
  // Define flow steps for progress visualization
  const flowSteps = [
    { id: 'search', label: 'Find User', flows: ['searching'] },
    { id: 'create', label: 'Create Session', flows: ['creating'] },
    { id: 'wait', label: 'Wait Accept', flows: ['pending', 'incoming'] },
    { id: 'handshake', label: 'Key Exchange', flows: ['handshaking'] },
    { id: 'chat', label: 'Chat Ready', flows: ['active'] },
  ];

  const currentStepIndex = flowSteps.findIndex(step => 
    step.flows.includes(state.currentFlow)
  );

  return (
    <div className="debug-tab-content">
      {/* Current State */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Current State</span>
          <span className={`debug-flow-badge flow-${state.currentFlow}`}>
            {getFlowEmoji(state.currentFlow)} {getFlowLabel(state.currentFlow)}
          </span>
        </div>
        
        <div className="debug-card-body">
          {/* Flow Progress */}
          <div className="debug-flow-progress">
            {flowSteps.map((step, index) => {
              let stepStatus: 'complete' | 'current' | 'pending' = 'pending';
              if (index < currentStepIndex) stepStatus = 'complete';
              else if (index === currentStepIndex) stepStatus = 'current';
              
              return (
                <div key={step.id} className={`debug-flow-step ${stepStatus}`}>
                  <div className="debug-flow-step-indicator">
                    {stepStatus === 'complete' && '✓'}
                    {stepStatus === 'current' && '→'}
                    {stepStatus === 'pending' && '○'}
                  </div>
                  <div className="debug-flow-step-label">{step.label}</div>
                </div>
              );
            })}
          </div>

          {/* Handshake Progress Bar */}
          {state.currentFlow === 'handshaking' && state.handshakeProgress > 0 && (
            <div className="debug-progress-container">
              <div className="debug-progress-bar">
                <div 
                  className="debug-progress-fill"
                  style={{ transform: `scaleX(${state.handshakeProgress / 100})` }}
                />
              </div>
              <span className="debug-progress-label">
                {state.handshakeStage}: {state.handshakeProgress}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Session Info */}
      {(state.sessionId || state.peerName) && (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Session Info</span>
          </div>
          
          <div className="debug-card-body">
            {state.sessionId && (
              <div className="debug-row">
                <span className="debug-row-label">Session ID:</span>
                <span className="debug-row-value mono truncate" title={state.sessionId}>
                  {state.sessionId.slice(0, 16)}...
                </span>
              </div>
            )}
            
            {state.peerName && (
              <div className="debug-row">
                <span className="debug-row-label">Peer:</span>
                <span className="debug-row-value">
                  {state.peerName}
                  {state.peerId && <span className="debug-peer-id"> (ID: {state.peerId})</span>}
                </span>
              </div>
            )}

            {/* Key States */}
            <div className="debug-key-states">
              <div className={`debug-key-state ${state.hasLocalKeys ? 'has' : 'missing'}`}>
                <span className="debug-key-icon">{state.hasLocalKeys ? '✓' : '○'}</span>
                <span className="debug-key-label">Local Keys</span>
              </div>
              <div className={`debug-key-state ${state.hasPeerKey ? 'has' : 'missing'}`}>
                <span className="debug-key-icon">{state.hasPeerKey ? '✓' : '○'}</span>
                <span className="debug-key-label">Peer Key</span>
              </div>
              <div className={`debug-key-state ${state.hasSharedSecret ? 'has' : 'missing'}`}>
                <span className="debug-key-icon">{state.hasSharedSecret ? '✓' : '○'}</span>
                <span className="debug-key-label">Shared Secret</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {state.lastError && (
        <div className="debug-card error">
          <div className="debug-card-header">
            <span className="debug-card-title">Last Error</span>
            {state.errorTimestamp && (
              <span className="debug-error-time">{formatTime(state.errorTimestamp)}</span>
            )}
          </div>
          <div className="debug-card-body">
            <div className="debug-error-message">{state.lastError}</div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">Timeline</span>
          <span className="debug-count-badge">{timeline.length}</span>
        </div>
        
        <div className="debug-card-body">
          {timeline.length === 0 ? (
            <div className="debug-empty">No events yet</div>
          ) : (
            <div className="debug-timeline">
              {[...timeline].reverse().map((event) => (
                <div key={event.id} className={`debug-timeline-item ${event.status}`}>
                  <div className="debug-timeline-indicator">
                    {event.status === 'complete' && '✓'}
                    {event.status === 'current' && '→'}
                    {event.status === 'pending' && '○'}
                    {event.status === 'error' && '✕'}
                  </div>
                  <div className="debug-timeline-content">
                    <span className="debug-timeline-time">{formatTime(event.timestamp)}</span>
                    <span className="debug-timeline-label">{event.label}</span>
                    {event.details && (
                      <span className="debug-timeline-details">{event.details}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
