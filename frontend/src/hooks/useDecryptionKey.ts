import { useEffect, useState } from 'react';
import { addKeyStoreListener, getGroupKeyForEpoch, resolveDecryptionKey } from '@/crypto/keyStore';

function resolveKey(contextId: string, keyEpoch?: number): CryptoKey | undefined {
  if (typeof keyEpoch === 'number') {
    return getGroupKeyForEpoch(contextId, keyEpoch);
  }
  return resolveDecryptionKey(contextId, { silent: true })?.key;
}

/**
 * Returns the AES CryptoKey for decrypting file payloads in the given chat context
 * (1-on-1 session or room). When `keyEpoch` is set (client-only field on a room
 * file message), returns that epoch's group key instead of the latest one.
 * Subscribes to the key store so the value updates when the handshake completes
 * or a room group key is stored (keyStore is not React state).
 */
export function useDecryptionKey(contextId: string, keyEpoch?: number): CryptoKey | undefined {
  const [key, setKey] = useState<CryptoKey | undefined>(() => resolveKey(contextId, keyEpoch));

  useEffect(() => {
    function refresh() {
      setKey(resolveKey(contextId, keyEpoch));
    }

    refresh();
    return addKeyStoreListener((id, event) => {
      if (event === 'burned_all') {
        refresh();
        return;
      }
      if (id === contextId) {
        refresh();
      }
    });
  }, [contextId, keyEpoch]);

  return key;
}
