import { useCallback, useEffect, useRef, useState } from 'react';
import { generateKeyPair, exportPublicKey } from '../crypto/ecdh';
import { storeKeyPair, hasGroupKey } from '../crypto/keyStore';

const REQUEST_KEY_BUNDLE_DESTINATION = '/app/room.requestKeyBundle';

const RETRY_INTERVAL_MS = 12_000;

interface UseRequestKeyBundleOptions {
  roomId: string | null;
  isConnected: boolean;
  publish: (destination: string, body: unknown) => void;
  /** Only activate when true (caller checks !hasGroupKey && !isOwner). */
  enabled: boolean;
}

export interface UseRequestKeyBundleReturn {
  isRequesting: boolean;
  retry: () => void;
}

/**
 * Hook that automatically requests a fresh KEY_BUNDLE from the room owner when
 * the member enters a room without a group key (e.g. after app restart).
 *
 * Generates a new ECDH keypair, stores it under `room-join:{roomId}` (so
 * `useKeyBundle` can unwrap the response), and publishes a request to the server.
 * Retries periodically in case the owner was offline.
 */
export function useRequestKeyBundle({
  roomId,
  isConnected,
  publish,
  enabled,
}: UseRequestKeyBundleOptions): UseRequestKeyBundleReturn {
  const [isRequesting, setIsRequesting] = useState(false);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; });

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentForRoomRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const sendRequest = useCallback(async (targetRoomId: string) => {
    if (!isMountedRef.current) return;
    setIsRequesting(true);

    try {
      const keyPair = await generateKeyPair();
      storeKeyPair(`room-join:${targetRoomId}`, keyPair);
      const publicKey = await exportPublicKey(keyPair.publicKey);

      publishRef.current(REQUEST_KEY_BUNDLE_DESTINATION, {
        roomId: targetRoomId,
        publicKey,
      });

      sentForRoomRef.current = targetRoomId;
      console.info('[useRequestKeyBundle] Sent request for room', targetRoomId);
    } catch (err) {
      console.error('[useRequestKeyBundle] Failed to generate keypair / send request:', err);
      if (isMountedRef.current) setIsRequesting(false);
    }
  }, []);

  const scheduleRetry = useCallback((targetRoomId: string) => {
    clearRetryTimer();
    retryTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      if (hasGroupKey(targetRoomId)) {
        setIsRequesting(false);
        return;
      }
      console.info('[useRequestKeyBundle] Retrying request for room', targetRoomId);
      sendRequest(targetRoomId).then(() => {
        if (isMountedRef.current && !hasGroupKey(targetRoomId)) {
          scheduleRetry(targetRoomId);
        }
      });
    }, RETRY_INTERVAL_MS);
  }, [clearRetryTimer, sendRequest]);

  useEffect(() => {
    if (!enabled || !roomId || !isConnected) {
      clearRetryTimer();
      sentForRoomRef.current = null;
      setIsRequesting(false);
      return;
    }

    if (hasGroupKey(roomId)) {
      setIsRequesting(false);
      return;
    }

    sendRequest(roomId).then(() => {
      if (isMountedRef.current && roomId && !hasGroupKey(roomId)) {
        scheduleRetry(roomId);
      }
    });

    return () => {
      clearRetryTimer();
    };
  }, [enabled, roomId, isConnected, sendRequest, scheduleRetry, clearRetryTimer]);

  const retry = useCallback(() => {
    if (!roomId || !isConnected) return;
    clearRetryTimer();
    sendRequest(roomId).then(() => {
      if (isMountedRef.current && roomId && !hasGroupKey(roomId)) {
        scheduleRetry(roomId);
      }
    });
  }, [roomId, isConnected, clearRetryTimer, sendRequest, scheduleRetry]);

  return { isRequesting, retry };
}
