export { DebugPanel, debugLog, clearDebugLogs } from './DebugPanel';
export { 
  useDebugState,
  incrementMessagesSent,
  incrementMessagesReceived,
  resetMessageCounters,
  logCryptoOperation,
  clearCryptoOperations,
} from './hooks';
export type {
  WebSocketDebugState,
  SessionFlowState,
  CryptoDebugState,
  CryptoSessionDebugState,
  CryptoOperationEntry,
  TimelineEvent,
  DebugState,
} from './hooks';