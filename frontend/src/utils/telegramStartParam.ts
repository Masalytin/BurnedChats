/**
 * Telegram Mini App start_param helpers (IMP-TGUX-03).
 *
 * Formats (initDataUnsafe.start_param):
 *   invite_{token}  — room invite (handled elsewhere)
 *   lt_{challenge}  — wallet↔Telegram link (handled elsewhere)
 *   dm_{sessionId}  — open DM / incoming chat request
 *   room_{roomId}   — open room if member
 */

export function parseDmStartParam(startParam: string | null | undefined): string | null {
  if (!startParam?.startsWith('dm_')) return null;
  const sessionId = startParam.slice('dm_'.length);
  return sessionId.length > 0 ? sessionId : null;
}

export function parseRoomStartParam(startParam: string | null | undefined): string | null {
  if (!startParam?.startsWith('room_')) return null;
  const roomId = startParam.slice('room_'.length);
  return roomId.length > 0 ? roomId : null;
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
