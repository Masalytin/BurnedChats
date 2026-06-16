import { useEffect, useCallback, useRef } from 'react';
import {
  burnAll,
  getActiveSessionIds,
  BACKGROUND_BURN_THRESHOLD_MS,
} from '@/crypto/keyStore';
import { cancelAll } from '@/services/transferQueue';

/** Payload when keys are wiped after a long background period (IMP-AUDIT-10). */
export interface BackgroundKeysBurnedInfo {
  reason: 'background_timeout';
  /** Session IDs that had keys before the wipe (for UI cleanup). */
  sessionIdsBurned: string[];
}

/**
 * Hook options for app lifecycle management (5.1.5).
 */
interface UseAppLifecycleOptions {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Publish message to STOMP destination */
  publish: (destination: string, body: unknown) => void;
  /** Callback when app is about to close */
  onBeforeClose?: () => void;
  /** Callback when visibility changes */
  onVisibilityChange?: (visible: boolean) => void;
  /**
   * Called when the document becomes visible after being hidden (FIX-SYNC-3).
   *
   * Does NOT fire on the initial mount — only on an actual `hidden → visible`
   * transition. Useful for re-syncing state when the Mini App returns from
   * background.
   */
  onVisibilityRestored?: () => void;
  /**
   * Called after {@link burnAll} due to exceeding {@link BACKGROUND_BURN_THRESHOLD_MS}
   * while hidden. Use to reset chat UI and defer user-facing toast until visible.
   */
  onBackgroundKeysBurned?: (info: BackgroundKeysBurnedInfo) => void;
}

/** STOMP destination for peer disconnect notification */
const PEER_DISCONNECT_DESTINATION = '/app/peer.disconnect';

/**
 * Hook for handling Mini App lifecycle events (5.1.5).
 * 
 * Handles:
 * - beforeunload: Burn keys and notify peers
 * - visibilitychange: Handle tab/app backgrounding
 * - Page hide: Handle mobile app suspension
 * - Long background: Burn keys after {@link BACKGROUND_BURN_THRESHOLD_MS} (IMP-AUDIT-10)
 * 
 * Security features:
 * - Keys are burned on any app close/suspend
 * - Keys are burned after sustained background (configurable threshold)
 * - Peers are notified when user disconnects
 * 
 * @example
 * ```tsx
 * function App() {
 *   const { isConnected, publish } = useWebSocket();
 *   
 *   useAppLifecycle({
 *     isConnected,
 *     publish,
 *     onBeforeClose: () => console.log('Closing...'),
 *   });
 *   
 *   return <MainContent />;
 * }
 * ```
 */
export function useAppLifecycle(options: UseAppLifecycleOptions): void {
  const {
    isConnected,
    publish,
    onBeforeClose,
    onVisibilityChange,
    onVisibilityRestored,
    onBackgroundKeysBurned,
  } = options;

  // Track if cleanup has been performed
  const cleanupPerformedRef = useRef(false);
  // Track whether the document was hidden, so we fire onVisibilityRestored only
  // on an actual hidden → visible transition (not on the initial mount).
  const wasHiddenRef = useRef(false);
  const backgroundBurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundBurnPerformedRef = useRef(false);

  // Keep the latest callbacks without re-subscribing handlers
  const onVisibilityRestoredRef = useRef(onVisibilityRestored);
  const onBackgroundKeysBurnedRef = useRef(onBackgroundKeysBurned);
  useEffect(() => {
    onVisibilityRestoredRef.current = onVisibilityRestored;
    onBackgroundKeysBurnedRef.current = onBackgroundKeysBurned;
  }, [onVisibilityRestored, onBackgroundKeysBurned]);

  const cancelBackgroundBurnTimer = useCallback(() => {
    if (backgroundBurnTimerRef.current !== null) {
      clearTimeout(backgroundBurnTimerRef.current);
      backgroundBurnTimerRef.current = null;
    }
  }, []);

  /**
   * Wipe keys after sustained background. Does not notify peers (session may still
   * exist server-side; user can resume from the session list).
   */
  const performBackgroundBurn = useCallback(() => {
    if (backgroundBurnPerformedRef.current || cleanupPerformedRef.current) {
      return;
    }

    const sessionIdsBurned = getActiveSessionIds();
    backgroundBurnPerformedRef.current = true;
    backgroundBurnTimerRef.current = null;

    console.log(
      `[AppLifecycle] Background burn after ${BACKGROUND_BURN_THRESHOLD_MS}ms hidden`,
    );

    cancelAll();
    burnAll('background_timeout');

    try {
      onBackgroundKeysBurnedRef.current?.({
        reason: 'background_timeout',
        sessionIdsBurned,
      });
    } catch (err) {
      console.warn('[AppLifecycle] onBackgroundKeysBurned threw:', err);
    }
  }, []);

  const scheduleBackgroundBurn = useCallback(() => {
    cancelBackgroundBurnTimer();
    backgroundBurnTimerRef.current = setTimeout(
      performBackgroundBurn,
      BACKGROUND_BURN_THRESHOLD_MS,
    );
  }, [cancelBackgroundBurnTimer, performBackgroundBurn]);

  /**
   * Notify peers about disconnect and burn all keys.
   */
  const performCleanup = useCallback(() => {
    if (cleanupPerformedRef.current) {
      return;
    }
    cleanupPerformedRef.current = true;
    cancelBackgroundBurnTimer();

    console.log('[AppLifecycle] Performing cleanup...');

    // Get active sessions to notify peers
    const sessionIds = getActiveSessionIds();

    // Try to notify peers via WebSocket (may not succeed if closing)
    if (isConnected && sessionIds.length > 0) {
      try {
        sessionIds.forEach((sessionId) => {
          publish(PEER_DISCONNECT_DESTINATION, {
            sessionId,
            reason: 'APP_CLOSED',
          });
        });
        console.log(`[AppLifecycle] Notified peers for ${sessionIds.length} sessions`);
      } catch (error) {
        console.warn('[AppLifecycle] Failed to notify peers:', error);
      }
    }

    cancelAll();
    // Burn all cryptographic keys (this is the critical security step)
    burnAll('page_unload');
    console.log('[AppLifecycle] All keys burned');
  }, [isConnected, publish, cancelBackgroundBurnTimer]);

  /**
   * Handle beforeunload event (page close/refresh).
   */
  const handleBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
    console.log('[AppLifecycle] beforeunload triggered');
    
    // Call user callback
    onBeforeClose?.();

    // Perform cleanup
    performCleanup();

    // Note: Most browsers will ignore this message and show their default
    event.preventDefault();
    event.returnValue = '';
  }, [onBeforeClose, performCleanup]);

  /**
   * Handle page unload event.
   */
  const handleUnload = useCallback(() => {
    console.log('[AppLifecycle] unload triggered');
    performCleanup();
  }, [performCleanup]);

  /**
   * Handle visibility change (tab hidden/shown, app backgrounded).
   */
  const handleVisibilityChange = useCallback(() => {
    const isVisible = document.visibilityState === 'visible';
    console.log(`[AppLifecycle] Visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
    
    onVisibilityChange?.(isVisible);

    if (!isVisible) {
      wasHiddenRef.current = true;
      scheduleBackgroundBurn();
      console.log(
        `[AppLifecycle] App backgrounded — keys will burn in ${BACKGROUND_BURN_THRESHOLD_MS}ms unless restored`,
      );
    } else {
      cancelBackgroundBurnTimer();

      // Reset cleanup flag when app becomes visible again (unless full unload cleanup ran)
      if (!backgroundBurnPerformedRef.current) {
        cleanupPerformedRef.current = false;
      }

      // Fire onVisibilityRestored only on an actual hidden → visible transition
      // (FIX-SYNC-3): avoids firing on initial mount and on spurious 'visible'
      // events (e.g. DevTools open) without a preceding 'hidden'.
      if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        try {
          onVisibilityRestoredRef.current?.();
        } catch (err) {
          console.warn('[AppLifecycle] onVisibilityRestored threw:', err);
        }
      }

      backgroundBurnPerformedRef.current = false;
    }
  }, [onVisibilityChange, scheduleBackgroundBurn, cancelBackgroundBurnTimer]);

  /**
   * Handle page hide event (more reliable on mobile).
   */
  const handlePageHide = useCallback((event: PageTransitionEvent) => {
    console.log(`[AppLifecycle] pagehide triggered, persisted: ${event.persisted}`);
    
    // If page is not being cached (persisted=false), perform cleanup
    if (!event.persisted) {
      performCleanup();
    }
  }, [performCleanup]);

  // Set up event listeners
  useEffect(() => {
    // Add all lifecycle event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    console.log('[AppLifecycle] Lifecycle handlers registered');

    return () => {
      cancelBackgroundBurnTimer();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [
    handleBeforeUnload,
    handleUnload,
    handleVisibilityChange,
    handlePageHide,
    cancelBackgroundBurnTimer,
  ]);

  // Cleanup on unmount (for React HMR or route changes)
  useEffect(() => {
    return () => {
      cancelBackgroundBurnTimer();
      // Note: This cleanup is for development/HMR scenarios
      // Production cleanup is handled by beforeunload/pagehide
    };
  }, [cancelBackgroundBurnTimer]);
}

export { BACKGROUND_BURN_THRESHOLD_MS };
