import type { AuthCredentials } from '../auth';

/** Query param names for SockJS handshake — must match backend StompIdentityAuthService. */
const INIT_DATA_HEADER = 'X-Telegram-Init-Data';
const AUTH_TYPE_HEADER = 'X-Auth-Type';
const AUTH_TOKEN_HEADER = 'X-Auth-Token';

/**
 * Builds the SockJS WebSocket URL with auth credentials as query parameters.
 * Backend resolves identity on HTTP/WebSocket upgrade, not on STOMP CONNECT.
 *
 * @see docs/specs/API.md (WebSocket authentication)
 */
export function buildWebSocketHandshakeUrl(
  baseUrl: string,
  credentials: AuthCredentials | null,
): string {
  if (!credentials) {
    return baseUrl;
  }

  const params = new URLSearchParams();
  const isWallet = credentials.type === 'wallet';
  params.set(AUTH_TYPE_HEADER, isWallet ? 'wallet' : 'telegram');

  if (isWallet) {
    const sessionToken = credentials.sessionToken || '';
    if (sessionToken) {
      params.set(AUTH_TOKEN_HEADER, sessionToken);
    }
  } else {
    const initData = credentials.initData || '';
    if (initData) {
      params.set(INIT_DATA_HEADER, initData);
    }
  }

  const query = params.toString();
  if (!query) {
    return baseUrl;
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${query}`;
}
