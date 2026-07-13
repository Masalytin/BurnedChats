import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetTonConnectUI, subscribeTonConnectReset } from '@/ton/connector';

describe('resetTonConnectUI', () => {
  afterEach(() => {
    resetTonConnectUI();
  });

  it('notifies subscribers when the TonConnect singleton is reset', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTonConnectReset(listener);

    resetTonConnectUI();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    resetTonConnectUI();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
