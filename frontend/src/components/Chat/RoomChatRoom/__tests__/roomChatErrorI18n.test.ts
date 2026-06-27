import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import uk from '@/i18n/locales/uk.json';

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
