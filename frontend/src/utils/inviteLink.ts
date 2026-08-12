const INVITE_FRAGMENT_PREFIX = 'invite_';
const DM_INVITE_FRAGMENT_PREFIX = 'dm_invite_';

/** sessionStorage key for invite token stash through wallet-login redirects */
export const PENDING_INVITE_TOKEN_KEY = 'pending-invite-token';

/**
 * Extract invite token from URL hash (`#invite_{token}`).
 * Returns null when the fragment is missing, malformed, or empty.
 */
export function parseInviteFragment(hash: string): string | null {
  if (!hash || hash === '#') {
    return null;
  }
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment.startsWith(INVITE_FRAGMENT_PREFIX)) {
    return null;
  }
  // Personal DM invite uses dm_invite_ — never treat as room invite_
  if (fragment.startsWith(DM_INVITE_FRAGMENT_PREFIX)) {
    return null;
  }
  const token = fragment.slice(INVITE_FRAGMENT_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * Extract personal DM invite token from URL hash (`#dm_invite_{token}`).
 */
export function parseDmInviteFragment(hash: string): string | null {
  if (!hash || hash === '#') {
    return null;
  }
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment.startsWith(DM_INVITE_FRAGMENT_PREFIX)) {
    return null;
  }
  const token = fragment.slice(DM_INVITE_FRAGMENT_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * Extract invite token from a scanned / pasted invite URL or raw startapp value.
 * Supports web `{domain}/join#invite_{token}` and t.me `?startapp=invite_{token}`.
 */
export function parseInviteUrl(text: string): string | null {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  // Bare `invite_{token}` / `#invite_{token}` (e.g. start_param value)
  const bare = parseInviteFragment(trimmed);
  if (bare) {
    return bare;
  }

  try {
    const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withProtocol);

    const fromHash = parseInviteFragment(url.hash);
    if (fromHash) {
      return fromHash;
    }

    const startapp = url.searchParams.get('startapp');
    if (startapp) {
      const fromStartapp = parseInviteFragment(startapp);
      if (fromStartapp) {
        return fromStartapp;
      }
    }
  } catch {
    // Fall through to regex fallbacks for malformed-but-recognizable strings.
  }

  const hashMatch = trimmed.match(/#invite_([A-Za-z0-9_-]+)/);
  if (hashMatch?.[1]) {
    return hashMatch[1];
  }

  const startappMatch = trimmed.match(/[?&]startapp=invite_([A-Za-z0-9_-]+)/);
  if (startappMatch?.[1]) {
    return startappMatch[1];
  }

  return null;
}

/**
 * Extract personal DM invite token from URL / startapp / bare `dm_invite_{token}`.
 * Does not match room `invite_` or notification `dm_{sessionId}`.
 */
export function parseDmInviteUrl(text: string): string | null {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const bare = parseDmInviteFragment(trimmed);
  if (bare) {
    return bare;
  }

  try {
    const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withProtocol);

    const fromHash = parseDmInviteFragment(url.hash);
    if (fromHash) {
      return fromHash;
    }

    const startapp = url.searchParams.get('startapp');
    if (startapp) {
      const fromStartapp = parseDmInviteFragment(startapp);
      if (fromStartapp) {
        return fromStartapp;
      }
    }
  } catch {
    // Fall through to regex fallbacks.
  }

  const hashMatch = trimmed.match(/#dm_invite_([A-Za-z0-9_-]+)/);
  if (hashMatch?.[1]) {
    return hashMatch[1];
  }

  const startappMatch = trimmed.match(/[?&]startapp=dm_invite_([A-Za-z0-9_-]+)/);
  if (startappMatch?.[1]) {
    return startappMatch[1];
  }

  return null;
}

/** Result of classifying a scanned / pasted invite QR payload. */
export type ScannedInviteKind = 'dm' | 'room' | 'invalid';

export interface ScannedInviteResult {
  kind: ScannedInviteKind;
  token: string | null;
}

/**
 * Classify scanned QR / pasted text for the in-app DM invite scanner.
 * DM (`dm_invite_`) is checked before room (`invite_`) so prefixes never collide.
 */
export function classifyScannedInvite(text: string): ScannedInviteResult {
  const dmToken = parseDmInviteUrl(text);
  if (dmToken) {
    return { kind: 'dm', token: dmToken };
  }
  const roomToken = parseInviteUrl(text);
  if (roomToken) {
    return { kind: 'room', token: roomToken };
  }
  return { kind: 'invalid', token: null };
}

/** Build Telegram Mini App deep link for the given invite token. */
export function buildTelegramInviteDeepLink(token: string): string {
  const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || 'https://t.me/BurnedChatsBot';
  const base = botUrl.replace(/\/$/, '');
  return `${base}/app?startapp=invite_${token}`;
}

/** Build Telegram Mini App deep link for a personal DM invite token. */
export function buildTelegramDmInviteDeepLink(token: string): string {
  const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || 'https://t.me/BurnedChatsBot';
  const base = botUrl.replace(/\/$/, '');
  return `${base}/app?startapp=dm_invite_${token}`;
}

/**
 * Build a Telegram native share URL (`t.me/share/url`) for an invite link.
 * Share text is assembled client-side only (may include decrypted room title).
 */
export function buildTelegramShareUrl(inviteUrl: string, text?: string): string {
  const encodedUrl = encodeURIComponent(inviteUrl);
  const encodedText = encodeURIComponent(text ?? '');
  return `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`;
}

export function stashPendingInviteToken(token: string): void {
  sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, token);
}

export function readPendingInviteToken(): string | null {
  return sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY);
}

export function clearPendingInviteToken(): void {
  sessionStorage.removeItem(PENDING_INVITE_TOKEN_KEY);
}
