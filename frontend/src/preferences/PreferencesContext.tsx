import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

interface PreferencesContextValue {
  prefs: UserPreferences;
  setPref: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function applyThemeMode(themeMode: UserPreferences['themeMode']): void {
  const root = document.documentElement;
  if (themeMode === 'dark') {
    root.setAttribute('data-bc-theme', 'dark');
  } else {
    root.removeAttribute('data-bc-theme');
  }
}

interface PreferencesProviderProps {
  children: ReactNode;
}

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const [prefs, setPrefsState] = useState<UserPreferences>(() => loadPreferences());

  useEffect(() => {
    applyThemeMode(prefs.themeMode);
  }, [prefs.themeMode]);

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

  const value = useMemo(() => ({ prefs, setPref }), [prefs, setPref]);

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
