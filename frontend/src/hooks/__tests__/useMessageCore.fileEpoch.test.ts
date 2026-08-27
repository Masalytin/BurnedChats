// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { encryptMessage } from '@/crypto/aes';
import { encryptFileMetadata } from '@/crypto/fileEncryption';
import {
  burnAll,
  storeGroupKey,
  storeKeyPair,
  storeSharedSecret,
  getGroupKeyForEpoch,
} from '@/crypto/keyStore';
import { generateKeyPair } from '@/crypto/ecdh';
import { decryptWireFileMessage, fileContentPlaceholder } from '../useMessageCore';
import { useDecryptionKey } from '../useDecryptionKey';
import type { DecryptedFileMessage, DecryptedMessage } from '@/types';

const { downloadThumbnail } = vi.hoisted(() => ({
  downloadThumbnail: vi.fn(async (_fileId: string, _key: CryptoKey) => 'blob:thumb-preview'),
}));

vi.mock('@/services/fileDownloadService', () => ({
  downloadThumbnail,
}));

async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

function buildFileMessage(base: Omit<DecryptedFileMessage, 'type'> & { type: 'image' | 'video' | 'file' }): DecryptedMessage {
  return { ...base, fromUserId: 1, isOwn: false };
}

describe('decryptWireFileMessage epoch fallback (IMP-RCATCH-01)', () => {
  beforeEach(() => {
    burnAll();
    downloadThumbnail.mockClear();
  });

  afterEach(() => {
    burnAll();
  });

  it('decrypts a previous-epoch file: caption, meta, thumbnail and keyEpoch share that epoch', async () => {
    const roomId = 'room-prev-epoch';
    const key0 = await generateAesKey();
    const key1 = await generateAesKey();
    storeGroupKey(roomId, 0, key0);
    storeGroupKey(roomId, 1, key1);

    const caption = 'old photo';
    const encrypted = await encryptMessage(key0, caption, roomId);
    const encryptedMeta = await encryptFileMetadata(
      { fileName: 'old.png', mimeType: 'image/png' },
      key0,
    );

    const result = await decryptWireFileMessage({
      wire: {
        messageId: 'msg-old',
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        type: 'image',
        fileId: 'file-old',
        thumbnailFileId: 'thumb-old',
        encryptedMeta,
        fileSize: 42,
      },
      contextId: roomId,
      timestamp: 1_700_000_000_000,
      messageType: 'image',
      logTag: 'test',
      buildBase: buildFileMessage,
    });

    expect(result.content).toBe(caption);
    expect(result.type).toBe('image');
    const file = result as DecryptedFileMessage;
    expect(file.fileMeta).toEqual({ fileName: 'old.png', mimeType: 'image/png' });
    expect(file.keyEpoch).toBe(0);
    expect(file.thumbnailUrl).toBe('blob:thumb-preview');
    expect(downloadThumbnail).toHaveBeenCalledWith('thumb-old', key0);
  });

  it('decrypts a current-epoch file without falling back to older epochs', async () => {
    const roomId = 'room-current-epoch';
    const key0 = await generateAesKey();
    const key1 = await generateAesKey();
    storeGroupKey(roomId, 0, key0);
    storeGroupKey(roomId, 1, key1);

    const caption = 'fresh photo';
    const encrypted = await encryptMessage(key1, caption, roomId);
    const encryptedMeta = await encryptFileMetadata(
      { fileName: 'now.png', mimeType: 'image/png' },
      key1,
    );

    const result = await decryptWireFileMessage({
      wire: {
        messageId: 'msg-now',
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        type: 'image',
        fileId: 'file-now',
        encryptedMeta,
        fileSize: 10,
      },
      contextId: roomId,
      timestamp: 1_700_000_000_001,
      messageType: 'image',
      logTag: 'test',
      buildBase: buildFileMessage,
    });

    const file = result as DecryptedFileMessage;
    expect(file.content).toBe(caption);
    expect(file.fileMeta.fileName).toBe('now.png');
    expect(file.keyEpoch).toBe(1);
  });

  it('does not throw when no stored epoch can decrypt the file', async () => {
    const roomId = 'room-no-match';
    const key0 = await generateAesKey();
    const orphan = await generateAesKey();
    storeGroupKey(roomId, 0, key0);

    const encrypted = await encryptMessage(orphan, 'secret', roomId);
    const encryptedMeta = await encryptFileMetadata(
      { fileName: 'orphan.png', mimeType: 'image/png' },
      orphan,
    );

    const result = await decryptWireFileMessage({
      wire: {
        messageId: 'msg-orphan',
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        type: 'image',
        fileId: 'file-orphan',
        encryptedMeta,
        fileSize: 8,
      },
      contextId: roomId,
      timestamp: 1,
      messageType: 'image',
      logTag: 'test',
      buildBase: buildFileMessage,
    });

    const file = result as DecryptedFileMessage;
    expect(file.id).toBe('msg-orphan');
    expect(file.fileMeta.fileName).toBe('unknown');
    expect(file.keyEpoch).toBeUndefined();
  });

  it('decrypts a no-caption file by probing encryptedMeta, not the empty caption', async () => {
    const roomId = 'room-no-caption';
    const key0 = await generateAesKey();
    const key1 = await generateAesKey();
    storeGroupKey(roomId, 0, key0);
    storeGroupKey(roomId, 1, key1);

    const encrypted = await encryptMessage(key0, '', roomId);
    const encryptedMeta = await encryptFileMetadata(
      { fileName: 'silent.jpg', mimeType: 'image/jpeg' },
      key0,
    );

    const result = await decryptWireFileMessage({
      wire: {
        messageId: 'msg-silent',
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        type: 'image',
        fileId: 'file-silent',
        encryptedMeta,
        fileSize: 3,
      },
      contextId: roomId,
      timestamp: 2,
      messageType: 'image',
      logTag: 'test',
      buildBase: buildFileMessage,
    });

    const file = result as DecryptedFileMessage;
    expect(file.content).toBe(fileContentPlaceholder('image', 'silent.jpg'));
    expect(file.fileMeta.fileName).toBe('silent.jpg');
    expect(file.keyEpoch).toBe(0);
  });

  it('does not break the feed when encryptedMeta and caption are both missing', async () => {
    const roomId = 'room-bare';
    const key1 = await generateAesKey();
    storeGroupKey(roomId, 1, key1);

    const encrypted = await encryptMessage(key1, '', roomId);

    const result = await decryptWireFileMessage({
      wire: {
        messageId: 'msg-bare',
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        type: 'file',
        fileId: 'file-bare',
        fileSize: 1,
      },
      contextId: roomId,
      timestamp: 3,
      messageType: 'file',
      logTag: 'test',
      buildBase: buildFileMessage,
    });

    const file = result as DecryptedFileMessage;
    expect(file.id).toBe('msg-bare');
    expect(file.fileMeta.fileName).toBe('unknown');
    expect(file.keyEpoch).toBeUndefined();
  });

  it('keeps the DM path on resolveDecryptionKey (no keyEpoch)', async () => {
    const sessionId = 'dm-session-1';
    storeKeyPair(sessionId, await generateKeyPair());
    const aes = await generateAesKey();
    storeSharedSecret(sessionId, {
      sessionId,
      key: aes,
      fingerprint: '00000 00000',
      visualFingerprint: [],
    });

    const caption = 'dm file';
    const encrypted = await encryptMessage(aes, caption, sessionId);
    const encryptedMeta = await encryptFileMetadata(
      { fileName: 'dm.pdf', mimeType: 'application/pdf' },
      aes,
    );

    const result = await decryptWireFileMessage({
      wire: {
        messageId: 'msg-dm',
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        type: 'file',
        fileId: 'file-dm',
        encryptedMeta,
        fileSize: 9,
      },
      contextId: sessionId,
      timestamp: 4,
      messageType: 'file',
      logTag: 'test',
      buildBase: buildFileMessage,
    });

    const file = result as DecryptedFileMessage;
    expect(file.content).toBe(caption);
    expect(file.fileMeta.fileName).toBe('dm.pdf');
    expect(file.keyEpoch).toBeUndefined();
  });
});

describe('useDecryptionKey epoch selection (IMP-RCATCH-01)', () => {
  beforeEach(() => {
    burnAll();
  });

  afterEach(() => {
    burnAll();
  });

  it('returns the stored epoch key when keyEpoch is set', async () => {
    const roomId = 'room-hook-epoch';
    const key0 = await generateAesKey();
    const key1 = await generateAesKey();
    storeGroupKey(roomId, 0, key0);
    storeGroupKey(roomId, 1, key1);

    const { result } = renderHook(() => useDecryptionKey(roomId, 0));
    expect(result.current).toBe(key0);
    expect(result.current).toBe(getGroupKeyForEpoch(roomId, 0));
    expect(result.current).not.toBe(key1);
  });

  it('falls back to the latest key when keyEpoch is omitted', async () => {
    const roomId = 'room-hook-fallback';
    const key0 = await generateAesKey();
    const key1 = await generateAesKey();
    storeGroupKey(roomId, 0, key0);
    storeGroupKey(roomId, 1, key1);

    const { result } = renderHook(() => useDecryptionKey(roomId));
    expect(result.current).toBe(key1);
  });
});
