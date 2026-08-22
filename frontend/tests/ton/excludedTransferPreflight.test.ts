import { Address } from '@ton/core';
import { describe, expect, it, vi } from 'vitest';

import {
  createExcludedPreflightDeps,
  isExcludedBurnHolder,
  isExcludedTransfer,
} from '@/ton/excludedTransferPreflight';
import { RECOMMENDED_EXCLUDED_PATH_NANO, estimateBurnTransferTon } from '@/ton/estimateBurnTransferTon';

const MASTER = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c').toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});
const SENDER = Address.parse(`0:${'11'.repeat(32)}`).toString({ bounceable: true, urlSafe: true, testOnly: true });
const RECIPIENT = Address.parse(`0:${'22'.repeat(32)}`).toString({ bounceable: true, urlSafe: true, testOnly: true });

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deps(fetchImpl: typeof fetch) {
  return {
    fetchImpl,
    rpcBaseUrl: 'https://stub.ton/api/v2',
    jettonMaster: MASTER,
  };
}

function signedExcludedStackResponse(): Response {
  return jsonResponse({
    ok: true,
    result: { exit_code: 0, stack: [['num', '-0x1']] },
  });
}

function excludedStackResponse(): Response {
  return jsonResponse({
    ok: true,
    result: { exit_code: 0, stack: [['num', '0xffffffffffffffff']] },
  });
}

function notExcludedStackResponse(): Response {
  return jsonResponse({
    ok: true,
    result: { exit_code: 0, stack: [['num', '0x0']] },
  });
}

describe('IMP-JETTON-GAS-11 — excludedTransferPreflight', () => {
  it('isExcludedBurnHolder returns false for invalid address without RPC', async () => {
    const fetchImpl = vi.fn();
    const result = await isExcludedBurnHolder('bad', deps(fetchImpl));
    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('isExcludedBurnHolder returns true for Ton Center signed hex -0x1', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(signedExcludedStackResponse());
    const result = await isExcludedBurnHolder(SENDER, deps(fetchImpl));
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('isExcludedBurnHolder calls get_is_excluded on master with owner slice', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(excludedStackResponse());
    const result = await isExcludedBurnHolder(SENDER, deps(fetchImpl));
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body)) as {
      address: string;
      method: string;
    };
    expect(body.address).toBe(MASTER);
    expect(body.method).toBe('get_is_excluded');
  });

  it('isExcludedBurnHolder returns false on RPC failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('network'));
    const result = await isExcludedBurnHolder(SENDER, deps(fetchImpl));
    expect(result).toBe(false);
  });

  it('isExcludedTransfer is true when sender is excluded', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(excludedStackResponse());
    const result = await isExcludedTransfer(SENDER, RECIPIENT, deps(fetchImpl));
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('isExcludedTransfer is true when only recipient is excluded', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(notExcludedStackResponse())
      .mockResolvedValueOnce(excludedStackResponse());
    const result = await isExcludedTransfer(SENDER, RECIPIENT, deps(fetchImpl));
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('isExcludedTransfer is false when neither side is excluded', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(notExcludedStackResponse())
      .mockResolvedValueOnce(notExcludedStackResponse());
    const result = await isExcludedTransfer(SENDER, RECIPIENT, deps(fetchImpl));
    expect(result).toBe(false);
  });

  it('excluded sender estimate uses post-F11 2.3 TON attach (feePath false)', () => {
    const estimate = estimateBurnTransferTon({ feePath: false });
    expect(estimate.recommendedNano).toBe(RECOMMENDED_EXCLUDED_PATH_NANO);
    expect(estimate.recommendedNano).toBe(2_300_000_000n);
    expect(estimate.recommendedNano).toBeGreaterThan(estimate.minimumNano);
  });

  it('createExcludedPreflightDeps returns null without master env', () => {
    const prev = import.meta.env.VITE_BURN_JETTON_MASTER;
    import.meta.env.VITE_BURN_JETTON_MASTER = '';
    expect(createExcludedPreflightDeps()).toBeNull();
    import.meta.env.VITE_BURN_JETTON_MASTER = prev;
  });
});
