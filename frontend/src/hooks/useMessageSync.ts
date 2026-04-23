import { useCallback, useEffect, useRef, useState } from 'react';

export type MessageSyncRequestSource = 'subscription' | 'late-handshake';

export interface UseMessageSyncOptions {
  scopeId: string;
  isConnected: boolean;
  isReconnection: boolean;
  canSync: () => boolean;
  doPublishInitialSync: () => void;
  doPublishReconnectSync?: () => void;
  /** Fires after a successful initial/late-handshake sync request is sent. */
  onInitialSyncRequest?: (source: MessageSyncRequestSource) => void;
}

export interface UseMessageSyncReturn {
  isSyncing: boolean;
  setSyncing: (v: boolean) => void;
  triggerSyncIfReady: (source?: MessageSyncRequestSource) => void;
  runReconnectIfNeeded: () => void;
  resetSyncFlag: () => void;
}

/**
 * Shared state + ref for one sync per connection scope (DM or room), plus helpers
 * that match useMessages / useRoomMessages offline-sync patterns.
 *
 * Call {@link triggerSyncIfReady} from a subscription effect (after STOMP
 * subscribe). Call {@link runReconnectIfNeeded} from a separate effect that is
 * declared *after* that subscription effect so connect/reconnect order stays correct.
 */
export function useMessageSync(options: UseMessageSyncOptions): UseMessageSyncReturn {
  const {
    scopeId,
    isConnected,
    isReconnection,
    canSync,
    doPublishInitialSync,
    doPublishReconnectSync,
    onInitialSyncRequest,
  } = options;

  const [isSyncing, setIsSyncing] = useState(false);
  const syncTriggeredRef = useRef(false);

  const resetSyncFlag = useCallback(() => {
    syncTriggeredRef.current = false;
  }, []);

  const triggerSyncIfReady = useCallback(
    (source: MessageSyncRequestSource = 'subscription') => {
      if (!scopeId) {
        return;
      }
      if (syncTriggeredRef.current) {
        return;
      }
      if (!canSync()) {
        return;
      }
      syncTriggeredRef.current = true;
      setIsSyncing(true);
      doPublishInitialSync();
      onInitialSyncRequest?.(source);
    },
    [scopeId, canSync, doPublishInitialSync, onInitialSyncRequest],
  );

  const runReconnectIfNeeded = useCallback(() => {
    if (!isConnected || !scopeId || !isReconnection) {
      return;
    }
    if (syncTriggeredRef.current) {
      return;
    }
    if (!canSync()) {
      return;
    }
    syncTriggeredRef.current = true;
    setIsSyncing(true);
    (doPublishReconnectSync ?? doPublishInitialSync)();
  }, [isConnected, scopeId, isReconnection, canSync, doPublishInitialSync, doPublishReconnectSync]);

  useEffect(() => {
    syncTriggeredRef.current = false;
  }, [scopeId]);

  useEffect(() => {
    if (!isConnected) {
      syncTriggeredRef.current = false;
    }
  }, [isConnected]);

  // Handshake / group key may still be missing when the scope mounts. Poll like useMessages
  // (FIX-SYNC-1). When canSync becomes true, defer with queueMicrotask so a parent
  // subscription effect in the same commit runs first and wires STOMP handlers.
  useEffect(() => {
    if (!isConnected || !scopeId) {
      return;
    }
    if (syncTriggeredRef.current) {
      return;
    }
    if (canSync()) {
      queueMicrotask(() => {
        if (syncTriggeredRef.current) {
          return;
        }
        if (canSync()) {
          triggerSyncIfReady('late-handshake');
        }
      });
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60; // ~30s at 500ms

    const intervalId = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      attempts += 1;

      if (syncTriggeredRef.current) {
        window.clearInterval(intervalId);
        return;
      }

      if (canSync()) {
        triggerSyncIfReady('late-handshake');
        window.clearInterval(intervalId);
      } else if (attempts >= maxAttempts) {
        window.clearInterval(intervalId);
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isConnected, scopeId, canSync, triggerSyncIfReady]);

  return {
    isSyncing,
    setSyncing: setIsSyncing,
    triggerSyncIfReady,
    runReconnectIfNeeded,
    resetSyncFlag,
  };
}
