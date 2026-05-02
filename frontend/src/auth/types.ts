export enum AuthType {
  TELEGRAM = 'telegram',
  WALLET = 'wallet',
}

export interface AuthCredentials {
  type: AuthType;
  initData?: string;
  walletAddress?: string;
  walletProof?: string;
}

export interface AuthResult {
  userId: string;
  displayName: string;
  authType: AuthType;
  token?: string;
}

export interface AuthUser {
  internalId: string;
  displayName: string;
  avatarUrl?: string;
  authType: AuthType;
  telegramId?: number;
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
