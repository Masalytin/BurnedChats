import { useEffect, useState, useCallback, useMemo } from 'react';
import WebApp from '@twa-dev/sdk';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramChat {
  id: number;
  type: 'group' | 'supergroup' | 'channel';
  title: string;
  username?: string;
  photo_url?: string;
}

interface UseTelegramReturn {
  /** WebApp SDK instance (null if not ready) */
  webApp: typeof WebApp | null;
  /** Authenticated Telegram user */
  user: TelegramUser | null;
  /** Raw initData string for server authentication */
  initData: string;
  /** Parsed initData (not validated - use for UI only) */
  initDataUnsafe: typeof WebApp.initDataUnsafe;
  /** Whether the SDK is initialized and ready */
  isReady: boolean;
  /** Whether running inside Telegram Mini App */
  isInTelegram: boolean;
  /** Current color scheme */
  colorScheme: 'light' | 'dark';
  /** Theme parameters from Telegram */
  themeParams: typeof WebApp.themeParams;
  /** Haptic feedback API */
  hapticFeedback: typeof WebApp.HapticFeedback;
  /** Platform (ios, android, web, etc.) */
  platform: string;
  /** Mini App version */
  version: string;
  /** Start parameter from deep link */
  startParam: string | undefined;
  /** Show native alert dialog */
  showAlert: (message: string) => void;
  /** Show native confirm dialog */
  showConfirm: (message: string) => Promise<boolean>;
  /** Show native popup with custom buttons */
  showPopup: (params: {
    title?: string;
    message: string;
    buttons?: Array<{
      id?: string;
      type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
      text?: string;
    }>;
  }) => Promise<string | null>;
  /** Close the Mini App */
  close: () => void;
  /** Expand to full height */
  expand: () => void;
  /** Enable/disable closing confirmation */
  setClosingConfirmation: (enabled: boolean) => void;
  /** Set header color */
  setHeaderColor: (color: 'bg_color' | 'secondary_bg_color' | string) => void;
  /** Set background color */
  setBackgroundColor: (color: string) => void;
  /** Open external link */
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  /** Open Telegram link (e.g., t.me/...) */
  openTelegramLink: (url: string) => void;
  /** Request write access permission */
  requestWriteAccess: () => Promise<boolean>;
  /** Request user's contact */
  requestContact: () => Promise<boolean>;
  /** Trigger impact haptic feedback */
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  /** Trigger notification haptic feedback */
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  /** Trigger selection change haptic feedback */
  selectionChanged: () => void;
}

/**
 * Hook for Telegram Mini App SDK integration.
 * 
 * Provides access to all Mini App features including:
 * - User authentication data (initData)
 * - Theme and color scheme
 * - Haptic feedback
 * - Native dialogs
 * - Deep linking
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, initData, isReady, isInTelegram, impactOccurred } = useTelegram();
 *   
 *   if (!isReady) return <Loading />;
 *   
 *   const handleClick = () => {
 *     impactOccurred('medium');
 *     // ... handle click
 *   };
 *   
 *   return <div>Hello, {user?.first_name}!</div>;
 * }
 * ```
 */
export function useTelegram(): UseTelegramReturn {
  const [isReady, setIsReady] = useState(false);

  // Check if running inside Telegram
  const isInTelegram = useMemo(() => {
    return Boolean(WebApp.initData && WebApp.initData.length > 0);
  }, []);

  useEffect(() => {
    // Initialize the Mini App
    try {
      // Signal to Telegram that the app is ready
      WebApp.ready();

      // Log initialization info in development
      if (import.meta.env.DEV) {
        console.log('[Telegram] Mini App initialized:', {
          platform: WebApp.platform,
          version: WebApp.version,
          colorScheme: WebApp.colorScheme,
          isInTelegram,
          initDataLength: WebApp.initData?.length || 0,
          user: WebApp.initDataUnsafe?.user?.id,
        });
      }

      setIsReady(true);
    } catch (error) {
      console.error('[Telegram] Failed to initialize WebApp:', error);
      // For development outside Telegram, still set ready
      setIsReady(true);
    }
  }, [isInTelegram]);

  // Native dialogs
  const showAlert = useCallback((message: string) => {
    if (isInTelegram) {
      WebApp.showAlert(message);
    } else {
      window.alert(message);
    }
  }, [isInTelegram]);

  const showConfirm = useCallback((message: string): Promise<boolean> => {
    if (isInTelegram) {
      return new Promise((resolve) => {
        WebApp.showConfirm(message, (confirmed) => {
          resolve(confirmed);
        });
      });
    }
    return Promise.resolve(window.confirm(message));
  }, [isInTelegram]);

  const showPopup = useCallback((params: {
    title?: string;
    message: string;
    buttons?: Array<{
      id?: string;
      type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
      text?: string;
    }>;
  }): Promise<string | null> => {
    if (isInTelegram) {
      return new Promise((resolve) => {
        // Cast to any to handle strict SDK types - our interface is more flexible
        WebApp.showPopup(params as Parameters<typeof WebApp.showPopup>[0], (buttonId) => {
          resolve(buttonId || null);
        });
      });
    }
    // Fallback for non-Telegram environment
    const result = window.confirm(`${params.title || ''}\n${params.message}`);
    return Promise.resolve(result ? 'ok' : null);
  }, [isInTelegram]);

  // App lifecycle
  const close = useCallback(() => {
    WebApp.close();
  }, []);

  const expand = useCallback(() => {
    WebApp.expand();
  }, []);

  const setClosingConfirmation = useCallback((enabled: boolean) => {
    if (enabled) {
      WebApp.enableClosingConfirmation();
    } else {
      WebApp.disableClosingConfirmation();
    }
  }, []);

  // Appearance
  const setHeaderColor = useCallback((color: 'bg_color' | 'secondary_bg_color' | string) => {
    WebApp.setHeaderColor(color as 'bg_color' | 'secondary_bg_color');
  }, []);

  const setBackgroundColor = useCallback((color: string) => {
    WebApp.setBackgroundColor(color as `#${string}`);
  }, []);

  // Links
  const openLink = useCallback((url: string, options?: { try_instant_view?: boolean }) => {
    WebApp.openLink(url, options ? { try_instant_view: options.try_instant_view ?? false } : undefined);
  }, []);

  const openTelegramLink = useCallback((url: string) => {
    WebApp.openTelegramLink(url);
  }, []);

  // Permissions
  const requestWriteAccess = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      WebApp.requestWriteAccess((granted) => {
        resolve(granted);
      });
    });
  }, []);

  const requestContact = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      WebApp.requestContact((granted) => {
        resolve(granted);
      });
    });
  }, []);

  // Haptic feedback shortcuts
  const impactOccurred = useCallback((style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => {
    if (isInTelegram) {
      WebApp.HapticFeedback.impactOccurred(style);
    }
  }, [isInTelegram]);

  const notificationOccurred = useCallback((type: 'error' | 'success' | 'warning') => {
    if (isInTelegram) {
      WebApp.HapticFeedback.notificationOccurred(type);
    }
  }, [isInTelegram]);

  const selectionChanged = useCallback(() => {
    if (isInTelegram) {
      WebApp.HapticFeedback.selectionChanged();
    }
  }, [isInTelegram]);

  return {
    webApp: isReady ? WebApp : null,
    user: WebApp.initDataUnsafe?.user as TelegramUser | null,
    initData: WebApp.initData,
    initDataUnsafe: WebApp.initDataUnsafe,
    isReady,
    isInTelegram,
    colorScheme: WebApp.colorScheme,
    themeParams: WebApp.themeParams,
    hapticFeedback: WebApp.HapticFeedback,
    platform: WebApp.platform,
    version: WebApp.version,
    startParam: WebApp.initDataUnsafe?.start_param,
    showAlert,
    showConfirm,
    showPopup,
    close,
    expand,
    setClosingConfirmation,
    setHeaderColor,
    setBackgroundColor,
    openLink,
    openTelegramLink,
    requestWriteAccess,
    requestContact,
    impactOccurred,
    notificationOccurred,
    selectionChanged,
  };
}


