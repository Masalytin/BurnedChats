import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import './preferencesTheme.css';
import {
  loadPreferences,
  savePreferences,
  type UserPreferences,
} from './preferencesStorage';
import { isTelegramMiniApp } from '../env/detector';
import { useTelegram } from '../hooks/useTelegram';
import { evaluateTelegramTheme, type TelegramThemeParams } from '../theme/contrast';

export const TELEGRAM_UNSAFE_ATTR = 'data-bc-telegram-unsafe';

interface PreferencesContextValue {
  prefs: UserPreferences;
  setPref: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  /** Runtime-only: persisted themeMode is still telegram, canvas uses the Ember sheet. */
  telegramUnsafe: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function applyThemeMode(
  themeMode: UserPreferences['themeMode'],
  themeParams: TelegramThemeParams,
): boolean {
  const root = document.documentElement;
  if (themeMode !== 'telegram') {
    root.setAttribute('data-bc-theme', themeMode);
    root.removeAttribute(TELEGRAM_UNSAFE_ATTR);
    return false;
  }

  root.setAttribute('data-bc-theme', 'telegram');

  if (!isTelegramMiniApp()) {
    root.removeAttribute(TELEGRAM_UNSAFE_ATTR);
    return false;
  }

  const unsafe = evaluateTelegramTheme(themeParams ?? {}) === 'unsafe';
  if (unsafe) {
    root.setAttribute(TELEGRAM_UNSAFE_ATTR, '');
  } else {
    root.removeAttribute(TELEGRAM_UNSAFE_ATTR);
  }
  return unsafe;
}

interface PreferencesProviderProps {
  children: ReactNode;
}

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const [prefs, setPrefsState] = useState<UserPreferences>(() => loadPreferences());
  const [telegramUnsafe, setTelegramUnsafe] = useState(false);
  const { themeParams } = useTelegram();

  useLayoutEffect(() => {
    setTelegramUnsafe(applyThemeMode(prefs.themeMode, themeParams));
  }, [prefs.themeMode, themeParams]);

  const setPref = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      setPrefsState((prev) => {
        const next = { ...prev, [key]: value };
        savePreferences(next);
        return next;
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ prefs, setPref, telegramUnsafe }),
    [prefs, setPref, telegramUnsafe],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
