import { describe, expect, it } from 'vitest';
import {
  parseLtChallengeStartParam,
  shouldDeferWebsocketForTelegramLink,
} from '../telegramStartParam';

const CHALLENGE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('parseLtChallengeStartParam', () => {
  it('returns the 32-hex challenge from lt_ start_param', () => {
    expect(parseLtChallengeStartParam(`lt_${CHALLENGE}`)).toBe(CHALLENGE);
  });

  it('rejects missing, short, or non-hex challenges', () => {
    expect(parseLtChallengeStartParam(undefined)).toBeNull();
    expect(parseLtChallengeStartParam('lt_')).toBeNull();
    expect(parseLtChallengeStartParam('lt_not-hex')).toBeNull();
    expect(parseLtChallengeStartParam('invite_abc')).toBeNull();
  });
});

describe('shouldDeferWebsocketForTelegramLink', () => {
  it('defers WS while an lt_ complete has not settled', () => {
    expect(shouldDeferWebsocketForTelegramLink(`lt_${CHALLENGE}`, false)).toBe(true);
  });

  it('does not defer after the complete attempt settles or without lt_', () => {
    expect(shouldDeferWebsocketForTelegramLink(`lt_${CHALLENGE}`, true)).toBe(false);
    expect(shouldDeferWebsocketForTelegramLink('room_abc', false)).toBe(false);
    expect(shouldDeferWebsocketForTelegramLink(undefined, false)).toBe(false);
  });
});
