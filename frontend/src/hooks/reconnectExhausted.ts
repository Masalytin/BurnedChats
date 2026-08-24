export function isReconnectExhausted(
  isConnected: boolean,
  reconnectAttempt: number,
  maxReconnectAttempts: number,
): boolean {
  return !isConnected && maxReconnectAttempts > 0 && reconnectAttempt >= maxReconnectAttempts;
}
