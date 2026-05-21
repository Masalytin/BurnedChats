import { WalletAlreadyConnectedError } from '@tonconnect/sdk';
import type { ConnectedWallet } from '@tonconnect/ui';
import type { TonConnectUI } from '@tonconnect/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectWalletWithTonProof, withTimeout } from '@/ton/connector';

function mockConnectedWallet(nonce = 'test-nonce'): ConnectedWallet {
  return {
    account: {
      address: '0:0000000000000000000000000000000000000000000000000000000000000000',
      chain: '-239',
      publicKey: 'aa'.repeat(32),
      walletStateInit: 'bb'.repeat(32),
    },
    device: {
      appName: 'mock',
      appVersion: '1.0',
      maxProtocolVersion: 2,
      platform: 'browser',
    },
    connectItems: {
      tonProof: {
        name: 'ton_proof',
        proof: {
          timestamp: Math.floor(Date.now() / 1000),
          domain: { lengthBytes: 13, value: 'burnedchats.net' },
          payload: nonce,
          signature: 'cc'.repeat(64),
        },
      },
    },
  } as ConnectedWallet;
}

function createMockUi(overrides: Partial<TonConnectUI> = {}): TonConnectUI {
  return {
    connected: false,
    connectionRestored: Promise.resolve(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    setConnectRequestParameters: vi.fn(),
    connectWallet: vi.fn().mockResolvedValue(mockConnectedWallet()),
    ...overrides,
  } as unknown as TonConnectUI;
}

function neverSettlingNonce(): Promise<string> {
  return new Promise<string>(() => {
    /* never settles */
  });
}

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the promise settles before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000, 'fast')).resolves.toBe('ok');
  });

  it('rejects with [WalletAuth] prefix when the promise exceeds the deadline', async () => {
    const slow = new Promise<string>(() => {
      /* never settles */
    });
    const resultPromise = withTimeout(slow, 50, 'slowStep');
    const expectation = expect(resultPromise).rejects.toThrow(
      '[WalletAuth] slowStep timed out after 50ms',
    );
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
  });

  it('wraps rejection details with [WalletAuth] label prefix', async () => {
    const failing = Promise.reject(new Error('network down'));
    await expect(withTimeout(failing, 1_000, 'fetchWalletAuthNonce')).rejects.toThrow(
      '[WalletAuth] fetchWalletAuthNonce: network down',
    );
  });
});

describe('connectWalletWithTonProof', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('rejects when fetchWalletAuthNonce exceeds 15s', async () => {
    const ui = createMockUi();
    const flow = connectWalletWithTonProof(() => ui, neverSettlingNonce);

    const expectation = expect(flow).rejects.toThrow(
      '[WalletAuth] fetchWalletAuthNonce timed out after 15000ms',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await expectation;
    expect(ui.connectWallet).not.toHaveBeenCalled();
  });

  it('rejects when connectWallet exceeds 120s', async () => {
    const ui = createMockUi({
      connectWallet: vi.fn(
        () =>
          new Promise<ConnectedWallet>(() => {
            /* never settles */
          }),
      ),
    });

    const flow = connectWalletWithTonProof(
      () => ui,
      async () => 'server-nonce-abc',
    );
    const expectation = expect(flow).rejects.toThrow(
      '[WalletAuth] connectWallet timed out after 120000ms',
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await expectation;
  });

  it('rejects when connectionRestored exceeds 15s', async () => {
    const fetchNonce = vi.fn(async () => 'server-nonce-abc');
    const ui = createMockUi({
      connectionRestored: new Promise<boolean>(() => {
        /* never settles */
      }),
    });

    const flow = connectWalletWithTonProof(() => ui, fetchNonce);
    const expectation = expect(flow).rejects.toThrow(
      '[WalletAuth] connectionRestored timed out after 15000ms',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await expectation;
    expect(fetchNonce).not.toHaveBeenCalled();
  });

  it('returns wallet with ton_proof on success', async () => {
    const wallet = mockConnectedWallet('server-nonce-abc');
    const ui = createMockUi({
      connectWallet: vi.fn().mockResolvedValue(wallet),
    });

    const result = await connectWalletWithTonProof(
      () => ui,
      async () => 'server-nonce-abc',
    );
    expect(result).toBe(wallet);
    expect(ui.setConnectRequestParameters).toHaveBeenCalledWith({
      state: 'ready',
      value: { tonProof: 'server-nonce-abc' },
    });
    expect(ui.connectWallet).toHaveBeenCalledTimes(1);
  });

  it('disconnects before connect when already connected', async () => {
    const ui = createMockUi({ connected: true });

    await connectWalletWithTonProof(
      () => ui,
      async () => 'server-nonce-abc',
    );

    expect(ui.disconnect).toHaveBeenCalledTimes(1);
    expect(ui.connectWallet).toHaveBeenCalledTimes(1);
  });

  it('retries connect after WalletAlreadyConnectedError', async () => {
    const wallet = mockConnectedWallet();
    const connectWallet = vi
      .fn()
      .mockRejectedValueOnce(new WalletAlreadyConnectedError())
      .mockResolvedValueOnce(wallet);
    const ui = createMockUi({ connectWallet });

    const result = await connectWalletWithTonProof(
      () => ui,
      async () => 'server-nonce-abc',
    );

    expect(result).toBe(wallet);
    expect(connectWallet).toHaveBeenCalledTimes(2);
    expect(ui.setConnectRequestParameters).toHaveBeenCalledTimes(2);
  });
});
