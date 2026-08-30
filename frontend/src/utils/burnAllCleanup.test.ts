// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { burnAll as burnAllKeys } from '@/crypto/keyStore';
import { clearDownloadCache } from '@/services/fileDownloadService';
import { cancelAll } from '@/services/transferQueue';
import { PENDING_DM_INVITE_TOKEN_KEY, PENDING_INVITE_TOKEN_KEY } from '@/utils/inviteLink';
import { PREFERENCES_STORAGE_KEY } from '@/preferences/preferencesStorage';
import { STORAGE_KEY as LANGUAGE_PREF_KEY } from '@/i18n/languagePreference';
import { clearDebugLogs } from '@/components/DebugPanel/DebugPanel';
import {
  clearStompMessages,
  clearCryptoOperations,
  resetMessageCounters,
} from '@/components/DebugPanel/hooks/useDebugState';
import { performBurnAllLocalCleanup } from './burnAllCleanup';

vi.mock('@/crypto/keyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/keyStore')>();
  return { ...actual, burnAll: vi.fn(actual.burnAll) };
});

vi.mock('@/services/fileDownloadService', () => ({
  clearDownloadCache: vi.fn(),
}));

vi.mock('@/services/transferQueue', () => ({
  cancelAll: vi.fn(),
}));

vi.mock('@/components/DebugPanel/DebugPanel', () => ({
  clearDebugLogs: vi.fn(),
}));

vi.mock('@/components/DebugPanel/hooks/useDebugState', () => ({
  clearStompMessages: vi.fn(),
  clearCryptoOperations: vi.fn(),
  resetMessageCounters: vi.fn(),
}));

describe('performBurnAllLocalCleanup', () => {
  const disconnectTon = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('bc:hidden:dm:session-1', '["m1"]');
    sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, 'invite-token');
    sessionStorage.setItem(PENDING_DM_INVITE_TOKEN_KEY, 'dm-invite-token');
    localStorage.setItem(PREFERENCES_STORAGE_KEY, '{"hapticsEnabled":true}');
    localStorage.setItem('bc:other', 'keep-for-data-mode');
  });

  it('clears keys, download cache, transfers, and session storage', async () => {
    await performBurnAllLocalCleanup({ wipeIdentity: false, disconnectTon });

    expect(cancelAll).toHaveBeenCalled();
    expect(burnAllKeys).toHaveBeenCalledWith('manual');
    expect(clearDownloadCache).toHaveBeenCalled();
    expect(sessionStorage.getItem('bc:hidden:dm:session-1')).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_DM_INVITE_TOKEN_KEY)).toBeNull();
    expect(disconnectTon).toHaveBeenCalled();
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toBeNull();
  });

  it('also clears app localStorage when wipeIdentity is true', async () => {
    localStorage.setItem(LANGUAGE_PREF_KEY, 'ru');

    await performBurnAllLocalCleanup({ wipeIdentity: true, disconnectTon });

    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('bc:other')).toBeNull();
    expect(localStorage.getItem(LANGUAGE_PREF_KEY)).toBeNull();
  });

  it('keeps preferred_language on data-mode burn', async () => {
    localStorage.setItem(LANGUAGE_PREF_KEY, 'de');

    await performBurnAllLocalCleanup({ wipeIdentity: false, disconnectTon });

    expect(localStorage.getItem(LANGUAGE_PREF_KEY)).toBe('de');
  });

  it('clears TonConnect localStorage keys when wipeIdentity is true', async () => {
    localStorage.setItem('ton-connect-ui_wallet-info', '{"name":"mock"}');
    localStorage.setItem('tonconnect-preferences', '{"theme":"dark"}');
    localStorage.setItem('bc:other', 'keep-for-data-mode');

    await performBurnAllLocalCleanup({ wipeIdentity: true, disconnectTon });

    expect(localStorage.getItem('ton-connect-ui_wallet-info')).toBeNull();
    expect(localStorage.getItem('tonconnect-preferences')).toBeNull();
    expect(localStorage.getItem('bc:other')).toBeNull();
  });

  it('data-mode removes every debug-* key and leaves prefs intact', async () => {
    localStorage.setItem('debug-replay-sessions', '[{"id":"s1"}]');
    localStorage.setItem('debug-panel-tab', 'messages');
    localStorage.setItem('debug-unexpected-key', 'must-not-survive');
    localStorage.setItem('debug-mock-enabled', 'true');
    localStorage.setItem('debug-mock-configs', '[]');
    localStorage.setItem('ton-connect-ui_wallet-info', '{"name":"mock"}');
    localStorage.setItem('tonconnect-preferences', '{"theme":"dark"}');

    await performBurnAllLocalCleanup({ wipeIdentity: false, disconnectTon });

    expect(localStorage.getItem('debug-replay-sessions')).toBeNull();
    expect(localStorage.getItem('debug-panel-tab')).toBeNull();
    expect(localStorage.getItem('debug-unexpected-key')).toBeNull();
    expect(localStorage.getItem('debug-mock-enabled')).toBeNull();
    expect(localStorage.getItem('debug-mock-configs')).toBeNull();
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem('bc:other')).not.toBeNull();
    expect(localStorage.getItem('ton-connect-ui_wallet-info')).not.toBeNull();
    expect(localStorage.getItem('tonconnect-preferences')).not.toBeNull();
  });

  it('account-mode removes debug-* keys and prefs', async () => {
    localStorage.setItem('debug-replay-sessions', '[{"id":"s1"}]');
    localStorage.setItem('debug-panel-tab', 'messages');
    localStorage.setItem('debug-unexpected-key', 'must-not-survive');

    await performBurnAllLocalCleanup({ wipeIdentity: true, disconnectTon });

    expect(localStorage.getItem('debug-replay-sessions')).toBeNull();
    expect(localStorage.getItem('debug-panel-tab')).toBeNull();
    expect(localStorage.getItem('debug-unexpected-key')).toBeNull();
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('bc:other')).toBeNull();
  });

  it('resets debug-panel RAM buffers in both modes', async () => {
    await performBurnAllLocalCleanup({ wipeIdentity: false, disconnectTon });

    expect(clearDebugLogs).toHaveBeenCalledTimes(1);
    expect(clearStompMessages).toHaveBeenCalledTimes(1);
    expect(clearCryptoOperations).toHaveBeenCalledTimes(1);
    expect(resetMessageCounters).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    await performBurnAllLocalCleanup({ wipeIdentity: true, disconnectTon });

    expect(clearDebugLogs).toHaveBeenCalledTimes(1);
    expect(clearStompMessages).toHaveBeenCalledTimes(1);
    expect(clearCryptoOperations).toHaveBeenCalledTimes(1);
    expect(resetMessageCounters).toHaveBeenCalledTimes(1);
  });
});
