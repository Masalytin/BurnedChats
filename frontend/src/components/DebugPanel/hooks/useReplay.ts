/**
 * Replay Hook for Debug Panel (Phase 5).
 * Allows replaying STOMP messages from exported logs.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { logStompMessage } from './useDebugState';
import type { StompMessage, StompCommand } from './useDebugState';

// ============================================
// Types
// ============================================

/** Replay state */
export type ReplayStatus = 'idle' | 'playing' | 'paused' | 'complete';

/** Replay session */
export interface ReplaySession {
  id: string;
  name: string;
  messages: StompMessage[];
  importedAt: number;
  totalDuration: number;
}

/** Replay state */
export interface ReplayState {
  status: ReplayStatus;
  /** Current replay session */
  session: ReplaySession | null;
  /** Current message index */
  currentIndex: number;
  /** Playback speed multiplier (1 = real-time, 2 = 2x speed, etc.) */
  playbackSpeed: number;
  /** Progress percentage (0-100) */
  progress: number;
  /** Elapsed time since replay started (ms) */
  elapsedTime: number;
  /** Saved sessions */
  savedSessions: ReplaySession[];
}

/** Hook return type */
export interface UseReplayReturn {
  state: ReplayState;
  /** Import messages from JSON string */
  importMessages: (json: string, name?: string) => boolean;
  /** Import messages from exported debug state */
  importFromDebugExport: (json: string) => boolean;
  /** Start or resume playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Stop and reset playback */
  stop: () => void;
  /** Step to next message */
  stepForward: () => void;
  /** Step to previous message */
  stepBackward: () => void;
  /** Jump to specific message index */
  jumpTo: (index: number) => void;
  /** Set playback speed */
  setPlaybackSpeed: (speed: number) => void;
  /** Save current session */
  saveSession: () => void;
  /** Load saved session */
  loadSession: (id: string) => void;
  /** Delete saved session */
  deleteSession: (id: string) => void;
  /** Clear current session */
  clearSession: () => void;
}

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY_SESSIONS = 'debug-replay-sessions';

// ============================================
// Helper Functions
// ============================================

/** Generate unique ID */
function generateId(): string {
  return 'replay-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/** Calculate total duration from messages */
function calculateDuration(messages: StompMessage[]): number {
  if (messages.length < 2) return 0;
  return messages[messages.length - 1].timestamp - messages[0].timestamp;
}

/** Load saved sessions from localStorage */
function loadSavedSessions(): ReplaySession[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore
  }
  return [];
}

/** Save sessions to localStorage */
function saveSessions(sessions: ReplaySession[]): void {
  try {
    // Only save metadata, not full messages (to save space)
    const toSave = sessions.map(s => ({
      ...s,
      messages: s.messages.slice(0, 100), // Limit to 100 messages
    }));
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(toSave));
  } catch {
    // Ignore storage errors
  }
}

// ============================================
// Hook
// ============================================

export function useReplay(): UseReplayReturn {
  const [status, setStatus] = useState<ReplayStatus>('idle');
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [savedSessions, setSavedSessions] = useState<ReplaySession[]>(() => loadSavedSessions());

  const playbackTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (playbackTimerRef.current) {
        clearTimeout(playbackTimerRef.current);
      }
    };
  }, []);

  // Calculate progress
  const progress = session && session.messages.length > 0
    ? Math.round((currentIndex / (session.messages.length - 1)) * 100)
    : 0;

  // Process a message during replay
  const processMessage = useCallback((msg: StompMessage) => {
    logStompMessage(
      msg.direction,
      msg.destination,
      msg.command as StompCommand,
      msg.headers,
      msg.body,
      msg.correlationId
    );
  }, []);

  // Schedule next message during playback
  const scheduleNextMessage = useCallback(() => {
    if (!session || currentIndex >= session.messages.length - 1) {
      setStatus('complete');
      return;
    }

    const currentMsg = session.messages[currentIndex];
    const nextMsg = session.messages[currentIndex + 1];
    const delay = (nextMsg.timestamp - currentMsg.timestamp) / playbackSpeed;

    playbackTimerRef.current = window.setTimeout(() => {
      setCurrentIndex(prev => {
        const newIndex = prev + 1;
        processMessage(session.messages[newIndex]);
        return newIndex;
      });
      setElapsedTime(Date.now() - startTimeRef.current);
    }, Math.max(delay, 10)); // Minimum 10ms delay
  }, [session, currentIndex, playbackSpeed, processMessage]);

  // Effect to handle playback
  useEffect(() => {
    if (status === 'playing' && session) {
      scheduleNextMessage();
    }

    return () => {
      if (playbackTimerRef.current) {
        clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  }, [status, currentIndex, session, scheduleNextMessage]);

  const importMessages = useCallback((json: string, name?: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      
      let messages: StompMessage[];
      
      if (Array.isArray(parsed)) {
        messages = parsed;
      } else if (parsed.messages && Array.isArray(parsed.messages)) {
        messages = parsed.messages;
      } else {
        return false;
      }

      // Validate message structure
      if (messages.length === 0) return false;
      if (!messages.every(m => m.timestamp && m.destination && m.direction)) {
        return false;
      }

      // Sort by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);

      const newSession: ReplaySession = {
        id: generateId(),
        name: name || `Replay ${new Date().toLocaleString()}`,
        messages,
        importedAt: Date.now(),
        totalDuration: calculateDuration(messages),
      };

      setSession(newSession);
      setCurrentIndex(0);
      setStatus('idle');
      setElapsedTime(0);

      // Process first message immediately
      if (messages.length > 0) {
        processMessage(messages[0]);
      }

      return true;
    } catch {
      return false;
    }
  }, [processMessage]);

  const importFromDebugExport = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      
      // Check for STOMP messages in debug export format
      if (parsed.stomp?.messages) {
        return importMessages(JSON.stringify(parsed.stomp.messages), 'Debug Export');
      }
      
      // Check for direct messages array
      if (parsed.messages) {
        return importMessages(json, 'Debug Export');
      }

      return false;
    } catch {
      return false;
    }
  }, [importMessages]);

  const play = useCallback(() => {
    if (!session || session.messages.length === 0) return;

    if (status === 'complete') {
      // Restart from beginning
      setCurrentIndex(0);
      processMessage(session.messages[0]);
    }

    startTimeRef.current = Date.now() - pausedAtRef.current;
    setStatus('playing');
  }, [session, status, processMessage]);

  const pause = useCallback(() => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    pausedAtRef.current = Date.now() - startTimeRef.current;
    setStatus('paused');
  }, []);

  const stop = useCallback(() => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setCurrentIndex(0);
    setStatus('idle');
    setElapsedTime(0);
    pausedAtRef.current = 0;
  }, []);

  const stepForward = useCallback(() => {
    if (!session || currentIndex >= session.messages.length - 1) return;
    
    pause();
    const newIndex = currentIndex + 1;
    setCurrentIndex(newIndex);
    processMessage(session.messages[newIndex]);
  }, [session, currentIndex, pause, processMessage]);

  const stepBackward = useCallback(() => {
    if (!session || currentIndex <= 0) return;
    
    pause();
    const newIndex = currentIndex - 1;
    setCurrentIndex(newIndex);
    processMessage(session.messages[newIndex]);
  }, [session, currentIndex, pause, processMessage]);

  const jumpTo = useCallback((index: number) => {
    if (!session || index < 0 || index >= session.messages.length) return;
    
    pause();
    setCurrentIndex(index);
    processMessage(session.messages[index]);
  }, [session, pause, processMessage]);

  const setPlaybackSpeed = useCallback((speed: number) => {
    const clampedSpeed = Math.max(0.25, Math.min(10, speed));
    setPlaybackSpeedState(clampedSpeed);
  }, []);

  const saveSession = useCallback(() => {
    if (!session) return;
    
    const updated = [...savedSessions.filter(s => s.id !== session.id), session];
    setSavedSessions(updated);
    saveSessions(updated);
  }, [session, savedSessions]);

  const loadSession = useCallback((id: string) => {
    const found = savedSessions.find(s => s.id === id);
    if (found) {
      setSession(found);
      setCurrentIndex(0);
      setStatus('idle');
      setElapsedTime(0);
      
      if (found.messages.length > 0) {
        processMessage(found.messages[0]);
      }
    }
  }, [savedSessions, processMessage]);

  const deleteSession = useCallback((id: string) => {
    const updated = savedSessions.filter(s => s.id !== id);
    setSavedSessions(updated);
    saveSessions(updated);
    
    if (session?.id === id) {
      setSession(null);
      setCurrentIndex(0);
      setStatus('idle');
    }
  }, [savedSessions, session]);

  const clearSession = useCallback(() => {
    stop();
    setSession(null);
  }, [stop]);

  const state: ReplayState = {
    status,
    session,
    currentIndex,
    playbackSpeed,
    progress,
    elapsedTime,
    savedSessions,
  };

  return {
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
  };
}
