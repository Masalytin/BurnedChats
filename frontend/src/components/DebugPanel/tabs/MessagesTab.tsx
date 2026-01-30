/**
 * STOMP Messages Tab for Debug Panel (Phase 2).
 * Displays STOMP message log with filtering and request/response correlation.
 */

import { useState, useMemo, useCallback } from 'react';
import type { StompMessagesState} from '../hooks/useDebugState';
import { clearStompMessages } from '../hooks/useDebugState';
import './tabs.css';

interface MessagesTabProps {
  state: StompMessagesState;
}

type DirectionFilter = 'all' | 'outgoing' | 'incoming';
type ViewMode = 'messages' | 'correlated';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncateDestination(dest: string, maxLen = 30): string {
  if (dest.length <= maxLen) return dest;
  return '...' + dest.slice(-maxLen + 3);
}

function formatBody(body: unknown): string {
  if (body === null || body === undefined) return '(empty)';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

export function MessagesTab({ state }: MessagesTabProps) {
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [destinationFilter, setDestinationFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('messages');
  const [expandedMessageId, setExpandedMessageId] = useState<number | null>(null);
  const [expandedCorrelationId, setExpandedCorrelationId] = useState<string | null>(null);

  // Filter messages
  const filteredMessages = useMemo(() => {
    return state.messages.filter(msg => {
      if (directionFilter !== 'all' && msg.direction !== directionFilter) {
        return false;
      }
      if (destinationFilter && !msg.destination.toLowerCase().includes(destinationFilter.toLowerCase())) {
        return false;
      }
      return true;
    }).reverse(); // Show newest first
  }, [state.messages, directionFilter, destinationFilter]);

  // Get unique destinations for quick filters
  const uniqueDestinations = useMemo(() => {
    const destinations = new Set<string>();
    state.messages.forEach(msg => destinations.add(msg.destination));
    return Array.from(destinations).sort();
  }, [state.messages]);

  // Handle message expand toggle
  const toggleMessageExpand = useCallback((id: number) => {
    setExpandedMessageId(prev => prev === id ? null : id);
  }, []);

  // Handle correlation expand toggle
  const toggleCorrelationExpand = useCallback((id: string) => {
    setExpandedCorrelationId(prev => prev === id ? null : id);
  }, []);

  // Copy all messages to clipboard
  const copyAllMessages = useCallback(() => {
    const text = filteredMessages.map(msg => {
      const dir = msg.direction === 'outgoing' ? '→' : '←';
      return `[${formatTime(msg.timestamp)}] ${dir} ${msg.destination}\n${formatBody(msg.body)}`;
    }).join('\n\n');
    navigator.clipboard.writeText(text);
  }, [filteredMessages]);

  // Handle clear
  const handleClear = useCallback(() => {
    clearStompMessages();
  }, []);

  const statusIcon = {
    pending: '⏳',
    success: '✓',
    error: '✗',
    timeout: '⏰',
  };

  const statusClass = {
    pending: 'warn',
    success: 'success',
    error: 'error',
    timeout: 'warn',
  };

  return (
    <div className="debug-tab-content">
      {/* Toolbar */}
      <div className="debug-card">
        <div className="debug-card-header">
          <span className="debug-card-title">STOMP Messages</span>
          <span className="debug-count-badge">{state.messages.length}</span>
        </div>
        
        <div className="debug-card-body">
          {/* View Mode Toggle */}
          <div className="debug-stomp-toolbar">
            <div className="debug-stomp-view-toggle">
              <button
                className={`debug-stomp-view-btn ${viewMode === 'messages' ? 'active' : ''}`}
                onClick={() => setViewMode('messages')}
              >
                All
              </button>
              <button
                className={`debug-stomp-view-btn ${viewMode === 'correlated' ? 'active' : ''}`}
                onClick={() => setViewMode('correlated')}
              >
                Pairs
              </button>
            </div>
            
            {/* Direction Filter */}
            <div className="debug-stomp-direction-filter">
              <button
                className={`debug-stomp-dir-btn ${directionFilter === 'all' ? 'active' : ''}`}
                onClick={() => setDirectionFilter('all')}
                title="All directions"
              >
                ↕
              </button>
              <button
                className={`debug-stomp-dir-btn ${directionFilter === 'outgoing' ? 'active' : ''}`}
                onClick={() => setDirectionFilter('outgoing')}
                title="Outgoing only"
              >
                ↑
              </button>
              <button
                className={`debug-stomp-dir-btn ${directionFilter === 'incoming' ? 'active' : ''}`}
                onClick={() => setDirectionFilter('incoming')}
                title="Incoming only"
              >
                ↓
              </button>
            </div>

            {/* Actions */}
            <div className="debug-stomp-actions">
              <button onClick={copyAllMessages} title="Copy all messages">
                Copy
              </button>
              <button onClick={handleClear} title="Clear all messages">
                Clear
              </button>
            </div>
          </div>

          {/* Destination Filter */}
          {uniqueDestinations.length > 0 && (
            <div className="debug-stomp-dest-filter">
              <input
                type="text"
                placeholder="Filter by destination..."
                value={destinationFilter}
                onChange={(e) => setDestinationFilter(e.target.value)}
                className="debug-stomp-filter-input"
              />
            </div>
          )}
        </div>
      </div>

      {/* Messages List */}
      {viewMode === 'messages' && (
        <div className="debug-card">
          <div className="debug-card-body debug-card-body-scroll debug-stomp-messages-scroll">
            {filteredMessages.length === 0 ? (
              <div className="debug-empty">No messages yet</div>
            ) : (
              <div className="debug-stomp-messages">
                {filteredMessages.map(msg => (
                  <div 
                    key={msg.id} 
                    className={`debug-stomp-message ${msg.direction}`}
                    onClick={() => toggleMessageExpand(msg.id)}
                  >
                    <div className="debug-stomp-message-header">
                      <span className="debug-stomp-direction">
                        {msg.direction === 'outgoing' ? '→' : '←'}
                      </span>
                      <span className="debug-stomp-time">{formatTime(msg.timestamp)}</span>
                      <span className="debug-stomp-destination" title={msg.destination}>
                        {truncateDestination(msg.destination)}
                      </span>
                      <span className="debug-stomp-size">{formatSize(msg.size)}</span>
                    </div>
                    
                    {expandedMessageId === msg.id && (
                      <div className="debug-stomp-message-details">
                        <div className="debug-stomp-detail-row">
                          <span className="debug-stomp-detail-label">Command:</span>
                          <span className="debug-stomp-detail-value">{msg.command}</span>
                        </div>
                        <div className="debug-stomp-detail-row">
                          <span className="debug-stomp-detail-label">Destination:</span>
                          <span className="debug-stomp-detail-value mono">{msg.destination}</span>
                        </div>
                        {Object.keys(msg.headers).length > 0 && (
                          <div className="debug-stomp-detail-row">
                            <span className="debug-stomp-detail-label">Headers:</span>
                            <pre className="debug-stomp-detail-pre">
                              {JSON.stringify(msg.headers, null, 2)}
                            </pre>
                          </div>
                        )}
                        <div className="debug-stomp-detail-row">
                          <span className="debug-stomp-detail-label">Body:</span>
                          <pre className="debug-stomp-detail-pre">
                            {formatBody(msg.body)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Correlated Messages (Request/Response Pairs) */}
      {viewMode === 'correlated' && (
        <div className="debug-card">
          <div className="debug-card-header">
            <span className="debug-card-title">Request/Response Pairs</span>
            <span className="debug-count-badge">{state.correlatedMessages.length}</span>
          </div>
          
          <div className="debug-card-body debug-card-body-scroll debug-stomp-messages-scroll">
            {state.correlatedMessages.length === 0 ? (
              <div className="debug-empty">No correlated messages yet</div>
            ) : (
              <div className="debug-stomp-correlations">
                {[...state.correlatedMessages].reverse().map(cm => (
                  <div 
                    key={cm.requestId} 
                    className={`debug-stomp-correlation ${cm.status}`}
                    onClick={() => toggleCorrelationExpand(cm.requestId)}
                  >
                    <div className="debug-stomp-correlation-header">
                      <span className={`debug-stomp-correlation-status ${statusClass[cm.status]}`}>
                        {statusIcon[cm.status]}
                      </span>
                      <span className="debug-stomp-time">
                        {formatTime(cm.request.timestamp)}
                      </span>
                      <span className="debug-stomp-destination" title={cm.request.destination}>
                        {truncateDestination(cm.request.destination)}
                      </span>
                      {cm.latencyMs !== null && (
                        <span className="debug-stomp-latency">{cm.latencyMs}ms</span>
                      )}
                    </div>
                    
                    {expandedCorrelationId === cm.requestId && (
                      <div className="debug-stomp-correlation-details">
                        <div className="debug-stomp-correlation-section">
                          <div className="debug-stomp-correlation-section-title">
                            → Request
                          </div>
                          <pre className="debug-stomp-detail-pre">
                            {formatBody(cm.request.body)}
                          </pre>
                        </div>
                        
                        {cm.response ? (
                          <div className="debug-stomp-correlation-section">
                            <div className="debug-stomp-correlation-section-title">
                              ← Response
                            </div>
                            <pre className="debug-stomp-detail-pre">
                              {formatBody(cm.response.body)}
                            </pre>
                          </div>
                        ) : (
                          <div className="debug-stomp-correlation-section">
                            <div className="debug-stomp-correlation-no-response">
                              {cm.status === 'pending' ? 'Waiting for response...' : 
                               cm.status === 'timeout' ? 'Request timed out' : 'No response'}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
