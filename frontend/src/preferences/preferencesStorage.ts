/**
 * User preferences persisted in localStorage (client-only, zero-knowledge safe).
 * Key: bc:prefs:v1
 */

export type ThemeMode = 'telegram' | 'ember' | 'bone' | 'nocturne';

export interface UserPreferences {
  hapticsEnabled: boolean;
  toastsEnabled: boolean;
  debugPanelEnabled: boolean;
  themeMode: ThemeMode;
  themeSelected: boolean;
  panicGestureEnabled: boolean;
}

export const PREFERENCES_STORAGE_KEY = 'bc:prefs:v1';

const THEME_MODES = new Set<ThemeMode>(['telegram', 'ember', 'bone', 'nocturne']);

const DEFAULT_PREFERENCES: UserPreferences = {
  hapticsEnabled: true,
  toastsEnabled: true,
  debugPanelEnabled: false,
  themeMode: 'ember',
  themeSelected: false,
  panicGestureEnabled: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeThemeMode(value: unknown): ThemeMode {
  if (value === 'dark') {
    return 'ember';
  }
  if (typeof value === 'string' && THEME_MODES.has(value as ThemeMode)) {
    return value as ThemeMode;
  }
  return 'ember';
}

export function validatePreferences(value: unknown): UserPreferences {
  if (!isRecord(value)) {
    return { ...DEFAULT_PREFERENCES };
  }

  return {
    hapticsEnabled:
      typeof value.hapticsEnabled === 'boolean'
        ? value.hapticsEnabled
        : DEFAULT_PREFERENCES.hapticsEnabled,
    toastsEnabled:
      typeof value.toastsEnabled === 'boolean'
        ? value.toastsEnabled
        : DEFAULT_PREFERENCES.toastsEnabled,
    debugPanelEnabled:
      typeof value.debugPanelEnabled === 'boolean'
        ? value.debugPanelEnabled
        : DEFAULT_PREFERENCES.debugPanelEnabled,
    themeMode: normalizeThemeMode(value.themeMode),
    themeSelected:
      typeof value.themeSelected === 'boolean' ? value.themeSelected : true,
    panicGestureEnabled:
      typeof value.panicGestureEnabled === 'boolean'
        ? value.panicGestureEnabled
        : DEFAULT_PREFERENCES.panicGestureEnabled,
  };
}

function storedNeedsRewrite(stored: unknown, validated: UserPreferences): boolean {
  if (!isRecord(stored)) {
    return false;
  }
  return stored.themeMode !== validated.themeMode || stored.themeSelected !== validated.themeSelected;
}

export function getDefaultPreferences(): UserPreferences {
  return { ...DEFAULT_PREFERENCES };
}

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return getDefaultPreferences();
    }
    const parsed: unknown = JSON.parse(raw);
    const validated = validatePreferences(parsed);
    if (storedNeedsRewrite(parsed, validated)) {
      savePreferences(validated);
    }
    return validated;
  } catch {
    return getDefaultPreferences();
  }
}

export function savePreferences(prefs: UserPreferences): void {
  try {
    const normalized: UserPreferences = {
      ...prefs,
      themeMode: normalizeThemeMode(prefs.themeMode),
    };
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore quota / private-mode storage errors
  }
}

/** Read haptics flag without React context (for useTelegram). */
export function areHapticsEnabled(): boolean {
  return loadPreferences().hapticsEnabled;
}

/** Non-critical toasts (info/success) respect user preference; errors/warnings always show. */
export function shouldShowToast(type: 'success' | 'error' | 'warning' | 'info'): boolean {
  if (type === 'error' || type === 'warning') {
    return true;
  }
  return loadPreferences().toastsEnabled;
}
