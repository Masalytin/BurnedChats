import {
  accountToFriendlyAddress,
  connectWalletWithTonProof,
  getTonConnectUI,
  serializeTonProof,
  shortenTonDisplayAddress,
  isTonProofSuccess,
} from '@/ton/connector';
import { AuthType, type AuthCredentials, type AuthProvider, type AuthResult } from './types';

/**
 * Wallet authentication via Ton Connect + backend-issued ton_proof nonce.
 */
export class WalletAuthProvider implements AuthProvider {
  public readonly type = AuthType.WALLET;

  private proofPayload: string | null = null;
  private friendlyAddress: string | null = null;
  private sessionToken: string | null = null;
  private internalId: string | null = null;
  private serverDisplayName: string | null = null;

  public async authenticate(): Promise<AuthResult> {
    const wallet = await connectWalletWithTonProof();
    const proof = wallet.connectItems?.tonProof;

    if (!isTonProofSuccess(proof)) {
      throw new Error('Ton proof was not returned by the wallet');
    }

    this.proofPayload = serializeTonProof(proof);
    this.friendlyAddress = accountToFriendlyAddress(wallet.account);

    const session = await this.authenticateWithBackend(this.friendlyAddress, this.proofPayload);
    this.sessionToken = session.token;
    this.internalId = session.internalId;
    this.serverDisplayName = session.displayName;

    return {
      userId: this.internalId,
      displayName: this.getDisplayName(),
      authType: AuthType.WALLET,
      token: this.sessionToken,
      walletAddress: this.friendlyAddress,
    };
  }

  public getCredentials(): AuthCredentials {
    return {
      type: AuthType.WALLET,
      walletAddress: this.friendlyAddress ?? undefined,
      walletProof: this.proofPayload ?? undefined,
      sessionToken: this.sessionToken ?? undefined,
    };
  }

  public getDisplayName(): string {
    if (this.serverDisplayName) {
      return this.serverDisplayName;
    }
    if (!this.friendlyAddress) {
      return 'Wallet';
    }
    return shortenTonDisplayAddress(this.friendlyAddress);
  }

  public getUserId(): string {
    return this.internalId ?? '';
  }

  public isAuthenticated(): boolean {
    return Boolean(this.internalId && this.proofPayload && this.sessionToken);
  }

  public logout(): void {
    void getTonConnectUI().disconnect();
    this.proofPayload = null;
    this.friendlyAddress = null;
    this.sessionToken = null;
    this.internalId = null;
    this.serverDisplayName = null;
  }

  private async authenticateWithBackend(
    walletAddress: string,
    walletProof: string,
  ): Promise<{ token: string; internalId: string; displayName: string }> {
    const base = this.normalizeApiBase();
    const response = await fetch(`${base}/api/auth/wallet`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress,
        walletProof,
      }),
    });

    if (!response.ok) {
      throw new Error(`Wallet backend authentication failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      token?: unknown;
      user?: { internalId?: unknown; displayName?: unknown };
    };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      throw new Error('Wallet backend authentication response has no token');
    }
    const internalId = body.user?.internalId;
    if (typeof internalId !== 'string' || internalId.length === 0) {
      throw new Error('Wallet backend authentication response has no internalId');
    }
    const displayName = typeof body.user?.displayName === 'string' ? body.user.displayName : '';

    return { token: body.token, internalId, displayName };
  }

  private normalizeApiBase(): string {
    const raw = import.meta.env.VITE_API_URL ?? '';
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  }
}
