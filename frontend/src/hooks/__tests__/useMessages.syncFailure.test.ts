// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import * as useMessageCore from '../useMessageCore';
import { useMessages } from '../useMessages';

const SYNC_MESSAGES_RESULT_DESTINATION = '/user/queue/sync-messages';

vi.mock('@/crypto/aes', () => ({
  encryptMessage: vi.fn(),
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

function makeSyncedTextMessage(messageId: string, encryptedContent: string) {
  return {
    messageId,
    encryptedContent,
    iv: 'iv-test',
    senderId: 99,
    clientTimestamp: 1000,
    serverTimestamp: '2026-07-14T00:00:00.000Z',
    type: 'text',
  };
}

describe('useMessages handleSyncMessages decrypt failures', () => {
  const subscribeHandlers = new Map<string, (message: IMessage) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    subscribeHandlers.clear();
    vi.spyOn(useMessageCore, 'decryptTextContent').mockImplementation(async (_ctx, enc) => {
      if (enc.startsWith('bad:')) {
        throw new Error('decrypt failed');
      }
      return `plain:${enc}`;
    });
  });

  function renderUseMessages(onSyncComplete = vi.fn(), messageTtlSeconds = 0) {
    const subscribe = vi.fn((destination: string, handler: (message: IMessage) => void) => {
      subscribeHandlers.set(destination, handler);
    });
    const unsubscribe = vi.fn();
    const publish = vi.fn();

    const hook = renderHook(() =>
      useMessages({
        sessionId: 'sess-1',
        userId: 'user-int',
        userTelegramId: 42,
        ws: {
          isConnected: true,
          isReconnection: false,
          subscribe,
          unsubscribe,
          publish,
        },
        bothVerified: true,
        messageTtlSeconds,
        onSyncComplete,
      }),
    );

    return { ...hook, onSyncComplete, subscribe };
  }

  it('reports failedCount when sync batch has valid and undecryptable messages', async () => {
    const onSyncComplete = vi.fn();
    const { result } = renderUseMessages(onSyncComplete);

    const syncHandler = subscribeHandlers.get(SYNC_MESSAGES_RESULT_DESTINATION);
    expect(syncHandler).toBeDefined();

    await act(async () => {
      await syncHandler!({
        body: JSON.stringify({
          success: true,
          sessionId: 'sess-1',
          messages: [
            makeSyncedTextMessage('ok-1', 'good:one'),
            makeSyncedTextMessage('ok-2', 'good:two'),
            makeSyncedTextMessage('bad-1', 'bad:three'),
            makeSyncedTextMessage('bad-2', 'bad:four'),
          ],
          count: 4,
          serverTimestamp: '2026-07-14T00:00:00.000Z',
        }),
      } as IMessage);
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['ok-1', 'ok-2']);
    expect(result.current.messages[0]?.content).toBe('plain:good:one');
    expect(onSyncComplete).toHaveBeenCalledWith(2, 2);
  });

  it('does not report failedCount when all synced messages decrypt successfully', async () => {
    const onSyncComplete = vi.fn();
    const { result } = renderUseMessages(onSyncComplete);

    const syncHandler = subscribeHandlers.get(SYNC_MESSAGES_RESULT_DESTINATION);
    expect(syncHandler).toBeDefined();

    await act(async () => {
      await syncHandler!({
        body: JSON.stringify({
          success: true,
          sessionId: 'sess-1',
          messages: [
            makeSyncedTextMessage('ok-1', 'good:one'),
            makeSyncedTextMessage('ok-2', 'good:two'),
          ],
          count: 2,
          serverTimestamp: '2026-07-14T00:00:00.000Z',
        }),
      } as IMessage);
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    expect(onSyncComplete).toHaveBeenCalledWith(2, undefined);
  });

  it('does not decrypt sync messages already past TTL cutoff', async () => {
    const decryptSpy = vi.spyOn(useMessageCore, 'decryptTextContent');
    const onSyncComplete = vi.fn();
    const { result } = renderUseMessages(onSyncComplete, 5);

    const syncHandler = subscribeHandlers.get(SYNC_MESSAGES_RESULT_DESTINATION);
    expect(syncHandler).toBeDefined();

    await act(async () => {
      await syncHandler!({
        body: JSON.stringify({
          success: true,
          sessionId: 'sess-1',
          messages: [
            {
              ...makeSyncedTextMessage('expired-1', 'good:old'),
              serverTimestamp: '2020-01-01T00:00:00.000Z',
              clientTimestamp: Date.now() + 86_400_000,
            },
            {
              ...makeSyncedTextMessage('live-1', 'good:live'),
              serverTimestamp: new Date().toISOString(),
              clientTimestamp: Date.now(),
            },
          ],
          count: 2,
          serverTimestamp: new Date().toISOString(),
        }),
      } as IMessage);
    });

    await waitFor(() => {
      expect(result.current.messages.map((m) => m.id)).toEqual(['live-1']);
    });

    expect(decryptSpy).not.toHaveBeenCalledWith('sess-1', 'good:old', expect.anything());
    expect(decryptSpy).toHaveBeenCalledWith('sess-1', 'good:live', 'iv-test');
    expect(onSyncComplete).toHaveBeenCalledWith(1, undefined);
  });
});
