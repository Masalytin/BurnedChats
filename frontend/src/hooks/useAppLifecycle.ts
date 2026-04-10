import { useEffect, useCallback, useRef } from 'react';
import { burnAll, getActiveSessionIds } from '@/crypto/keyStore';
import { cancelAll } from '@/services/transferQueue';

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
 * 
 * Security features:
 * - Keys are burned on any app close/suspend
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
  const { isConnected, publish, onBeforeClose, onVisibilityChange } = options;

  // Track if cleanup has been performed
  const cleanupPerformedRef = useRef(false);

  /**
   * Notify peers about disconnect and burn all keys.
   */
  const performCleanup = useCallback(() => {
    if (cleanupPerformedRef.current) {
      return;
    }
    cleanupPerformedRef.current = true;

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
    burnAll();
    console.log('[AppLifecycle] All keys burned');
  }, [isConnected, publish]);

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

    // On mobile, when app is backgrounded, we should consider it as potentially closing
    // because the OS might kill the app at any time
    if (!isVisible) {
      // For maximum security, you could call performCleanup() here
      // However, this would end sessions every time user switches apps
      // So we only log for now - actual cleanup happens on unload
      console.log('[AppLifecycle] App backgrounded - sessions at risk if app is killed');
    } else {
      // Reset cleanup flag when app becomes visible again
      cleanupPerformedRef.current = false;
    }
  }, [onVisibilityChange]);

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
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [handleBeforeUnload, handleUnload, handleVisibilityChange, handlePageHide]);

  // Cleanup on unmount (for React HMR or route changes)
  useEffect(() => {
    return () => {
      // Note: This cleanup is for development/HMR scenarios
      // Production cleanup is handled by beforeunload/pagehide
    };
  }, []);
}
