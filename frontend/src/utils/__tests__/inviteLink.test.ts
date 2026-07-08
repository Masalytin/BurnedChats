// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTelegramInviteDeepLink,
  clearPendingInviteToken,
  parseInviteFragment,
  PENDING_INVITE_TOKEN_KEY,
  readPendingInviteToken,
  stashPendingInviteToken,
} from '../inviteLink';

describe('parseInviteFragment', () => {
  it('returns token from #invite_{token} hash', () => {
    expect(parseInviteFragment('#invite_abc123')).toBe('abc123');
  });

  it('returns token when hash is passed without leading #', () => {
    expect(parseInviteFragment('invite_deadbeef')).toBe('deadbeef');
  });

  it('returns null for empty hash', () => {
    expect(parseInviteFragment('')).toBeNull();
    expect(parseInviteFragment('#')).toBeNull();
  });

  it('returns null for wrong prefix', () => {
    expect(parseInviteFragment('#join_abc')).toBeNull();
    expect(parseInviteFragment('#invite_')).toBeNull();
  });
});

describe('buildTelegramInviteDeepLink', () => {
  it('builds startapp deep link from token', () => {
    expect(buildTelegramInviteDeepLink('tok99')).toBe(
      'https://t.me/BurnedChatsBot/app?startapp=invite_tok99'
    );
  });
});

describe('pending invite token sessionStorage', () => {
  afterEach(() => {
    clearPendingInviteToken();
  });

  it('stashes and reads token', () => {
    stashPendingInviteToken('stored-token');
    expect(readPendingInviteToken()).toBe('stored-token');
    expect(sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY)).toBe('stored-token');
  });

  it('clears stashed token', () => {
    stashPendingInviteToken('x');
    clearPendingInviteToken();
    expect(readPendingInviteToken()).toBeNull();
  });
});
