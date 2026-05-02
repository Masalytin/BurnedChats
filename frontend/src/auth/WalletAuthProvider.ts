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

  public async authenticate(): Promise<AuthResult> {
    const wallet = await connectWalletWithTonProof();
    const proof = wallet.connectItems?.tonProof;

    if (!isTonProofSuccess(proof)) {
      throw new Error('Ton proof was not returned by the wallet');
    }

    this.proofPayload = serializeTonProof(proof);
    this.friendlyAddress = accountToFriendlyAddress(wallet.account);

    return {
      userId: this.friendlyAddress,
      displayName: this.getDisplayName(),
      authType: AuthType.WALLET,
    };
  }

  public getCredentials(): AuthCredentials {
    return {
      type: AuthType.WALLET,
      walletAddress: this.friendlyAddress ?? undefined,
      walletProof: this.proofPayload ?? undefined,
    };
  }

  public getDisplayName(): string {
    if (!this.friendlyAddress) {
      return 'Wallet';
    }
    return shortenTonDisplayAddress(this.friendlyAddress);
  }

  public getUserId(): string {
    return this.friendlyAddress ?? '';
  }

  public isAuthenticated(): boolean {
    return Boolean(this.friendlyAddress && this.proofPayload);
  }

  public logout(): void {
    void getTonConnectUI().disconnect();
    this.proofPayload = null;
    this.friendlyAddress = null;
  }
}
