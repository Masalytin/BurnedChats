// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMessageCore from '../useMessageCore';
import { useMessages } from '../useMessages';

vi.mock('@/crypto/aes', () => ({
  encryptMessage: vi.fn(async (_key: CryptoKey, text: string) => ({
    ciphertext: `enc:${text}`,
    iv: 'iv-test',
  })),
  decryptMessage: vi.fn(),
}));

vi.mock('@/crypto/keyStore', () => ({
  isHandshakeComplete: vi.fn(() => true),
  getDebugInfo: vi.fn(() => ({ sessionCount: 1 })),
  resolveDecryptionKey: vi.fn(() => ({ key: {} as CryptoKey })),
  getAESKey: vi.fn(() => ({} as CryptoKey)),
  hasGroupKey: vi.fn(() => false),
  resolveDecryptionKeyForRoomMessage: vi.fn(),
}));

vi.mock('@/crypto/fileEncryption', () => ({
  encryptFileMetadata: vi.fn(),
  decryptFileMetadata: vi.fn(),
}));

vi.mock('@/services/fileDownloadService', () => ({
  downloadThumbnail: vi.fn(),
}));

vi.mock('@/services/transferQueue', () => ({
  enqueueUpload: vi.fn(),
  cancelAll: vi.fn(),
}));

vi.mock('@/hooks/useMessageSync', () => ({
  useMessageSync: () => ({
    isSyncing: false,
    setSyncing: vi.fn(),
    triggerSyncIfReady: vi.fn(),
    runReconnectIfNeeded: vi.fn(),
  }),
}));

vi.mock('@/hooks/useHiddenMessages', () => ({
  useHiddenMessages: () => ({
    hiddenIds: new Set<string>(),
    hide: vi.fn(),
    unhide: vi.fn(),
    clear: vi.fn(),
  }),
}));

describe('useMessages offline outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues text while disconnected and flushes after reconnect', async () => {
    const sendSpy = vi.spyOn(useMessageCore, 'sendEncryptedTextMessage').mockResolvedValue({
      success: true,
      messageId: 'queued-1',
      error: null,
    });

    const publish = vi.fn();
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();

    const { result, rerender } = renderHook(
      (props: { isConnected: boolean }) =>
        useMessages({
          sessionId: 'sess-1',
          userId: 'user-int',
          userTelegramId: 42,
          ws: {
            isConnected: props.isConnected,
            isReconnection: false,
            subscribe,
            unsubscribe,
            publish,
          },
          bothVerified: true,
        }),
      { initialProps: { isConnected: false } },
    );

    await act(async () => {
      const sent = await result.current.sendMessage('hello offline');
      expect(sent.success).toBe(true);
      expect(sent.error).toBeNull();
    });

    expect(sendSpy).not.toHaveBeenCalled();

    act(() => {
      rerender({ isConnected: true });
    });

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
    expect(sendSpy.mock.calls[0][0].text).toBe('hello offline');

    sendSpy.mockRestore();
  });
});
