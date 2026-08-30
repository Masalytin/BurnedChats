/**
 * Telegram Mini App start_param helpers (IMP-TGUX-03 / IMP-DMINVITE-02).
 *
 * Formats (initDataUnsafe.start_param):
 *   invite_{token}     — room invite (handled elsewhere)
 *   dm_invite_{token}  — personal DM invite redeem
 *   lt_{challenge}     — wallet↔Telegram link (handled elsewhere)
 *   dm_{sessionId}     — open DM / incoming chat request
 *   room_{roomId}      — open room if member
 */

const DM_INVITE_PREFIX = 'dm_invite_';

export function parseDmInviteStartParam(startParam: string | null | undefined): string | null {
  if (!startParam?.startsWith(DM_INVITE_PREFIX)) return null;
  const token = startParam.slice(DM_INVITE_PREFIX.length);
  return token.length > 0 ? token : null;
}

export function parseDmStartParam(startParam: string | null | undefined): string | null {
  if (!startParam?.startsWith('dm_')) return null;
  // Personal DM invite uses dm_invite_ — must not be treated as dm_{sessionId}
  if (startParam.startsWith(DM_INVITE_PREFIX)) return null;
  const sessionId = startParam.slice('dm_'.length);
  return sessionId.length > 0 ? sessionId : null;
}

export function parseRoomStartParam(startParam: string | null | undefined): string | null {
  if (!startParam?.startsWith('room_')) return null;
  const roomId = startParam.slice('room_'.length);
  return roomId.length > 0 ? roomId : null;
}

const LT_PREFIX = 'lt_';
const LT_CHALLENGE = /^[a-fA-F0-9]{32}$/;

/** Wallet↔Telegram link challenge from start_param `lt_{32 hex}`. */
export function parseLtChallengeStartParam(startParam: string | null | undefined): string | null {
  if (!startParam?.startsWith(LT_PREFIX)) return null;
  const challengeId = startParam.slice(LT_PREFIX.length);
  return LT_CHALLENGE.test(challengeId) ? challengeId : null;
}

/**
 * Hold STOMP until Mini App `lt_` complete settles so handshake save() cannot
 * race/overwrite {@code auth_tg} during the link.
 */
export function shouldDeferWebsocketForTelegramLink(
  startParam: string | null | undefined,
  telegramLinkSettled: boolean,
): boolean {
  return parseLtChallengeStartParam(startParam) != null && !telegramLinkSettled;
}

export type DmDeepLinkTarget =
  | { kind: 'resume'; sessionId: string }
  | { kind: 'incoming'; sessionId: string }
  | { kind: 'miss' };

/**
 * Resolve dm_{sessionId} against currently known active sessions and incoming requests.
 * Missing / burned session → miss (stay on home, no error).
 */
export function resolveDmDeepLink(
  sessionId: string,
  activeSessionIds: ReadonlySet<string> | readonly string[],
  incomingRequestIds: ReadonlySet<string> | readonly string[],
): DmDeepLinkTarget {
  const active = activeSessionIds instanceof Set
    ? activeSessionIds
    : new Set(activeSessionIds);
  const incoming = incomingRequestIds instanceof Set
    ? incomingRequestIds
    : new Set(incomingRequestIds);

  if (incoming.has(sessionId)) {
    return { kind: 'incoming', sessionId };
  }
  if (active.has(sessionId)) {
    return { kind: 'resume', sessionId };
  }
  return { kind: 'miss' };
}

/**
 * Resolve room_{roomId}: open only when the user is a member.
 */
export function resolveRoomDeepLink(
  roomId: string,
  memberRoomIds: ReadonlySet<string> | readonly string[],
): { kind: 'open'; roomId: string } | { kind: 'ignore' } {
  const members = memberRoomIds instanceof Set
    ? memberRoomIds
    : new Set(memberRoomIds);
  return members.has(roomId) ? { kind: 'open', roomId } : { kind: 'ignore' };
}
