/**
 * Mock Server Hook for Debug Panel (Phase 5).
 * Provides mock responses for testing without a real backend.
 */

import { useState, useCallback, useEffect } from 'react';
import { isDebugPayloadAllowed, logStompMessage } from './useDebugState';
import type { StompCommand } from './useDebugState';

// ============================================
// Types
// ============================================

/** Mock response configuration */
export interface MockResponse {
  id: string;
  /** Destination pattern to match (supports * wildcard) */
  destination: string;
  /** Delay before sending response (ms) */
  delay: number;
  /** Response body */
  body: unknown;
  /** Whether this mock is enabled */
  enabled: boolean;
  /** Optional error to simulate */
  simulateError?: boolean;
  /** Description for UI */
  description?: string;
}

/** Mock server state */
export interface MockServerState {
  /** Whether mock server is enabled */
  isEnabled: boolean;
  /** Mock response configurations */
  mocks: MockResponse[];
  /** Count of mocked responses sent */
  mockedCount: number;
  /** Last mocked response timestamp */
  lastMockedAt: number | null;
}

/** Hook return type */
export interface UseMockServerReturn {
  state: MockServerState;
  /** Enable/disable mock server */
  setEnabled: (enabled: boolean) => void;
  /** Add a new mock response */
  addMock: (mock: Omit<MockResponse, 'id'>) => void;
  /** Update an existing mock */
  updateMock: (id: string, updates: Partial<MockResponse>) => void;
  /** Remove a mock response */
  removeMock: (id: string) => void;
  /** Clear all mocks */
  clearMocks: () => void;
  /** Reset mock statistics */
  resetStats: () => void;
  /** Import mocks from JSON */
  importMocks: (json: string) => boolean;
  /** Export mocks to JSON */
  exportMocks: () => string;
  /** Process an outgoing message and return mock response if matched */
  processMockMessage: (destination: string, body: unknown) => boolean;
}

// ============================================
// Default Mocks
// ============================================

const DEFAULT_MOCKS: MockResponse[] = [
  {
    id: 'session-create',
    destination: '/app/session.create',
    delay: 500,
    body: { 
      success: true, 
      sessionId: 'mock-session-' + Date.now().toString(36),
      status: 'PENDING',
    },
    enabled: true,
    description: 'Mock session creation response',
  },
  {
    id: 'handshake-key',
    destination: '/app/handshake.key',
    delay: 200,
    body: { success: true },
    enabled: true,
    description: 'Mock handshake key exchange',
  },
  {
    id: 'search-user',
    destination: '/app/search.user',
    delay: 300,
    body: {
      success: true,
      user: {
        id: 123456789,
        firstName: 'Mock',
        lastName: 'User',
        username: 'mockuser',
        displayName: 'Mock User',
      },
    },
    enabled: true,
    description: 'Mock user search response',
  },
  {
    id: 'message-send',
    destination: '/app/message.send',
    delay: 100,
    body: { success: true, messageId: 'mock-msg-' + Date.now().toString(36) },
    enabled: true,
    description: 'Mock message send response',
  },
];

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY_ENABLED = 'debug-mock-enabled';
const STORAGE_KEY_MOCKS = 'debug-mock-configs';

// ============================================
// Global State
// ============================================

let mockServerEnabled = false;
let mockConfigs: MockResponse[] = [];
let mockedCount = 0;
let lastMockedAt: number | null = null;
const mockListeners = new Set<() => void>();

/** Production: do not persist mock configs. DEV: write enabled + configs. */
export function persistMockState(): void {
  if (!isDebugPayloadAllowed()) return;
  try {
    localStorage.setItem(STORAGE_KEY_ENABLED, String(mockServerEnabled));
    localStorage.setItem(STORAGE_KEY_MOCKS, JSON.stringify(mockConfigs));
  } catch {
    // Ignore storage errors
  }
}

/** Production module-init: wipe stale mock keys without waiting for burn. */
export function initMockPersist(): void {
  if (typeof window === 'undefined') return;
  if (!isDebugPayloadAllowed()) {
    localStorage.removeItem(STORAGE_KEY_ENABLED);
    localStorage.removeItem(STORAGE_KEY_MOCKS);
    mockServerEnabled = false;
    mockConfigs = DEFAULT_MOCKS;
    return;
  }
  try {
    const savedEnabled = localStorage.getItem(STORAGE_KEY_ENABLED);
    mockServerEnabled = savedEnabled === 'true';

    const savedMocks = localStorage.getItem(STORAGE_KEY_MOCKS);
    if (savedMocks) {
      mockConfigs = JSON.parse(savedMocks);
    } else {
      mockConfigs = DEFAULT_MOCKS;
    }
  } catch {
    mockConfigs = DEFAULT_MOCKS;
  }
}

initMockPersist();

/** Notify listeners */
function notifyListeners(): void {
  mockListeners.forEach(fn => fn());
}

/** Check if destination matches pattern */
function matchesPattern(destination: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(destination);
  }
  return destination === pattern;
}

/** Generate unique ID */
function generateId(): string {
  return 'mock-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

// ============================================
// Public API for intercepting messages
// ============================================

/**
 * Check if mock server should handle this message
 */
export function shouldMockMessage(destination: string): boolean {
  if (!mockServerEnabled) return false;
  return mockConfigs.some(m => m.enabled && matchesPattern(destination, m.destination));
}

/**
 * Get mock response for a destination
 */
export function getMockResponse(destination: string): MockResponse | null {
  if (!mockServerEnabled) return null;
  return mockConfigs.find(m => m.enabled && matchesPattern(destination, m.destination)) || null;
}

/**
 * Send mock response (called by WebSocket hook when mock is matched)
 */
export function sendMockResponse(
  destination: string,
  _requestBody: unknown,
  correlationId?: string
): void {
  const mock = getMockResponse(destination);
  if (!mock) return;

  // Determine response destination (typically user queue)
  const responseDestination = destination
    .replace('/app/', '/user/queue/')
    .replace('.', '-');

  setTimeout(() => {
    const command: StompCommand = mock.simulateError ? 'ERROR' : 'MESSAGE';
    
    logStompMessage(
      'incoming',
      responseDestination,
      command,
      { 'content-type': 'application/json', 'mock': 'true' },
      mock.body,
      correlationId
    );

    mockedCount++;
    lastMockedAt = Date.now();
    notifyListeners();
  }, mock.delay);
}

// ============================================
// Hook
// ============================================

export function useMockServer(): UseMockServerReturn {
  const [updateTrigger, setUpdateTrigger] = useState(0);

  // Subscribe to state changes
  useEffect(() => {
    const update = () => setUpdateTrigger(prev => prev + 1);
    mockListeners.add(update);
    return () => { mockListeners.delete(update); };
  }, []);

  const state: MockServerState = {
    isEnabled: mockServerEnabled,
    mocks: mockConfigs,
    mockedCount,
    lastMockedAt,
  };

  const setEnabled = useCallback((enabled: boolean) => {
    mockServerEnabled = enabled;
    persistMockState();
    notifyListeners();
  }, []);

  const addMock = useCallback((mock: Omit<MockResponse, 'id'>) => {
    const newMock: MockResponse = { ...mock, id: generateId() };
    mockConfigs = [...mockConfigs, newMock];
    persistMockState();
    notifyListeners();
  }, []);

  const updateMock = useCallback((id: string, updates: Partial<MockResponse>) => {
    mockConfigs = mockConfigs.map(m => 
      m.id === id ? { ...m, ...updates } : m
    );
    persistMockState();
    notifyListeners();
  }, []);

  const removeMock = useCallback((id: string) => {
    mockConfigs = mockConfigs.filter(m => m.id !== id);
    persistMockState();
    notifyListeners();
  }, []);

  const clearMocks = useCallback(() => {
    mockConfigs = [];
    persistMockState();
    notifyListeners();
  }, []);

  const resetStats = useCallback(() => {
    mockedCount = 0;
    lastMockedAt = null;
    notifyListeners();
  }, []);

  const importMocks = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return false;
      
      mockConfigs = parsed.map((m: Partial<MockResponse>) => ({
        id: m.id || generateId(),
        destination: m.destination || '/app/*',
        delay: m.delay || 100,
        body: m.body || {},
        enabled: m.enabled !== false,
        simulateError: m.simulateError || false,
        description: m.description || '',
      }));
      persistMockState();
      notifyListeners();
      return true;
    } catch {
      return false;
    }
  }, []);

  const exportMocks = useCallback((): string => {
    return JSON.stringify(mockConfigs, null, 2);
  }, []);

  const processMockMessage = useCallback((destination: string, body: unknown): boolean => {
    if (!shouldMockMessage(destination)) return false;
    
    const correlationId = 'mock-' + Date.now().toString(36);
    
    // Log the outgoing message
    logStompMessage('outgoing', destination, 'SEND', {}, body, correlationId);
    
    // Send mock response
    sendMockResponse(destination, body, correlationId);
    
    return true;
  }, []);

  // Suppress unused variable warning
  void updateTrigger;

  return {
    state,
    setEnabled,
    addMock,
    updateMock,
    removeMock,
    clearMocks,
    resetStats,
    importMocks,
    exportMocks,
    processMockMessage,
  };
}
