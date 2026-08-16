// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDebugPayloadAllowedForTests } from './useDebugState';
import { initMockPersist, persistMockState } from './useMockServer';

const STORAGE_KEY_ENABLED = 'debug-mock-enabled';
const STORAGE_KEY_MOCKS = 'debug-mock-configs';

describe('useMockServer prod persist', () => {
  beforeEach(() => {
    localStorage.clear();
    setDebugPayloadAllowedForTests(undefined);
  });

  afterEach(() => {
    setDebugPayloadAllowedForTests(undefined);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('does not write debug-mock-configs in prod', () => {
    setDebugPayloadAllowedForTests(false);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    persistMockState();

    const mockWrites = setItem.mock.calls.filter(
      ([key]) => key === STORAGE_KEY_MOCKS || key === STORAGE_KEY_ENABLED
    );
    expect(mockWrites).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY_MOCKS)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY_ENABLED)).toBeNull();
  });

  it('removes stale mock keys on init in prod', () => {
    localStorage.setItem(STORAGE_KEY_MOCKS, JSON.stringify([{ id: 'stale', body: { secret: 'hunter2' } }]));
    localStorage.setItem(STORAGE_KEY_ENABLED, 'true');
    setDebugPayloadAllowedForTests(false);

    initMockPersist();

    expect(localStorage.getItem(STORAGE_KEY_MOCKS)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY_ENABLED)).toBeNull();
  });
});
