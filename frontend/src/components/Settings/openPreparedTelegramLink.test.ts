import { describe, expect, it, vi } from 'vitest';
import { openPreparedTelegramLink } from './openPreparedTelegramLink';

describe('openPreparedTelegramLink', () => {
  it('uses WebApp.openTelegramLink only inside Telegram Mini App', () => {
    const openInTelegram = vi.fn();
    const openBlank = vi.fn();
    openPreparedTelegramLink('https://t.me/bot/app?startapp=lt_aa', 'telegram', openInTelegram, openBlank);
    expect(openInTelegram).toHaveBeenCalledWith('https://t.me/bot/app?startapp=lt_aa');
    expect(openBlank).not.toHaveBeenCalled();
  });

  it('opens a new tab on web and never calls openTelegramLink', () => {
    const openInTelegram = vi.fn();
    const openBlank = vi.fn();
    openPreparedTelegramLink('https://t.me/bot/app?startapp=lt_aa', 'browser', openInTelegram, openBlank);
    expect(openBlank).toHaveBeenCalledWith('https://t.me/bot/app?startapp=lt_aa');
    expect(openInTelegram).not.toHaveBeenCalled();
  });
});
