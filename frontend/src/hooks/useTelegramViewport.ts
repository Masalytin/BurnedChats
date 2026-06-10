import { useEffect } from 'react';
import WebApp from '@twa-dev/sdk';
import { isTelegramMiniApp } from '../env/detector';

function applyAppHeight(height: number): void {
  document.documentElement.style.setProperty('--app-height', `${height}px`);
}

type WebAppWithViewportEvents = typeof WebApp & {
  onEvent?: (eventType: string, callback: () => void) => void;
  offEvent?: (eventType: string, callback: () => void) => void;
};

/**
 * Keeps `--app-height` in sync with Telegram's stable viewport height.
 * Outside Telegram this hook is a no-op (CSS fallback `100dvh` applies).
 */
export function useTelegramViewport(): void {
  useEffect(() => {
    if (!isTelegramMiniApp()) {
      return;
    }

    const sync = () => {
      const height = WebApp.viewportStableHeight;
      if (height > 0) {
        applyAppHeight(height);
      }
    };

    sync();

    const webApp = WebApp as WebAppWithViewportEvents;
    webApp.onEvent?.('viewportChanged', sync);

    return () => {
      webApp.offEvent?.('viewportChanged', sync);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
}
