// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTelegramDmInviteDeepLink,
  buildTelegramInviteDeepLink,
  buildTelegramShareUrl,
  classifyScannedInvite,
  clearPendingInviteToken,
  parseDmInviteFragment,
  parseDmInviteUrl,
  parseInviteFragment,
  parseInviteUrl,
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

describe('parseInviteUrl', () => {
  it('parses web join fragment URL', () => {
    expect(parseInviteUrl('https://app.burnedchats.dev/join#invite_abc')).toBe('abc');
    expect(parseInviteUrl('https://example.com/join#invite_tok99')).toBe('tok99');
  });

  it('parses t.me startapp deep link', () => {
    expect(parseInviteUrl('https://t.me/BurnedChatsBot/app?startapp=invite_abc')).toBe('abc');
    expect(parseInviteUrl('t.me/Bot/app?startapp=invite_xyz')).toBe('xyz');
  });

  it('parses bare invite_ token / fragment', () => {
    expect(parseInviteUrl('invite_bare')).toBe('bare');
    expect(parseInviteUrl('#invite_bare')).toBe('bare');
  });

  it('returns null for non-invite text', () => {
    expect(parseInviteUrl('')).toBeNull();
    expect(parseInviteUrl('https://example.com/other')).toBeNull();
    expect(parseInviteUrl('https://t.me/Bot/app?startapp=dm_123')).toBeNull();
    expect(parseInviteUrl('not a qr')).toBeNull();
  });

  it('does not treat dm_invite_ as a room invite', () => {
    expect(parseInviteUrl('dm_invite_abc')).toBeNull();
    expect(parseInviteUrl('#dm_invite_abc')).toBeNull();
    expect(parseInviteUrl('https://t.me/Bot/app?startapp=dm_invite_abc')).toBeNull();
    expect(parseInviteFragment('#dm_invite_abc')).toBeNull();
  });
});

describe('parseDmInviteFragment', () => {
  it('returns token from #dm_invite_{token} hash', () => {
    expect(parseDmInviteFragment('#dm_invite_abc123')).toBe('abc123');
  });

  it('returns token when hash is passed without leading #', () => {
    expect(parseDmInviteFragment('dm_invite_deadbeef')).toBe('deadbeef');
  });

  it('returns null for empty or wrong prefix', () => {
    expect(parseDmInviteFragment('')).toBeNull();
    expect(parseDmInviteFragment('#')).toBeNull();
    expect(parseDmInviteFragment('#dm_invite_')).toBeNull();
    expect(parseDmInviteFragment('#invite_abc')).toBeNull();
    expect(parseDmInviteFragment('#dm_session-1')).toBeNull();
  });
});

describe('parseDmInviteUrl', () => {
  it('parses web hash and t.me startapp deep links', () => {
    expect(parseDmInviteUrl('https://app.burnedchats.dev/#dm_invite_tok')).toBe('tok');
    expect(parseDmInviteUrl('https://t.me/BurnedChatsBot/app?startapp=dm_invite_tok')).toBe('tok');
    expect(parseDmInviteUrl('t.me/Bot/app?startapp=dm_invite_xyz')).toBe('xyz');
  });

  it('parses bare dm_invite_ token / fragment', () => {
    expect(parseDmInviteUrl('dm_invite_bare')).toBe('bare');
    expect(parseDmInviteUrl('#dm_invite_bare')).toBe('bare');
  });

  it('does not collide with room invite_ or dm_{sessionId}', () => {
    expect(parseDmInviteUrl('invite_abc')).toBeNull();
    expect(parseDmInviteUrl('#invite_abc')).toBeNull();
    expect(parseDmInviteUrl('dm_session-abc')).toBeNull();
    expect(parseDmInviteUrl('https://t.me/Bot/app?startapp=dm_session-abc')).toBeNull();
    expect(parseDmInviteUrl('https://t.me/Bot/app?startapp=invite_abc')).toBeNull();
  });
});

describe('classifyScannedInvite', () => {
  it('classifies personal DM invite deep links as dm', () => {
    expect(classifyScannedInvite('https://t.me/Bot/app?startapp=dm_invite_tok99')).toEqual({
      kind: 'dm',
      token: 'tok99',
    });
    expect(classifyScannedInvite('#dm_invite_abc')).toEqual({ kind: 'dm', token: 'abc' });
    expect(classifyScannedInvite('dm_invite_bare')).toEqual({ kind: 'dm', token: 'bare' });
  });

  it('classifies room invite QR as room (never dm)', () => {
    expect(classifyScannedInvite('https://t.me/Bot/app?startapp=invite_room1')).toEqual({
      kind: 'room',
      token: 'room1',
    });
    expect(classifyScannedInvite('#invite_room1')).toEqual({ kind: 'room', token: 'room1' });
  });

  it('rejects invalid / session deep links', () => {
    expect(classifyScannedInvite('')).toEqual({ kind: 'invalid', token: null });
    expect(classifyScannedInvite('not a qr')).toEqual({ kind: 'invalid', token: null });
    expect(classifyScannedInvite('dm_session-abc')).toEqual({ kind: 'invalid', token: null });
    expect(classifyScannedInvite('https://t.me/Bot/app?startapp=dm_session-abc')).toEqual({
      kind: 'invalid',
      token: null,
    });
  });
});

describe('buildTelegramDmInviteDeepLink', () => {
  it('builds startapp deep link with dm_invite_ prefix', () => {
    expect(buildTelegramDmInviteDeepLink('tok99')).toBe(
      'https://t.me/BurnedChatsBot/app?startapp=dm_invite_tok99',
    );
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
