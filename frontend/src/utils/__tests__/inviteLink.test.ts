// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTelegramInviteDeepLink,
  buildTelegramShareUrl,
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

describe('buildTelegramShareUrl', () => {
  it('builds t.me/share/url with encoded invite url and text', () => {
    const inviteUrl = 'https://t.me/BurnedChatsBot/app?startapp=invite_abc';
    const text = 'Join my room';
    expect(buildTelegramShareUrl(inviteUrl, text)).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`,
    );
  });

  it('encodes special characters in url and text', () => {
    const inviteUrl = 'https://t.me/Bot/app?startapp=invite_a&b=1#frag';
    const text = 'Room: Café & «Friends» — 100%';
    const result = buildTelegramShareUrl(inviteUrl, text);
    expect(result).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`,
    );
    expect(result).toContain(encodeURIComponent('&'));
    expect(result).toContain(encodeURIComponent('«'));
    expect(result).toContain(encodeURIComponent('%'));
  });

  it('uses empty text when text is omitted', () => {
    const inviteUrl = 'https://t.me/BurnedChatsBot/app?startapp=invite_x';
    expect(buildTelegramShareUrl(inviteUrl)).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=`,
    );
  });

  it('uses empty text when text is empty string', () => {
    const inviteUrl = 'https://example.com/invite';
    expect(buildTelegramShareUrl(inviteUrl, '')).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=`,
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
