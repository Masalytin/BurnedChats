// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DecryptedFileMessage, DecryptedMessage, MessageType } from '@/types';
import { sendEncryptedFileMessage } from '../useMessageCore';

const PLAINTEXT_SIZE = 1024;
const CIPHERTEXT_SIZE = 1100;

const mockAesKey = {} as CryptoKey;

vi.mock('@/crypto/keyStore', () => ({
  resolveDecryptionKey: vi.fn(() => ({ key: mockAesKey })),
  resolveDecryptionKeyForRoomMessage: vi.fn(),
  getAESKey: vi.fn(),
  hasGroupKey: vi.fn(),
}));

vi.mock('@/utils/fileValidation', () => ({
  validateFileForUpload: vi.fn(() => ({
    ok: true as const,
    messageType: 'file' as const,
    resolvedMime: 'application/pdf',
  })),
}));

vi.mock('@/crypto/aes', () => ({
  encryptMessage: vi.fn(async () => ({ ciphertext: 'enc', iv: 'iv' })),
  decryptMessage: vi.fn(),
}));

vi.mock('@/crypto/fileEncryption', () => ({
  encryptFileMetadata: vi.fn(async () => 'meta-b64'),
  decryptFileMetadata: vi.fn(),
}));

vi.mock('@/services/transferQueue', () => ({
  enqueueUpload: vi.fn(() => ({
    result: Promise.resolve({
      fileId: 'file-123',
      thumbnailFileId: undefined,
      thumbnailDataUrl: undefined,
      size: CIPHERTEXT_SIZE,
    }),
  })),
  cancelAll: vi.fn(),
}));

function makeFile(size = PLAINTEXT_SIZE): File {
  return new File([new Uint8Array(size)], 'doc.pdf', { type: 'application/pdf' });
}

function makeParams(overrides: Partial<Parameters<typeof sendEncryptedFileMessage>[0]> = {}) {
  const messages: DecryptedMessage[] = [];
  const setMessages = vi.fn((updater: React.SetStateAction<DecryptedMessage[]>) => {
    if (typeof updater === 'function') {
      messages.splice(0, messages.length, ...updater(messages));
    } else {
      messages.splice(0, messages.length, ...updater);
    }
  });

  const publish = vi.fn();

  return {
    messages,
    setMessages,
    publish,
    params: {
      file: makeFile(),
      caption: '',
      contextId: 'ctx-1',
      logTag: 'test',
      isConnected: true,
      uploadContext: { type: 'session' as const, id: 'ctx-1' },
      sendDestination: '/app/message.send',
      publish,
      handleError: vi.fn(),
      setError: vi.fn(),
      setMessages,
      pendingMessagesRef: { current: new Map() },
      buildLocalFileMessage: (
        messageId: string,
        timestamp: number,
        messageType: MessageType,
        uploadResult: { fileId: string; thumbnailFileId?: string; thumbnailDataUrl?: string; size: number },
        f: File,
        resolvedMime: string,
        cap: string,
      ) => ({
        id: messageId,
        sessionId: 'ctx-1',
        fromUserId: 1,
        content: cap || f.name,
        timestamp,
        status: 'sending',
        isOwn: true,
        type: messageType,
        fileId: uploadResult.fileId,
        fileSize: f.size,
        fileMeta: { fileName: f.name, mimeType: resolvedMime },
      } as DecryptedFileMessage),
      buildPublishPayload: (payload: Record<string, unknown>) => payload,
      validateBeforeSend: () => null,
      noKeyError: 'NO_KEY' as const,
      encryptionFailedError: 'ENCRYPTION_FAILED' as const,
      sendFailedError: 'SEND_FAILED' as const,
      ...overrides,
    },
  };
}

describe('sendEncryptedFileMessage fileSize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes plaintext file.size in STOMP payload, not ciphertext upload size', async () => {
    const { params, publish } = makeParams();

    const result = await sendEncryptedFileMessage(params);

    expect(result.success).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    const payload = publish.mock.calls[0][1] as { fileSize: number };
    expect(payload.fileSize).toBe(PLAINTEXT_SIZE);
    expect(payload.fileSize).not.toBe(CIPHERTEXT_SIZE);
  });

  it('keeps plaintext fileSize in local message after upload (no size jump)', async () => {
    const { params, messages } = makeParams();

    await sendEncryptedFileMessage(params);

    const fileMsg = messages.find(m => m.type === 'file') as DecryptedFileMessage | undefined;
    expect(fileMsg).toBeDefined();
    expect(fileMsg!.fileSize).toBe(PLAINTEXT_SIZE);
    expect(fileMsg!.fileSize).not.toBe(CIPHERTEXT_SIZE);
  });
});
