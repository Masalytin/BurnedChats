import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Address } from '@ton/core';
import { toUserFriendlyAddress } from '@tonconnect/sdk';
import WebApp from '@twa-dev/sdk';
import { getEnvironment } from '../env/detector';
import {
  fetchLinkedAccounts,
  type LinkedAccountsDto,
} from '../services/accountLinkingApi';
import { telegramInternalId } from './internalId';
import { TelegramAuthProvider } from './TelegramAuthProvider';
import { WalletAuthProvider } from './WalletAuthProvider';
import { setActiveCredentials } from './authCredentialsAccessor';
import { AuthType, type AuthCredentials, type AuthProvider, type AuthResult, type AuthUser } from './types';
import {
  createLinkedRefreshGate,
  dtoToLinkedWallet,
  runLinkedAccountsRefresh,
  type LinkedWalletSnapshot,
} from './linkedWalletSnapshot';

export type { LinkedWalletSnapshot };

interface AuthContextValue {
  provider: AuthProvider | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authType: AuthType | null;
  login: () => Promise<void>;
  logout: () => void;
  getCredentials: () => AuthCredentials | null;
  /** Server `walletLinked` + `walletAddress` + `telegramLinked`. IMP-WSWITCH-03/04 read this. */
  linkedWallet: LinkedWalletSnapshot | null;
  applyLinkedAccounts: (dto: LinkedAccountsDto) => void;
  refreshLinkedAccounts: () => Promise<void>;
}

function toFriendlyDisplay(rawOrFriendly: string): string {
  const trimmed = rawOrFriendly.trim();
  if (!trimmed) return '';
  try {
    return toUserFriendlyAddress(Address.parse(trimmed).toRawString());
  } catch {
    return trimmed;
  }
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
  const [linkedWallet, setLinkedWallet] = useState<LinkedWalletSnapshot | null>(null);
  const linkedRefreshGateRef = useRef(createLinkedRefreshGate());

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
    linkedRefreshGateRef.current.invalidate();
    setUser(null);
    setIsAuthenticated(false);
    setLinkedWallet(null);
  }, [provider]);

  const applyLinkedAccounts = useCallback((dto: LinkedAccountsDto) => {
    linkedRefreshGateRef.current.invalidate();
    setLinkedWallet(dtoToLinkedWallet(dto));
    setUser((prev) => {
      if (!prev || prev.authType !== AuthType.WALLET) {
        return prev;
      }
      const raw = typeof dto.walletAddress === 'string' ? dto.walletAddress : '';
      if (!raw) {
        return prev;
      }
      const friendly = toFriendlyDisplay(raw);
      if (prev.walletAddress === friendly) {
        return prev;
      }
      return { ...prev, walletAddress: friendly };
    });
  }, []);

  const refreshLinkedAccounts = useCallback(async () => {
    if (!provider || !provider.isAuthenticated()) {
      setLinkedWallet(null);
      return;
    }
    const creds = provider.getCredentials();
    await runLinkedAccountsRefresh({
      gate: linkedRefreshGateRef.current,
      fetchDto: () =>
        fetchLinkedAccounts({
          initData: creds.initData,
          sessionToken: creds.sessionToken,
        }),
      apply: applyLinkedAccounts,
    });
  }, [applyLinkedAccounts, provider]);

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
        // Dev-only agent login: statically eliminated from production builds
        // (`import.meta.env.DEV` is replaced with `false` by `vite build`).
        if (import.meta.env.DEV) {
          const { DevAuthProvider, isDevAuthRequested } = await import('./DevAuthProvider');
          const label = isDevAuthRequested();
          if (label) {
            const devProvider = new DevAuthProvider(label);
            try {
              const result = await devProvider.authenticate();
              setProvider(devProvider);
              setUser(buildWalletUser(result));
              setIsAuthenticated(true);
              setIsLoading(false);
              return;
            } catch (e) {
              console.warn('[DevAuth] dev login failed, falling back to wallet login', e);
            }
          }
        }

        const walletProvider = new WalletAuthProvider();
        setProvider(walletProvider);
        setUser(null);
        setIsAuthenticated(false);
      }

      setIsLoading(false);
    };

    void bootstrap();
  }, [buildTelegramUser, buildWalletUser]);

  useEffect(() => {
    if (provider && isAuthenticated && provider.isAuthenticated()) {
      setActiveCredentials(provider.getCredentials());
    } else {
      setActiveCredentials(null);
    }
  }, [provider, user, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !provider || !provider.isAuthenticated()) {
      return;
    }
    void refreshLinkedAccounts();
  }, [isAuthenticated, provider, refreshLinkedAccounts]);

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
      linkedWallet,
      applyLinkedAccounts,
      refreshLinkedAccounts,
    }),
    [
      provider,
      user,
      isAuthenticated,
      isLoading,
      login,
      logout,
      getCredentials,
      linkedWallet,
      applyLinkedAccounts,
      refreshLinkedAccounts,
    ],
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
