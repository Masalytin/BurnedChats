import { afterEach, describe, expect, it } from 'vitest';
import { AuthType } from './types';
import {
  AUTH_TOKEN_HEADER,
  AUTH_TYPE_HEADER,
  buildRestAuthHeaders,
  getActiveCredentials,
  getRestAuthHeaders,
  INIT_DATA_HEADER,
  setActiveCredentials,
} from './authCredentialsAccessor';

describe('authCredentialsAccessor', () => {
  afterEach(() => {
    setActiveCredentials(null);
  });

  describe('setActiveCredentials / getActiveCredentials', () => {
    it('stores and returns published credentials', () => {
      const creds = { type: AuthType.WALLET, sessionToken: 'tok-1' };
      setActiveCredentials(creds);
      expect(getActiveCredentials()).toEqual(creds);
    });

    it('clears credentials when set to null', () => {
      setActiveCredentials({ type: AuthType.WALLET, sessionToken: 'tok-1' });
      setActiveCredentials(null);
      expect(getActiveCredentials()).toBeNull();
    });
  });

  describe('buildRestAuthHeaders', () => {
    it('returns empty object when credentials are null', () => {
      expect(buildRestAuthHeaders(null)).toEqual({});
    });

    it('sets wallet auth type and session token', () => {
      const headers = buildRestAuthHeaders({
        type: AuthType.WALLET,
        sessionToken: 'session-tok-42',
      });

      expect(headers[AUTH_TYPE_HEADER]).toBe('wallet');
      expect(headers[AUTH_TOKEN_HEADER]).toBe('session-tok-42');
      expect(headers[INIT_DATA_HEADER]).toBeUndefined();
    });

    it('omits wallet token header when session token is empty', () => {
      const headers = buildRestAuthHeaders({
        type: AuthType.WALLET,
        sessionToken: '',
      });

      expect(headers[AUTH_TYPE_HEADER]).toBe('wallet');
      expect(headers[AUTH_TOKEN_HEADER]).toBeUndefined();
    });

    it('sets telegram auth type and init data', () => {
      const headers = buildRestAuthHeaders({
        type: AuthType.TELEGRAM,
        initData: 'user=1&hash=abc',
      });

      expect(headers[AUTH_TYPE_HEADER]).toBe('telegram');
      expect(headers[INIT_DATA_HEADER]).toBe('user=1&hash=abc');
      expect(headers[AUTH_TOKEN_HEADER]).toBeUndefined();
    });

    it('omits telegram init data header when init data is empty', () => {
      const headers = buildRestAuthHeaders({
        type: AuthType.TELEGRAM,
        initData: '',
      });

      expect(headers[AUTH_TYPE_HEADER]).toBe('telegram');
      expect(headers[INIT_DATA_HEADER]).toBeUndefined();
    });
  });

  describe('getRestAuthHeaders', () => {
    it('reads from active credentials published by AuthContext', () => {
      setActiveCredentials({
        type: AuthType.WALLET,
        sessionToken: 'active-tok',
      });

      expect(getRestAuthHeaders()).toEqual({
        [AUTH_TYPE_HEADER]: 'wallet',
        [AUTH_TOKEN_HEADER]: 'active-tok',
      });
    });

    it('returns empty object when no credentials are published', () => {
      expect(getRestAuthHeaders()).toEqual({});
    });
  });
});
