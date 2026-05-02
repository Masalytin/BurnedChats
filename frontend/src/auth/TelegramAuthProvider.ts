import WebApp from '@twa-dev/sdk';
import { AuthType, type AuthCredentials, type AuthProvider, type AuthResult } from './types';

interface TelegramSdkUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export class TelegramAuthProvider implements AuthProvider {
  public readonly type = AuthType.TELEGRAM;

  public async authenticate(): Promise<AuthResult> {
    const initData = WebApp.initData;
    const sdkUser = WebApp.initDataUnsafe?.user as TelegramSdkUser | undefined;

    if (!initData || initData.length === 0 || !sdkUser?.id) {
      throw new Error('Telegram auth is unavailable outside Mini App environment');
    }

    return {
      userId: String(sdkUser.id),
      displayName: this.getDisplayName(),
      authType: AuthType.TELEGRAM,
      token: initData,
    };
  }

  public getCredentials(): AuthCredentials {
    return {
      type: AuthType.TELEGRAM,
      initData: WebApp.initData || '',
    };
  }

  public getDisplayName(): string {
    const sdkUser = WebApp.initDataUnsafe?.user as TelegramSdkUser | undefined;
    if (!sdkUser) {
      return 'Telegram user';
    }

    const fullName = [sdkUser.first_name, sdkUser.last_name].filter(Boolean).join(' ').trim();
    if (fullName) {
      return fullName;
    }

    if (sdkUser.username) {
      return `@${sdkUser.username}`;
    }

    return `Telegram ${sdkUser.id}`;
  }

  public getUserId(): string {
    const sdkUser = WebApp.initDataUnsafe?.user as TelegramSdkUser | undefined;
    return sdkUser?.id ? String(sdkUser.id) : '';
  }

  public isAuthenticated(): boolean {
    return Boolean(WebApp.initData && WebApp.initData.length > 0);
  }

  public logout(): void {
    // Telegram auth is session-bound in host app; local logout is no-op.
  }
}
