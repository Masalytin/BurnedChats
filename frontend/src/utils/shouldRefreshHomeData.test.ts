import { describe, expect, it } from 'vitest';
import { shouldRefreshHomeData } from './shouldRefreshHomeData';

describe('shouldRefreshHomeData', () => {
  const base = {
    currentView: 'home',
    isAuthenticated: true,
    isConnected: true,
    skipInitialHomeRender: false,
  };

  it('refreshes on subsequent home navigation while online and authenticated', () => {
    expect(shouldRefreshHomeData(base)).toBe(true);
  });

  it('skips the initial home render', () => {
    expect(shouldRefreshHomeData({ ...base, skipInitialHomeRender: true })).toBe(false);
  });

  it('skips refresh when user is logged out (browser exit)', () => {
    expect(
      shouldRefreshHomeData({
        ...base,
        isAuthenticated: false,
        isConnected: false,
      }),
    ).toBe(false);
  });

  it('skips refresh when WebSocket is disconnected', () => {
    expect(shouldRefreshHomeData({ ...base, isConnected: false })).toBe(false);
  });

  it('skips refresh on non-home views', () => {
    expect(shouldRefreshHomeData({ ...base, currentView: 'chat' })).toBe(false);
  });
});
