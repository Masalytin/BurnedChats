import { Address } from '@ton/core';
import { describe, expect, it, vi } from 'vitest';

import { pickTrustedJettonWallet, sameTonAddress } from '@/ton/burnToken';
import { BurnTokenError } from '@/ton/burnTokenError';
import { resolveUserJettonWalletAddress } from '@/ton/jettonWalletResolve';

const MASTER = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c').toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});
const USER = Address.parse(`0:${'11'.repeat(32)}`).toString({ bounceable: true, urlSafe: true, testOnly: true });
const JETTON_USER_WALLET = Address.parse(`0:${'22'.repeat(32)}`).toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('resolveUserJettonWalletAddress', () => {
  it('throws JETTON_WALLET_UNRESOLVED when get_wallet_address exit_code is non-zero', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { exit_code: -13, stack: [] },
      }),
    );

    await expect(
      resolveUserJettonWalletAddress(USER, {
        fetchImpl,
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: MASTER,
      }),
    ).rejects.toMatchObject({
      code: 'JETTON_WALLET_UNRESOLVED',
      retryable: true,
    });

    const err = await resolveUserJettonWalletAddress(USER, {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      jettonMaster: MASTER,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BurnTokenError);
    expect((err as BurnTokenError).message).not.toMatch(/not deployed/i);
  });

  it('throws JETTON_WALLET_NOT_DEPLOYED when exit_code is 0 but stack is empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { exit_code: 0, stack: [] },
      }),
    );

    await expect(
      resolveUserJettonWalletAddress(USER, {
        fetchImpl,
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: MASTER,
      }),
    ).rejects.toMatchObject({
      code: 'JETTON_WALLET_NOT_DEPLOYED',
      retryable: false,
    });
  });

  it('returns jetton wallet address when exit_code is 0 and stack contains slice', async () => {
    const { addressToSliceStackBoc } = await import('@/ton/burnToken');
    const sliceB64 = addressToSliceStackBoc(JETTON_USER_WALLET);

    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { exit_code: 0, stack: [['tvm.Slice', sliceB64]] },
      }),
    );

    const resolved = await resolveUserJettonWalletAddress(USER, {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      jettonMaster: MASTER,
    });

    expect(resolved).toBe(JETTON_USER_WALLET);
  });

  it('resolves when Ton Center v2 returns the slice as ["cell", {bytes}] (real response shape)', async () => {
    const { addressToSliceStackBoc } = await import('@/ton/burnToken');
    const sliceB64 = addressToSliceStackBoc(JETTON_USER_WALLET);

    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { exit_code: 0, stack: [['cell', { bytes: sliceB64 }]] },
      }),
    );

    const resolved = await resolveUserJettonWalletAddress(USER, {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      jettonMaster: MASTER,
    });

    expect(resolved).toBe(JETTON_USER_WALLET);
  });

  it('maps fetch failure to NETWORK_ERROR', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      resolveUserJettonWalletAddress(USER, {
        fetchImpl,
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: MASTER,
      }),
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});

describe('pickTrustedJettonWallet', () => {
  const local = JETTON_USER_WALLET;
  const spoofed = Address.parse(`0:${'33'.repeat(32)}`).toString({
    bounceable: true,
    urlSafe: true,
    testOnly: true,
  });

  it('keeps the local derive when backend JW is a different address', () => {
    expect(pickTrustedJettonWallet(local, spoofed)).toBe(local);
    expect(sameTonAddress(local, spoofed)).toBe(false);
  });

  it('keeps the local derive when backend JW matches (any friendly form)', () => {
    const bounceable = Address.parse(local).toString({ bounceable: true, urlSafe: true, testOnly: true });
    expect(pickTrustedJettonWallet(local, bounceable)).toBe(local);
    expect(sameTonAddress(local, bounceable)).toBe(true);
  });

  it('keeps the local derive when backend JW is missing', () => {
    expect(pickTrustedJettonWallet(local, null)).toBe(local);
  });
});
