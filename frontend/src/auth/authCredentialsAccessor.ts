import type { AuthCredentials } from './types';

/** Header names — must match backend StompIdentityAuthService and webSocketHandshakeUrl.ts */
export const AUTH_TYPE_HEADER = 'X-Auth-Type';
export const AUTH_TOKEN_HEADER = 'X-Auth-Token';
export const INIT_DATA_HEADER = 'X-Telegram-Init-Data';

let activeCredentials: AuthCredentials | null = null;

/** Publishes current auth credentials for non-React modules (file upload/download). */
export function setActiveCredentials(creds: AuthCredentials | null): void {
  activeCredentials = creds;
}

/** Returns credentials last published by AuthContext (or null when logged out). */
export function getActiveCredentials(): AuthCredentials | null {
  return activeCredentials;
}

/**
 * Builds REST auth headers from credentials — same mode selection as buildWebSocketHandshakeUrl.
 * Empty token/initData values are omitted; X-Auth-Type is always set when credentials exist.
 */
export function buildRestAuthHeaders(credentials: AuthCredentials | null): Record<string, string> {
  if (!credentials) {
    return {};
  }

  const headers: Record<string, string> = {};
  const isWallet = credentials.type === 'wallet';
  headers[AUTH_TYPE_HEADER] = isWallet ? 'wallet' : 'telegram';

  if (isWallet) {
    const sessionToken = credentials.sessionToken || '';
    if (sessionToken) {
      headers[AUTH_TOKEN_HEADER] = sessionToken;
    }
  } else {
    const initData = credentials.initData || '';
    if (initData) {
      headers[INIT_DATA_HEADER] = initData;
    }
  }

  return headers;
}

/** Convenience: headers from the active credentials published by AuthContext. */
export function getRestAuthHeaders(): Record<string, string> {
  return buildRestAuthHeaders(getActiveCredentials());
}
