import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';

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
