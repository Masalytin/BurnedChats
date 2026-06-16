import { describe, expect, it } from 'vitest';
import { AuthType } from '../auth/types';
import { buildWebSocketHandshakeUrl } from './webSocketHandshakeUrl';

describe('buildWebSocketHandshakeUrl', () => {
  it('returns base URL when credentials are null', () => {
    expect(buildWebSocketHandshakeUrl('/ws', null)).toBe('/ws');
  });

  it('appends telegram initData as URL-encoded query params', () => {
    const url = buildWebSocketHandshakeUrl('/ws', {
      type: AuthType.TELEGRAM,
      initData: 'user=1&hash=abc',
    });

    expect(url.startsWith('/ws?')).toBe(true);
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.searchParams.get('X-Auth-Type')).toBe('telegram');
    expect(parsed.searchParams.get('X-Telegram-Init-Data')).toBe('user=1&hash=abc');
  });

  it('appends wallet session token query params', () => {
    const url = buildWebSocketHandshakeUrl('/ws', {
      type: AuthType.WALLET,
      sessionToken: 'session-tok-42',
    });

    const parsed = new URL(url, 'http://localhost');
    expect(parsed.searchParams.get('X-Auth-Type')).toBe('wallet');
    expect(parsed.searchParams.get('X-Auth-Token')).toBe('session-tok-42');
    expect(parsed.searchParams.has('X-Telegram-Init-Data')).toBe(false);
  });

  it('preserves existing query string on base URL', () => {
    const url = buildWebSocketHandshakeUrl('/ws?transport=websocket', {
      type: AuthType.TELEGRAM,
      initData: 'a=b',
    });

    expect(url.startsWith('/ws?transport=websocket&')).toBe(true);
  });
});
