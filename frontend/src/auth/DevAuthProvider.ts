import { AuthType, type AuthCredentials, type AuthProvider, type AuthResult } from './types';

/**
 * Returns the dev-login label from `?devLogin={label}` — ONLY in `vite dev`.
 *
 * `import.meta.env.DEV` is statically replaced with `false` by `vite build`,
 * so the whole branch (and the provider import that depends on it) is
 * eliminated from production bundles. The backend endpoint additionally
 * exists only under the dev Spring profile with an explicit enable flag.
 */
export function isDevAuthRequested(): string | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const label = new URLSearchParams(window.location.search).get('devLogin');
  return label && /^[a-z0-9-]{1,32}$/.test(label) ? label : null;
}

/**
 * Development authentication: trades a label for a regular session token via
 * `POST /api/auth/dev-login` (no TON Connect involved). Reuses
 * {@link AuthType.WALLET} because the issued session is indistinguishable
 * from a wallet session for the rest of the stack (STOMP, rooms, search).
 */
export class DevAuthProvider implements AuthProvider {
  public readonly type = AuthType.WALLET;

  private sessionToken: string | null = null;
  private internalId: string | null = null;
  private displayName: string | null = null;

  constructor(private readonly label: string) {}

  public async authenticate(): Promise<AuthResult> {
    const base = this.normalizeApiBase();
    const response = await fetch(`${base}/api/auth/dev-login`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: this.label }),
    });

    if (!response.ok) {
      throw new Error(`Dev login failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      token?: unknown;
      user?: { internalId?: unknown; displayName?: unknown };
    };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      throw new Error('Dev login response has no token');
    }
    if (typeof body.user?.internalId !== 'string' || body.user.internalId.length === 0) {
      throw new Error('Dev login response has no internalId');
    }

    this.sessionToken = body.token;
    this.internalId = body.user.internalId;
    this.displayName =
      typeof body.user.displayName === 'string' && body.user.displayName.length > 0
        ? body.user.displayName
        : `dev-${this.label}`;

    return {
      userId: this.internalId,
      displayName: this.displayName,
      authType: AuthType.WALLET,
      token: this.sessionToken,
      walletAddress: `dev-${this.label}`,
    };
  }

  public getCredentials(): AuthCredentials {
    return {
      type: AuthType.WALLET,
      sessionToken: this.sessionToken ?? undefined,
    };
  }

  public getDisplayName(): string {
    return this.displayName ?? `dev-${this.label}`;
  }

  public getUserId(): string {
    return this.internalId ?? '';
  }

  public isAuthenticated(): boolean {
    return Boolean(this.internalId && this.sessionToken);
  }

  public logout(): void {
    this.sessionToken = null;
    this.internalId = null;
    this.displayName = null;
  }

  private normalizeApiBase(): string {
    const raw = import.meta.env.VITE_API_URL ?? '';
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  }
}
