import { useEffect, useCallback, useRef } from 'react';
import WebApp from '@twa-dev/sdk';

interface UseBackButtonOptions {
  /** Whether the back button should be visible */
  visible?: boolean;
  /** Callback when back button is pressed */
  onBack?: () => void;
}

interface UseBackButtonReturn {
  /** Show the back button */
  show: () => void;
  /** Hide the back button */
  hide: () => void;
  /** Set visibility */
  setVisible: (visible: boolean) => void;
}

/**
 * Hook for managing Telegram Mini App back button.
 * 
 * The back button appears in the header of the Mini App
 * and allows users to navigate back within the app.
 * 
 * @param options Configuration options
 * @param options.visible Whether to show the button (default: false)
 * @param options.onBack Callback when button is pressed
 * 
 * @example
 * ```tsx
 * function DetailPage({ onGoBack }: { onGoBack: () => void }) {
 *   // Show back button and handle press
 *   useBackButton({
 *     visible: true,
 *     onBack: onGoBack,
 *   });
 * 
 *   return <div>Detail content...</div>;
 * }
 * ```
 * 
 * @example
 * ```tsx
 * function ModalView({ onClose }: { onClose: () => void }) {
 *   const { show, hide } = useBackButton({
 *     onBack: onClose,
 *   });
 * 
 *   useEffect(() => {
 *     show();
 *     return () => hide();
 *   }, [show, hide]);
 * 
 *   return <div>Modal content...</div>;
 * }
 * ```
 */
export function useBackButton(options: UseBackButtonOptions = {}): UseBackButtonReturn {
  const { visible = false, onBack } = options;
  
  // Store callback in ref to avoid re-subscribing on every render
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  // Check if running in Telegram
  const isInTelegram = Boolean(WebApp.initData && WebApp.initData.length > 0);

  const show = useCallback(() => {
    if (isInTelegram) {
      try {
        WebApp.BackButton.show();
      } catch (e) {
        console.warn('[useBackButton] Failed to show back button:', e);
      }
    }
  }, [isInTelegram]);

  const hide = useCallback(() => {
    if (isInTelegram) {
      try {
        WebApp.BackButton.hide();
      } catch (e) {
        console.warn('[useBackButton] Failed to hide back button:', e);
      }
    }
  }, [isInTelegram]);

  const setVisible = useCallback((isVisible: boolean) => {
    if (isVisible) {
      show();
    } else {
      hide();
    }
  }, [show, hide]);

  // Handle visibility changes
  useEffect(() => {
    if (!isInTelegram) return;

    if (visible) {
      show();
    } else {
      hide();
    }

    return () => {
      // Hide on unmount if was visible
      if (visible) {
        hide();
      }
    };
  }, [visible, isInTelegram, show, hide]);

  // Handle back button click
  useEffect(() => {
    if (!isInTelegram) return;

    const handleClick = () => {
      if (onBackRef.current) {
        onBackRef.current();
      }
    };

    try {
      WebApp.BackButton.onClick(handleClick);
    } catch (e) {
      console.warn('[useBackButton] Failed to attach click handler:', e);
    }

    return () => {
      try {
        WebApp.BackButton.offClick(handleClick);
      } catch (e) {
        // Silently fail on cleanup
      }
    };
  }, [isInTelegram]);

  return {
    show,
    hide,
    setVisible,
  };
}

/**
 * Hook that automatically shows/hides back button based on navigation state.
 * 
 * @param canGoBack Whether there's a previous view to go back to
 * @param onBack Callback when back button is pressed
 * 
 * @example
 * ```tsx
 * function App() {
 *   const [view, setView] = useState('home');
 *   
 *   useAutoBackButton(
 *     view !== 'home',
 *     () => setView('home')
 *   );
 * 
 *   return view === 'home' ? <Home /> : <Detail />;
 * }
 * ```
 */
export function useAutoBackButton(canGoBack: boolean, onBack: () => void): void {
  useBackButton({
    visible: canGoBack,
    onBack,
  });
}
