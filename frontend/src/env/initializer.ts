import WebApp from '@twa-dev/sdk';
import { getEnvironment } from './detector';

export function initializeAppEnvironment(): void {
  const environment = getEnvironment();
  document.documentElement.dataset.environment = environment;

  if (environment === 'telegram') {
    try {
      WebApp.ready();
    } catch (error) {
      console.warn('[Env] Telegram init failed:', error);
    }
    return;
  }

  document.documentElement.classList.add('standalone-mode');

  // Placeholder hook for future standalone runtime features.
  if ('serviceWorker' in navigator) {
    // Intentionally left as no-op until standalone SW card is implemented.
  }
}
