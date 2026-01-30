export { DebugPanel, debugLog, clearDebugLogs } from './DebugPanel';
export { 
  useDebugState,
  incrementMessagesSent,
  incrementMessagesReceived,
  resetMessageCounters,
  logCryptoOperation,
  clearCryptoOperations,
  // Phase 2: STOMP Message Tracing
  logStompMessage,
  clearStompMessages,
} from './hooks';
export type {
  WebSocketDebugState,
  SessionFlowState,
  CryptoDebugState,
  CryptoSessionDebugState,
  CryptoOperationEntry,
  TimelineEvent,
  DebugState,
  // Phase 2: STOMP Message Types
  StompMessage,
  StompCommand,
  CorrelatedMessage,
  StompMessagesState,
} from './hooks';