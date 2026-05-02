import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import WebApp from '@twa-dev/sdk';
import { getEnvironment } from '../env/detector';
import { telegramInternalId } from './internalId';
import { TelegramAuthProvider } from './TelegramAuthProvider';
import { WalletAuthProvider } from './WalletAuthProvider';
import { AuthType, type AuthCredentials, type AuthProvider, type AuthResult, type AuthUser } from './types';

interface AuthContextValue {
  provider: AuthProvider | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authType: AuthType | null;
  login: () => Promise<void>;
  logout: () => void;
  getCredentials: () => AuthCredentials | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthContextProvider({ children }: AuthProviderProps) {
  const [provider, setProvider] = useState<AuthProvider | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const buildTelegramUser = useCallback((): AuthUser | null => {
    const tgUser = WebApp.initDataUnsafe?.user;
    if (!tgUser?.id) {
      return null;
    }

    return {
      internalId: telegramInternalId(tgUser.id),
      displayName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim() || `@${tgUser.username ?? tgUser.id}`,
      avatarUrl: tgUser.photo_url,
      authType: AuthType.TELEGRAM,
      telegramId: tgUser.id,
      username: tgUser.username,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
    };
  }, []);

  const buildWalletUser = useCallback((result: AuthResult): AuthUser => {
    const friendly = result.walletAddress ?? result.userId;
    return {
      internalId: result.userId,
      displayName: result.displayName,
      authType: AuthType.WALLET,
      walletAddress: friendly,
    };
  }, []);

  const login = useCallback(async () => {
    if (!provider) {
      return;
    }

    const result = await provider.authenticate();
    if (provider.type === AuthType.TELEGRAM) {
      const unified = buildTelegramUser();
      setUser(unified);
      setIsAuthenticated(Boolean(unified));
    } else if (provider.type === AuthType.WALLET) {
      const unified = buildWalletUser(result);
      setUser(unified);
      setIsAuthenticated(true);
    }
  }, [provider, buildTelegramUser, buildWalletUser]);

  const logout = useCallback(() => {
    provider?.logout();
    setUser(null);
    setIsAuthenticated(false);
  }, [provider]);

  const getCredentials = useCallback((): AuthCredentials | null => {
    if (!provider || !provider.isAuthenticated()) {
      return null;
    }
    return provider.getCredentials();
  }, [provider]);

  useEffect(() => {
    const bootstrap = async () => {
      setIsLoading(true);
      const env = getEnvironment();

      if (env === 'telegram') {
        const telegramProvider = new TelegramAuthProvider();
        setProvider(telegramProvider);

        try {
          await telegramProvider.authenticate();
          const unified = buildTelegramUser();
          setUser(unified);
          setIsAuthenticated(Boolean(unified));
        } catch {
          setUser(null);
          setIsAuthenticated(false);
        }
      } else {
        const walletProvider = new WalletAuthProvider();
        setProvider(walletProvider);
        setUser(null);
        setIsAuthenticated(false);
      }

      setIsLoading(false);
    };

    void bootstrap();
  }, [buildTelegramUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      provider,
      user,
      isAuthenticated,
      isLoading,
      authType: user?.authType ?? provider?.type ?? null,
      login,
      logout,
      getCredentials,
    }),
    [provider, user, isAuthenticated, isLoading, login, logout, getCredentials],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthContextProvider');
  }
  return context;
}
