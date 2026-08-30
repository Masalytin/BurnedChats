import { useState, useCallback, useEffect, useMemo } from 'react';
import WebApp from '@twa-dev/sdk';
import { isTelegramMiniApp } from '../env/detector';
import { areHapticsEnabled } from '../preferences/preferencesStorage';

type WebAppWithThemeEvents = typeof WebApp & {
  onEvent?: (eventType: string, callback: () => void) => void;
  offEvent?: (eventType: string, callback: () => void) => void;
};

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

/** Bot API 8.0+ home-screen shortcut status from `checkHomeScreenStatus`. */
export type HomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed';

type WebAppWithHomeScreen = typeof WebApp & {
  addToHomeScreen?: () => void;
  checkHomeScreenStatus?: (callback?: (status: HomeScreenStatus) => void) => void;
};

/** Chat types for {@code WebApp.switchInlineQuery} (Bot API 6.7+). */
export type SwitchInlineChatType = 'users' | 'bots' | 'groups' | 'channels';

type WebAppWithSwitchInline = typeof WebApp & {
  switchInlineQuery?: (query: string, chooseChatTypes?: SwitchInlineChatType[]) => void;
};

interface UseTelegramReturn {
  /** WebApp SDK instance (null if not ready) */
  webApp: typeof WebApp | null;
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
  /**
   * Open Telegram QR scanner (Bot API 6.4+).
   * Resolves scanned text, or null when unsupported / unavailable.
   */
  showScanQrPopup: (text?: string) => Promise<string | null>;
  /** Close the Telegram QR scanner popup if open */
  closeScanQrPopup: () => void;
  /** True when running in Telegram with QR scan API (≥ 6.4) */
  canScanQr: boolean;
  /** Close the Mini App */
  close: () => void;
  /** Expand to full height */
  expand: () => void;
  /** Enable/disable closing confirmation */
  setClosingConfirmation: (enabled: boolean) => void;
  /** Set header color */
  setHeaderColor: (color: 'bg_color' | 'secondary_bg_color' | string) => void;
  /** Set native Telegram bottom bar color (Bot API 7.10+) */
  setBottomBarColor: (color: 'bg_color' | 'secondary_bg_color' | string) => void;
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
  /**
   * Prompt to add Mini App shortcut to the device home screen (Bot API 8.0+).
   * No-op when unsupported or outside Telegram.
   */
  addToHomeScreen: () => void;
  /**
   * Home-screen shortcut status (Bot API 8.0+).
   * Returns `'unsupported'` when the API / version is unavailable.
   */
  checkHomeScreenStatus: () => Promise<HomeScreenStatus>;
  /**
   * Open Telegram chat picker and insert an inline query (Bot API 6.7+ with chat types).
   * No-op when unsupported or outside Telegram.
   */
  switchInlineQuery: (query: string, chatTypes?: SwitchInlineChatType[]) => void;
  /** True when running in Telegram with switchInlineQuery + choose_chat_types (≥ 6.7) */
  canSwitchInlineQuery: boolean;
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
 * Provides access to Mini App UI features:
 * - Theme and color scheme
 * - Haptic feedback
 * - Native dialogs
 * - Deep linking
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isReady, isInTelegram, impactOccurred } = useTelegram();
 *   
 *   if (!isReady) return <Loading />;
 *   
 *   const handleClick = () => {
 *     impactOccurred('medium');
 *     // ... handle click
 *   };
 *   
 *   return <button onClick={() => impactOccurred('medium')}>Tap</button>;
 * }
 * ```
 */
export function useTelegram(): UseTelegramReturn {
  const [isReady] = useState(true);
  const [themeParams, setThemeParams] = useState(() => ({ ...WebApp.themeParams }));

  // Check if running inside Telegram
  const isInTelegram = useMemo(() => {
    return isTelegramMiniApp();
  }, []);

  useEffect(() => {
    const webApp = WebApp as WebAppWithThemeEvents;
    const sync = () => {
      setThemeParams({ ...webApp.themeParams });
    };
    webApp.onEvent?.('themeChanged', sync);
    return () => {
      webApp.offEvent?.('themeChanged', sync);
    };
  }, []);

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

  type WebAppWithScanQr = typeof WebApp & {
    showScanQrPopup?: (
      params: { text?: string },
      callback?: (text: string) => boolean | void,
    ) => void;
    closeScanQrPopup?: () => void;
  };

  const canScanQr = useMemo(() => {
    if (!isInTelegram) {
      return false;
    }
    try {
      return WebApp.isVersionAtLeast('6.4');
    } catch {
      return false;
    }
  }, [isInTelegram]);

  const showScanQrPopup = useCallback((text?: string): Promise<string | null> => {
    if (!canScanQr) {
      return Promise.resolve(null);
    }
    const webApp = WebApp as WebAppWithScanQr;
    if (typeof webApp.showScanQrPopup !== 'function') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        webApp.showScanQrPopup(
          { text: text ?? '' },
          (scanned) => {
            settle(scanned && scanned.length > 0 ? scanned : null);
            return true; // close scanner after first result
          },
        );
      } catch {
        settle(null);
      }
    });
  }, [canScanQr]);

  const closeScanQrPopup = useCallback(() => {
    if (!canScanQr) {
      return;
    }
    const webApp = WebApp as WebAppWithScanQr;
    try {
      webApp.closeScanQrPopup?.();
    } catch {
      // ignore — popup may already be closed
    }
  }, [canScanQr]);

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

  const setBottomBarColor = useCallback((color: 'bg_color' | 'secondary_bg_color' | string) => {
    if (!isInTelegram || !WebApp.isVersionAtLeast('7.10')) {
      return;
    }

    // @twa-dev/sdk may not type setBottomBarColor yet (Bot API 7.10+)
    const webAppWithBottomBar = WebApp as typeof WebApp & {
      setBottomBarColor?: (value: 'bg_color' | 'secondary_bg_color' | string) => void;
    };
    webAppWithBottomBar.setBottomBarColor?.(color);
  }, [isInTelegram]);

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
      try {
        WebApp.requestWriteAccess((granted) => {
          resolve(Boolean(granted));
        });
      } catch {
        resolve(false);
      }
    });
  }, []);

  const requestContact = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      WebApp.requestContact((granted) => {
        resolve(granted);
      });
    });
  }, []);

  // Home screen shortcuts (Bot API 8.0+)
  const addToHomeScreen = useCallback(() => {
    if (!isInTelegram) {
      return;
    }
    try {
      if (!WebApp.isVersionAtLeast('8.0')) {
        return;
      }
    } catch {
      return;
    }
    const webApp = WebApp as WebAppWithHomeScreen;
    if (typeof webApp.addToHomeScreen !== 'function') {
      return;
    }
    try {
      webApp.addToHomeScreen();
    } catch {
      // ignore — client may reject the call
    }
  }, [isInTelegram]);

  const checkHomeScreenStatus = useCallback((): Promise<HomeScreenStatus> => {
    if (!isInTelegram) {
      return Promise.resolve('unsupported');
    }
    try {
      if (!WebApp.isVersionAtLeast('8.0')) {
        return Promise.resolve('unsupported');
      }
    } catch {
      return Promise.resolve('unsupported');
    }
    const webApp = WebApp as WebAppWithHomeScreen;
    if (typeof webApp.checkHomeScreenStatus !== 'function') {
      return Promise.resolve('unsupported');
    }
    return new Promise((resolve) => {
      try {
        webApp.checkHomeScreenStatus!((status) => {
          if (
            status === 'unsupported' ||
            status === 'unknown' ||
            status === 'added' ||
            status === 'missed'
          ) {
            resolve(status);
            return;
          }
          resolve('unsupported');
        });
      } catch {
        resolve('unsupported');
      }
    });
  }, [isInTelegram]);

  // Inline query share (Bot API 6.7+ choose_chat_types) — IMP-TGUX-06
  const canSwitchInlineQuery = useMemo(() => {
    if (!isInTelegram) {
      return false;
    }
    try {
      if (!WebApp.isVersionAtLeast('6.7')) {
        return false;
      }
    } catch {
      return false;
    }
    const webApp = WebApp as WebAppWithSwitchInline;
    return typeof webApp.switchInlineQuery === 'function';
  }, [isInTelegram]);

  const switchInlineQuery = useCallback(
    (query: string, chatTypes?: SwitchInlineChatType[]) => {
      if (!canSwitchInlineQuery) {
        return;
      }
      const webApp = WebApp as WebAppWithSwitchInline;
      if (typeof webApp.switchInlineQuery !== 'function') {
        return;
      }
      try {
        if (chatTypes && chatTypes.length > 0) {
          webApp.switchInlineQuery(query, chatTypes);
        } else {
          webApp.switchInlineQuery(query);
        }
      } catch {
        // ignore — client may reject the call
      }
    },
    [canSwitchInlineQuery],
  );

  // Haptic feedback shortcuts
  const impactOccurred = useCallback((style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => {
    if (isInTelegram && areHapticsEnabled()) {
      try {
        WebApp.HapticFeedback.impactOccurred(style);
      } catch {
        // Silently fail if haptics unavailable
      }
    }
  }, [isInTelegram]);

  const notificationOccurred = useCallback((type: 'error' | 'success' | 'warning') => {
    if (isInTelegram && areHapticsEnabled()) {
      try {
        WebApp.HapticFeedback.notificationOccurred(type);
      } catch {
        // Silently fail if haptics unavailable
      }
    }
  }, [isInTelegram]);

  const selectionChanged = useCallback(() => {
    if (isInTelegram && areHapticsEnabled()) {
      try {
        WebApp.HapticFeedback.selectionChanged();
      } catch {
        // Silently fail if haptics unavailable
      }
    }
  }, [isInTelegram]);

  return {
    webApp: isReady ? WebApp : null,
    isReady,
    isInTelegram,
    colorScheme: WebApp.colorScheme,
    themeParams,
    hapticFeedback: WebApp.HapticFeedback,
    platform: WebApp.platform,
    version: WebApp.version,
    startParam: WebApp.initDataUnsafe?.start_param,
    showAlert,
    showConfirm,
    showPopup,
    showScanQrPopup,
    closeScanQrPopup,
    canScanQr,
    close,
    expand,
    setClosingConfirmation,
    setHeaderColor,
    setBottomBarColor,
    setBackgroundColor,
    openLink,
    openTelegramLink,
    requestWriteAccess,
    requestContact,
    addToHomeScreen,
    checkHomeScreenStatus,
    switchInlineQuery,
    canSwitchInlineQuery,
    impactOccurred,
    notificationOccurred,
    selectionChanged,
  };
}


