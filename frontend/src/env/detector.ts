export type AppEnvironment = 'telegram' | 'browser';

export function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const webApp = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
  return Boolean(webApp?.initData && webApp.initData.length > 0);
}

export function isBrowser(): boolean {
  return !isTelegramMiniApp();
}

export function getEnvironment(): AppEnvironment {
  return isTelegramMiniApp() ? 'telegram' : 'browser';
}
