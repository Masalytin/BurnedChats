import { describe, expect, it } from 'vitest';
import {
  parseDmInviteStartParam,
  parseDmStartParam,
  parseRoomStartParam,
  resolveDmDeepLink,
  resolveRoomDeepLink,
} from '../telegramStartParam';

describe('parseDmStartParam', () => {
  it('extracts sessionId from dm_ prefix', () => {
    expect(parseDmStartParam('dm_session-abc')).toBe('session-abc');
  });

  it('returns null for empty id or wrong prefix', () => {
    expect(parseDmStartParam('dm_')).toBeNull();
    expect(parseDmStartParam('invite_x')).toBeNull();
    expect(parseDmStartParam(null)).toBeNull();
  });

  it('does not treat dm_invite_ as a session deep link', () => {
    expect(parseDmStartParam('dm_invite_abc123')).toBeNull();
    expect(parseDmStartParam('dm_invite_')).toBeNull();
  });
});

describe('parseDmInviteStartParam', () => {
  it('extracts token from dm_invite_ prefix', () => {
    expect(parseDmInviteStartParam('dm_invite_tok99')).toBe('tok99');
  });

  it('returns null for empty token or wrong prefix', () => {
    expect(parseDmInviteStartParam('dm_invite_')).toBeNull();
    expect(parseDmInviteStartParam('dm_session-1')).toBeNull();
    expect(parseDmInviteStartParam('invite_x')).toBeNull();
    expect(parseDmInviteStartParam(null)).toBeNull();
  });
});

describe('parseRoomStartParam', () => {
  it('extracts roomId from room_ prefix', () => {
    expect(parseRoomStartParam('room_room-1')).toBe('room-1');
  });

  it('returns null for empty id or wrong prefix', () => {
    expect(parseRoomStartParam('room_')).toBeNull();
    expect(parseRoomStartParam('dm_x')).toBeNull();
  });
});

describe('resolveDmDeepLink', () => {
  it('targets incoming request when session is a pending request', () => {
    expect(resolveDmDeepLink('s1', ['active-other'], ['s1'])).toEqual({
      kind: 'incoming',
      sessionId: 's1',
    });
  });

  it('targets resume when session is an active session', () => {
    expect(resolveDmDeepLink('s1', ['s1'], [])).toEqual({
      kind: 'resume',
      sessionId: 's1',
    });
  });

  it('misses silently when session is unknown', () => {
    expect(resolveDmDeepLink('gone', ['s1'], ['s2'])).toEqual({ kind: 'miss' });
  });

  it('prefers incoming over active when both contain the id', () => {
    expect(resolveDmDeepLink('s1', ['s1'], ['s1'])).toEqual({
      kind: 'incoming',
      sessionId: 's1',
    });
  });
});

describe('resolveRoomDeepLink', () => {
  it('opens room for a member', () => {
    expect(resolveRoomDeepLink('r1', ['r1', 'r2'])).toEqual({ kind: 'open', roomId: 'r1' });
  });

  it('ignores room for a non-member', () => {
    expect(resolveRoomDeepLink('r9', ['r1'])).toEqual({ kind: 'ignore' });
  });
});
