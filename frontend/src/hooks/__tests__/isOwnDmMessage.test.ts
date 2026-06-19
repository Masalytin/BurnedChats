import { describe, expect, it } from 'vitest';
import { isOwnDmMessage } from '@/hooks/dmMessageOwnership';

describe('isOwnDmMessage', () => {
  const walletCtx = { userInternalId: 'wallet-uuid-1', userTelegramId: undefined };
  const tgCtx = { userInternalId: 'tg-internal-1', userTelegramId: 12345 };

  it('returns true for wallet user when senderInternalId matches', () => {
    expect(isOwnDmMessage(walletCtx, 'wallet-uuid-1', null)).toBe(true);
  });

  it('returns false for wallet user when senderInternalId differs', () => {
    expect(isOwnDmMessage(walletCtx, 'other-uuid', null)).toBe(false);
  });

  it('does not false-match null telegram ids', () => {
    expect(isOwnDmMessage(walletCtx, null, 0)).toBe(false);
    expect(isOwnDmMessage({ userInternalId: 'w', userTelegramId: 0 }, null, 0)).toBe(false);
  });

  it('falls back to telegram id for legacy messages', () => {
    expect(isOwnDmMessage(tgCtx, null, 12345)).toBe(true);
    expect(isOwnDmMessage(tgCtx, null, 99999)).toBe(false);
  });
});
