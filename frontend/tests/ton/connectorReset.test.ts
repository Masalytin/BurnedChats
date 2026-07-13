// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const disconnectMock = vi.fn().mockResolvedValue(undefined);
let mockConnected = false;

vi.mock('@tonconnect/ui', () => ({
  TonConnectUI: vi.fn(function TonConnectUI() {
    return {
      get connected() {
        return mockConnected;
      },
      disconnect: disconnectMock,
      wallet: null,
      connectionRestored: Promise.resolve(true),
      onStatusChange: vi.fn(() => () => {}),
      connectWallet: vi.fn(),
      setConnectRequestParameters: vi.fn(),
      sendTransaction: vi.fn(),
    };
  }),
  TonConnectUIError: class TonConnectUIError extends Error {},
}));

describe('disconnectTonConnect', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockConnected = false;
    disconnectMock.mockClear();
  });

  it('does not throw when wallet is not connected', async () => {
    const { disconnectTonConnect } = await import('@/ton/connector');

    await expect(disconnectTonConnect()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('calls disconnect when wallet is connected', async () => {
    mockConnected = true;
    const { disconnectTonConnect, getTonConnectUI } = await import('@/ton/connector');
    getTonConnectUI();

    await disconnectTonConnect();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('does not recreate the TonConnectUI singleton', async () => {
    const { disconnectTonConnect, getTonConnectUI } = await import('@/ton/connector');
    const uiBefore = getTonConnectUI();
    mockConnected = true;

    await disconnectTonConnect();

    const uiAfter = getTonConnectUI();
    expect(uiAfter).toBe(uiBefore);
  });
});
