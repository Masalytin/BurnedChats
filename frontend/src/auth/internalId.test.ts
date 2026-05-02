import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { telegramInternalId } from './internalId';

function javaNameUuidFromBytes(input: string): string {
  const hash = createHash('md5').update(input, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('telegramInternalId', () => {
  it('matches Java UUID.nameUUIDFromBytes semantics', () => {
    const ids = [1, 42, 123456789, '9876543210'];
    ids.forEach((id) => {
      const name = `burnedchats:telegram:${id}`;
      expect(telegramInternalId(id)).toBe(javaNameUuidFromBytes(name));
    });
  });
});
