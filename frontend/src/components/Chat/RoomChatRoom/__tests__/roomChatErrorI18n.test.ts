import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import uk from '@/i18n/locales/uk.json';
import de from '@/i18n/locales/de.json';
import fr from '@/i18n/locales/fr.json';
import es from '@/i18n/locales/es.json';
import ar from '@/i18n/locales/ar.json';
import zhCN from '@/i18n/locales/zh-CN.json';

describe('room.chat error i18n keys (IMP-RCDF-03)', () => {
  it('defines distinct decryptError and sendError strings in en and ru', () => {
    expect(en.room.chat.decryptError).toBe('Could not decrypt message');
    expect(en.room.chat.sendError).toBe('Failed to send message');
    expect(en.room.chat.decryptError).not.toBe(en.room.chat.sendError);

    expect(ru.room.chat.decryptError).toBe('Не удалось расшифровать сообщение');
    expect(ru.room.chat.sendError).toBe('Не удалось отправить сообщение');
    expect(ru.room.chat.decryptError).not.toBe(ru.room.chat.sendError);
  });
});

describe('room key recovery i18n keys (IMP-RKR-05 T8)', () => {
  const recoveryKeys = [
    'room.chat.keyLost',
    'room.chat.keyLostHint',
    'room.chat.ownerRekeying',
    'room.recovery.recoverButton',
    'room.list.keysBurnedBadge',
    'lifecycle.backgroundBurnMessage',
    'lifecycle.backgroundBurnTitle',
  ] as const;

  function resolve(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in acc) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  }

  it('uk locale resolves recovery keys without raw key paths', () => {
    for (const key of recoveryKeys) {
      const value = resolve(uk as unknown as Record<string, unknown>, key);
      expect(typeof value).toBe('string');
      expect(value).not.toMatch(/^room\.|^lifecycle\./);
      expect(String(value).length).toBeGreaterThan(0);
    }

    expect(uk.room.chat.keyLost).toBe('Ключ шифрування втрачено');
    expect(uk.room.list.keysBurnedBadge).toBe('Ключі видалено');
    expect(uk.lifecycle.backgroundBurnMessage).toContain('відновіть шифрування вручну');
    expect(uk.room.recovery.recoverButton).toBe('Відновити шифрування');
  });

  it('keyLost and ownerRekeying are distinct in uk (no misleading copy)', () => {
    expect(uk.room.chat.keyLost).not.toBe(uk.room.chat.ownerRekeying);
  });
});

describe('member key-lost honesty i18n (IMP-RCATCH-04)', () => {
  const locales = { en, ru, uk, de, fr, es, ar, 'zh-CN': zhCN } as const;
  const honestKeys = [
    'keysBurnedTitle',
    'keysBurnedHint',
    'historyLostHint',
    'ownerUnavailable',
  ] as const;

  it('defines distinct honest member-placeholder keys in all 8 locales', () => {
    for (const [locale, catalog] of Object.entries(locales)) {
      const chat = catalog.room.chat as unknown as Record<string, string>;
      for (const key of honestKeys) {
        expect(typeof chat[key], `${locale} ${key}`).toBe('string');
        expect(chat[key].length, `${locale} ${key}`).toBeGreaterThan(0);
        expect(chat[key], `${locale} ${key}`).not.toMatch(/^room\.chat\./);
      }
      expect(chat.keysBurnedHint, locale).not.toBe(chat.historyLostHint);
      expect(chat.ownerUnavailable, locale).not.toBe(chat.requestingKey);
      expect(chat.keysBurnedHint.toLowerCase(), locale).toMatch(/ram|оперативн|arbeitsspeicher|mémoire|memoria|ذاكرة|пам.ят|内存/);
    }
  });

  it('does not keep unused waitingForKey / ownerOfflineHint leftovers', () => {
    for (const [locale, catalog] of Object.entries(locales)) {
      const chat = catalog.room.chat as unknown as Record<string, unknown>;
      expect(chat.waitingForKey, locale).toBeUndefined();
      expect(chat.ownerOfflineHint, locale).toBeUndefined();
    }
  });
});
