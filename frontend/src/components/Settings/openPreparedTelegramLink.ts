import type { AppEnvironment } from '../../env/detector';

/**
 * Web must open t.me in a new tab. {@code WebApp.openTelegramLink} exists on
 * the SDK outside TMA and navigates the current window, killing the web app.
 */
export function openPreparedTelegramLink(
  link: string,
  environment: AppEnvironment,
  openInTelegram: (url: string) => void,
  openBlank: (url: string) => void,
): void {
  if (!link) {
    return;
  }
  if (environment === 'telegram') {
    openInTelegram(link);
    return;
  }
  openBlank(link);
}
