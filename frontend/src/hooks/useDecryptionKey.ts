import { useEffect, useState } from 'react';
import { addKeyStoreListener, resolveDecryptionKey } from '@/crypto/keyStore';

/**
 * Returns the AES CryptoKey for decrypting file payloads in the given chat context
 * (1-on-1 session or room). Subscribes to the key store so the value updates when
 * the handshake completes or a room group key is stored (keyStore is not React state).
 */
export function useDecryptionKey(contextId: string): CryptoKey | undefined {
  const [key, setKey] = useState<CryptoKey | undefined>(
    () => resolveDecryptionKey(contextId, { silent: true })?.key,
  );

  useEffect(() => {
    function refresh() {
      setKey(resolveDecryptionKey(contextId, { silent: true })?.key);
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
  }, [contextId]);

  return key;
}
