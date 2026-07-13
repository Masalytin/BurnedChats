// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecryptedFileMessage, DecryptedMessage } from '@/types';
import {
  UNDELIVERED_RESEND_CAP,
  runUndeliveredResendAfterRekey,
  selectUndeliveredResendCandidates,
} from '../useMessageCore';
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

function makeMessage(overrides: Partial<DecryptedMessage> & Pick<DecryptedMessage, 'id'>): DecryptedMessage {
  const { id, ...rest } = overrides;
  return {
    id,
    sessionId: 'sess-1',
    content: 'hello',
    timestamp: 1000,
    status: 'sent',
    isOwn: true,
    type: 'text',
    ...rest,
  };
}

describe('selectUndeliveredResendCandidates', () => {
  it('selects own sent text messages sorted by timestamp', () => {
    const messages = [
      makeMessage({ id: 'm2', timestamp: 2000, content: 'b' }),
      makeMessage({ id: 'm1', timestamp: 1000, content: 'a' }),
      makeMessage({ id: 'm3', timestamp: 3000, status: 'delivered' }),
      makeMessage({ id: 'm4', timestamp: 4000, isOwn: false }),
      makeMessage({ id: 'm5', timestamp: 5000, status: 'sending' }),
    ];

    const { textCandidates, fileMessageIds } = selectUndeliveredResendCandidates(messages, new Set());

    expect(textCandidates.map((c) => c.messageId)).toEqual(['m1', 'm2']);
    expect(textCandidates[0]?.timestamp).toBe(1000);
    expect(fileMessageIds).toEqual([]);
  });

  it('excludes hidden messages and caps at UNDELIVERED_RESEND_CAP', () => {
    const messages = Array.from({ length: UNDELIVERED_RESEND_CAP + 5 }, (_, i) =>
      makeMessage({ id: `m${i}`, timestamp: i * 1000 }),
    );
    const hidden = new Set(['m0', 'm1']);

    const { textCandidates } = selectUndeliveredResendCandidates(messages, hidden);

    expect(textCandidates).toHaveLength(UNDELIVERED_RESEND_CAP);
    expect(textCandidates[0]?.messageId).toBe('m5');
    expect(textCandidates.at(-1)?.messageId).toBe(`m${UNDELIVERED_RESEND_CAP + 4}`);
  });

  it('routes queued file messages to failed list instead of resend', () => {
    const messages: DecryptedMessage[] = [
      makeMessage({ id: 't1', type: 'text' }),
      {
        ...makeMessage({ id: 'f1', type: 'image', content: '📷 pic.jpg' }),
        fileId: 'file-1',
        fileSize: 100,
        fileMeta: { fileName: 'pic.jpg', mimeType: 'image/jpeg' },
      } as DecryptedFileMessage,
    ];

    const { textCandidates, fileMessageIds } = selectUndeliveredResendCandidates(messages, new Set());

    expect(textCandidates).toHaveLength(1);
    expect(textCandidates[0]?.messageId).toBe('t1');
    expect(fileMessageIds).toEqual(['f1']);
  });
});

describe('runUndeliveredResendAfterRekey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-encrypts and publishes text with same messageId and timestamp', async () => {
    const publish = vi.fn();
    const setMessages = vi.fn();
    const pendingMessagesRef = { current: new Map<string, { text: string; timestamp: number }>() };
    const messages = [makeMessage({ id: 'msg-a', content: 'queued', timestamp: 4242 })];

    const result = await runUndeliveredResendAfterRekey({
      messages,
      hiddenIds: new Set(),
      contextId: 'sess-1',
      logTag: 'test',
      sendDestination: '/app/message.send',
      publish,
      handleError: vi.fn(),
      setMessages,
      pendingMessagesRef,
      buildPublishPayload: (p) => p,
      validateBeforeSend: () => null,
      noKeyError: 'NO_ENCRYPTION_KEY',
      encryptionFailedError: 'ENCRYPTION_FAILED',
    });

    expect(result).toEqual({ textResent: 1, filesMarkedFailed: 0 });
    expect(publish).toHaveBeenCalledWith('/app/message.send', expect.objectContaining({
      messageId: 'msg-a',
      timestamp: 4242,
      encryptedContent: 'enc:queued',
      iv: 'iv-test',
    }));
    expect(pendingMessagesRef.current.get('msg-a')).toEqual({ text: 'queued', timestamp: 4242 });
  });
});

describe('useMessages rekeyResendNonce trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runUndeliveredResendAfterRekey when rekeyResendNonce increments', async () => {
    const resendSpy = vi.spyOn(useMessageCore, 'runUndeliveredResendAfterRekey')
      .mockResolvedValue({ textResent: 0, filesMarkedFailed: 0 });

    const publish = vi.fn();
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();

    const { rerender } = renderHook(
      (props: { rekeyResendNonce: number }) =>
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
          rekeyResendNonce: props.rekeyResendNonce,
        }),
      { initialProps: { rekeyResendNonce: 0 } },
    );

    act(() => {
      rerender({ rekeyResendNonce: 1 });
    });

    await waitFor(() => {
      expect(resendSpy).toHaveBeenCalledTimes(1);
    });

    act(() => {
      rerender({ rekeyResendNonce: 1 });
    });

    expect(resendSpy).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ rekeyResendNonce: 2 });
    });

    await waitFor(() => {
      expect(resendSpy).toHaveBeenCalledTimes(2);
    });

    resendSpy.mockRestore();
  });
});
