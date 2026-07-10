/**
 * User preferences persisted in localStorage (client-only, zero-knowledge safe).
 * Key: bc:prefs:v1
 */

export interface UserPreferences {
  hapticsEnabled: boolean;
  toastsEnabled: boolean;
  debugPanelEnabled: boolean;
  themeMode: 'telegram' | 'dark';
  panicGestureEnabled: boolean;
}

export const PREFERENCES_STORAGE_KEY = 'bc:prefs:v1';

const DEFAULT_PREFERENCES: UserPreferences = {
  hapticsEnabled: true,
  toastsEnabled: true,
  debugPanelEnabled: false,
  themeMode: 'telegram',
  panicGestureEnabled: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePreferences(value: unknown): UserPreferences {
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
    themeMode: value.themeMode === 'dark' ? 'dark' : 'telegram',
    panicGestureEnabled:
      typeof value.panicGestureEnabled === 'boolean'
        ? value.panicGestureEnabled
        : DEFAULT_PREFERENCES.panicGestureEnabled,
  };
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
    return validatePreferences(JSON.parse(raw));
  } catch {
    return getDefaultPreferences();
  }
}

export function savePreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
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
