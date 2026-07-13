// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { burnAll as burnAllKeys } from '@/crypto/keyStore';
import { clearDownloadCache } from '@/services/fileDownloadService';
import { cancelAll } from '@/services/transferQueue';
import { PENDING_INVITE_TOKEN_KEY } from '@/utils/inviteLink';
import { PREFERENCES_STORAGE_KEY } from '@/preferences/preferencesStorage';
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

describe('performBurnAllLocalCleanup', () => {
  const disconnectTon = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('bc:hidden:dm:session-1', '["m1"]');
    sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, 'invite-token');
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
    expect(disconnectTon).toHaveBeenCalled();
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toBeNull();
  });

  it('also clears app localStorage when wipeIdentity is true', async () => {
    await performBurnAllLocalCleanup({ wipeIdentity: true, disconnectTon });

    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('bc:other')).toBeNull();
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
});
