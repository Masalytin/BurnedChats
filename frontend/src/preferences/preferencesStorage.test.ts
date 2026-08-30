// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDefaultPreferences,
  loadPreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
} from './preferencesStorage';

function storedRecord(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? 'null') as Record<
    string,
    unknown
  >;
}

describe('preferencesStorage themeMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to ember with themeSelected false when no prefs key exists', () => {
    const prefs = loadPreferences();
    expect(prefs.themeMode).toBe('ember');
    expect(prefs.themeSelected).toBe(false);
    expect(getDefaultPreferences()).toEqual(
      expect.objectContaining({ themeMode: 'ember', themeSelected: false }),
    );
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
  });

  it('reads stored dark as ember and rewrites the key as ember', () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        hapticsEnabled: true,
        toastsEnabled: true,
        debugPanelEnabled: false,
        themeMode: 'dark',
        panicGestureEnabled: false,
      }),
    );

    const prefs = loadPreferences();
    expect(prefs.themeMode).toBe('ember');
    expect(storedRecord().themeMode).toBe('ember');
  });

  it('treats a missing themeSelected on an existing prefs object as true', () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        hapticsEnabled: true,
        toastsEnabled: true,
        debugPanelEnabled: false,
        themeMode: 'telegram',
        panicGestureEnabled: false,
      }),
    );

    const prefs = loadPreferences();
    expect(prefs.themeSelected).toBe(true);
    expect(prefs.themeMode).toBe('telegram');
    expect(storedRecord().themeSelected).toBe(true);
  });

  it('maps an unknown themeMode to ember', () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        hapticsEnabled: false,
        themeMode: 'solarized',
      }),
    );

    expect(loadPreferences().themeMode).toBe('ember');
    expect(storedRecord().themeMode).toBe('ember');
  });

  it('preserves ember, bone, nocturne, and telegram', () => {
    for (const themeMode of ['ember', 'bone', 'nocturne', 'telegram'] as const) {
      localStorage.setItem(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({
          ...getDefaultPreferences(),
          themeMode,
          themeSelected: true,
        }),
      );
      expect(loadPreferences().themeMode).toBe(themeMode);
    }
  });

  it('honours an explicit themeSelected boolean', () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...getDefaultPreferences(),
        themeMode: 'bone',
        themeSelected: false,
      }),
    );
    expect(loadPreferences().themeSelected).toBe(false);
  });

  it('savePreferences never writes dark', () => {
    savePreferences({
      ...getDefaultPreferences(),
      themeMode: 'ember',
      themeSelected: true,
    });
    expect(storedRecord().themeMode).toBe('ember');
    expect(JSON.stringify(storedRecord())).not.toContain('"dark"');
  });
});
