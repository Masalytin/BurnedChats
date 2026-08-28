// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import * as useMessageCore from '../useMessageCore';
import { useDmInboundBuffer } from '../useDmInboundBuffer';
import { useMessages } from '../useMessages';

const NEW_MESSAGE_DESTINATION = '/user/queue/new-message';
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

function makeNewMessageBody(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    sessionId: 'sess-1',
    messageId: 'k2-resend-1',
    senderId: 99,
    senderInternalId: 'peer-int',
    encryptedContent: 'enc:hello-k2',
    iv: 'iv-k2',
    clientTimestamp: 1_720_000_000_000,
    serverTimestamp: '2026-08-28T11:04:47.000Z',
    type: 'text',
    ...overrides,
  };
}

function makeIMessage(body: unknown): IMessage {
  return { body: JSON.stringify(body) } as IMessage;
}

describe('IMP-DMRD-02 inbound buffer during verify', () => {
  const subscribeHandlers = new Map<string, (message: IMessage) => void>();
  let decryptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    subscribeHandlers.clear();
    decryptSpy = vi.spyOn(useMessageCore, 'decryptTextContent').mockImplementation(async (_ctx, enc) => {
      return `plain:${enc}`;
    });
  });

  function createWs() {
    const subscribe = vi.fn((destination: string, handler: (message: IMessage) => void) => {
      subscribeHandlers.set(destination, handler);
    });
    const unsubscribe = vi.fn();
    const publish = vi.fn();
    return {
      isConnected: true,
      isReconnection: false,
      subscribe,
      unsubscribe,
      publish,
    };
  }

  it('buffers inbound new-message while view=verify without decrypting', () => {
    const ws = createWs();
    const { result } = renderHook(() =>
      useDmInboundBuffer({
        sessionId: 'sess-1',
        currentView: 'verify',
        isConnected: true,
        subscribe: ws.subscribe,
        unsubscribe: ws.unsubscribe,
      }),
    );

    const handler = subscribeHandlers.get(NEW_MESSAGE_DESTINATION);
    expect(handler).toBeDefined();

    act(() => {
      handler!(makeIMessage(makeNewMessageBody()));
    });

    expect(result.current.buffered).toHaveLength(1);
    expect(result.current.buffered[0]).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      messageId: 'k2-resend-1',
      encryptedContent: 'enc:hello-k2',
      iv: 'iv-k2',
    }));
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it('does not subscribe on home (ChatView and verify both unmounted)', () => {
    const ws = createWs();
    renderHook(() =>
      useDmInboundBuffer({
        sessionId: 'sess-1',
        currentView: 'home',
        isConnected: true,
        subscribe: ws.subscribe,
        unsubscribe: ws.unsubscribe,
      }),
    );

    expect(ws.subscribe).not.toHaveBeenCalled();
  });

  it('shows buffered verify inbound in chat state after bothVerified, without duplicates', async () => {
    const ws = createWs();
    const bufferHook = renderHook(
      (props: { currentView: 'verify' | 'chat' }) =>
        useDmInboundBuffer({
          sessionId: 'sess-1',
          currentView: props.currentView,
          isConnected: true,
          subscribe: ws.subscribe,
          unsubscribe: ws.unsubscribe,
        }),
      { initialProps: { currentView: 'verify' as 'verify' | 'chat' } },
    );

    const inboundHandler = subscribeHandlers.get(NEW_MESSAGE_DESTINATION);
    expect(inboundHandler).toBeDefined();

    act(() => {
      inboundHandler!(makeIMessage(makeNewMessageBody()));
    });

    expect(decryptSpy).not.toHaveBeenCalled();
    expect(bufferHook.result.current.buffered).toHaveLength(1);

    act(() => {
      bufferHook.rerender({ currentView: 'chat' });
    });

    const chatHook = renderHook(() =>
      useMessages({
        sessionId: 'sess-1',
        userId: 'user-int',
        userTelegramId: 42,
        ws,
        bothVerified: true,
        inboundBuffer: bufferHook.result.current,
      }),
    );

    await waitFor(() => {
      expect(chatHook.result.current.messages).toHaveLength(1);
    });

    expect(chatHook.result.current.messages[0]).toEqual(expect.objectContaining({
      id: 'k2-resend-1',
      content: 'plain:enc:hello-k2',
      sessionId: 'sess-1',
    }));

    const syncHandler = subscribeHandlers.get(SYNC_MESSAGES_RESULT_DESTINATION);
    expect(syncHandler).toBeDefined();

    await act(async () => {
      await syncHandler!({
        body: JSON.stringify({
          success: true,
          sessionId: 'sess-1',
          messages: [{
            messageId: 'k2-resend-1',
            encryptedContent: 'enc:hello-k2',
            iv: 'iv-k2',
            senderId: 99,
            senderInternalId: 'peer-int',
            clientTimestamp: 1_720_000_000_000,
            type: 'text',
          }],
          count: 1,
          serverTimestamp: '2026-08-28T11:05:04.000Z',
        }),
      } as IMessage);
    });

    await waitFor(() => {
      expect(chatHook.result.current.messages).toHaveLength(1);
    });
    expect(chatHook.result.current.messages.map((m) => m.id)).toEqual(['k2-resend-1']);
  });

  it('does not decrypt buffered ciphertext until bothVerified (IMP-VRF-01)', async () => {
    const ws = createWs();
    const bufferHook = renderHook(() =>
      useDmInboundBuffer({
        sessionId: 'sess-1',
        currentView: 'chat',
        isConnected: true,
        subscribe: ws.subscribe,
        unsubscribe: ws.unsubscribe,
      }),
    );

    const inboundHandler = subscribeHandlers.get(NEW_MESSAGE_DESTINATION);
    act(() => {
      inboundHandler!(makeIMessage(makeNewMessageBody()));
    });

    decryptSpy.mockClear();

    renderHook(() =>
      useMessages({
        sessionId: 'sess-1',
        userId: 'user-int',
        userTelegramId: 42,
        ws,
        bothVerified: false,
        inboundBuffer: bufferHook.result.current,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(decryptSpy).not.toHaveBeenCalled();
  });
});
