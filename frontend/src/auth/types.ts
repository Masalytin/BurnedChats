export enum AuthType {
  TELEGRAM = 'telegram',
  WALLET = 'wallet',
}

export interface AuthCredentials {
  type: AuthType;
  initData?: string;
  walletAddress?: string;
  walletProof?: string;
  sessionToken?: string;
}

export interface AuthResult {
  /** Stable user id (`internalId` from backend); for Telegram still derived from tg id helper */
  userId: string;
  displayName: string;
  authType: AuthType;
  token?: string;
  /** Friendly EQ… address for wallet flows */
  walletAddress?: string;
}

export interface AuthUser {
  internalId: string;
  displayName: string;
  avatarUrl?: string;
  authType: AuthType;
  telegramId?: number;
  /** User-friendly TON address (Ton Connect); set for wallet-only users */
  walletAddress?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthProvider {
  type: AuthType;
  authenticate(): Promise<AuthResult>;
  getCredentials(): AuthCredentials;
  getDisplayName(): string;
  getUserId(): string;
  isAuthenticated(): boolean;
  logout(): void;
}
