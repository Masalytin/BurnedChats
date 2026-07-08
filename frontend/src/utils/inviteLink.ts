const INVITE_FRAGMENT_PREFIX = 'invite_';

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
  const token = fragment.slice(INVITE_FRAGMENT_PREFIX.length);
  return token.length > 0 ? token : null;
}

/** Build Telegram Mini App deep link for the given invite token. */
export function buildTelegramInviteDeepLink(token: string): string {
  const botUrl = import.meta.env.VITE_TELEGRAM_BOT_URL || 'https://t.me/BurnedChatsBot';
  const base = botUrl.replace(/\/$/, '');
  return `${base}/app?startapp=invite_${token}`;
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
