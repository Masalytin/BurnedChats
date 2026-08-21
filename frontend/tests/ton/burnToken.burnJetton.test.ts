import { Address, Cell } from '@ton/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addressToSliceStackBoc, BurnTokenError, burnJetton } from '@/ton/burnToken';
import { JETTON_BURN_ATTACHED_TON } from '@/ton/transactionBuilder';
import { getTonBalanceNano } from '@/ton/tonBalance';

vi.mock('@/ton/tonBalance', () => ({
  getTonBalanceNano: vi.fn(),
}));

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

const LIQUID_BALANCE = 10_000_000_000n;
const TON_GAS_BUFFER_NANOTON = 10_000_000n;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWalletFetch(balanceNano: bigint = LIQUID_BALANCE): typeof fetch {
  const jwSlice = addressToSliceStackBoc(JETTON_USER_WALLET);
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u.includes('/runGetMethod')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
      if (body.method === 'get_wallet_address') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['tvm.Slice', jwSlice]] },
        });
      }
      if (body.method === 'get_wallet_data') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['num', `0x${balanceNano.toString(16)}`]] },
        });
      }
    }
    if (u.includes('/getTransactions')) {
      return jsonResponse({
        ok: true,
        result: [{ transaction_id: { lt: '1', hash: 'cursor-hash' } }],
      });
    }
    return jsonResponse({ ok: false }, 404);
  }) as typeof fetch;
  return fetchImpl;
}

describe('burnJetton preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_BURN_JETTON_MASTER', MASTER);
    vi.mocked(getTonBalanceNano).mockResolvedValue(JETTON_BURN_ATTACHED_TON + TON_GAS_BUFFER_NANOTON + 1n);
  });

  it('rejects amount greater than liquid JW balance before sendTransaction', async () => {
    const sendTransactionImpl = vi.fn();
    const fetchImpl = makeWalletFetch(LIQUID_BALANCE);

    await expect(
      burnJetton(
        { walletAddress: USER, amount: LIQUID_BALANCE + 1n },
        {
          fetchImpl,
          rpcBaseUrl: 'https://stub.ton/api/v2',
          jettonMaster: MASTER,
          sendTransactionImpl,
        },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' } satisfies Partial<BurnTokenError>);

    expect(sendTransactionImpl).not.toHaveBeenCalled();
  });

  it('rejects amount 0 before sendTransaction', async () => {
    const sendTransactionImpl = vi.fn();
    const fetchImpl = makeWalletFetch();

    await expect(
      burnJetton(
        { walletAddress: USER, amount: 0n },
        {
          fetchImpl,
          rpcBaseUrl: 'https://stub.ton/api/v2',
          jettonMaster: MASTER,
          sendTransactionImpl,
        },
      ),
    ).rejects.toBeInstanceOf(BurnTokenError);

    expect(sendTransactionImpl).not.toHaveBeenCalled();
  });

  it('rejects when GRAM is below attach plus gas buffer', async () => {
    const sendTransactionImpl = vi.fn();
    const fetchImpl = makeWalletFetch();
    vi.mocked(getTonBalanceNano).mockResolvedValue(JETTON_BURN_ATTACHED_TON + TON_GAS_BUFFER_NANOTON - 1n);

    await expect(
      burnJetton(
        { walletAddress: USER, amount: 1_000_000_000n },
        {
          fetchImpl,
          rpcBaseUrl: 'https://stub.ton/api/v2',
          jettonMaster: MASTER,
          sendTransactionImpl,
        },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_TON_GAS' } satisfies Partial<BurnTokenError>);

    expect(sendTransactionImpl).not.toHaveBeenCalled();
  });

  it('sends JettonBurn to the user jetton wallet, not master or a burn address', async () => {
    const sendTransactionImpl = vi.fn().mockResolvedValue({ ok: true, boc: 'signed-burn' });
    const baseFetch = makeWalletFetch();
    let txCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes('/getTransactions')) {
        txCalls += 1;
        const lt = txCalls === 1 ? '1' : '2';
        return jsonResponse({
          ok: true,
          result: [
            {
              transaction_id: {
                lt,
                hash: txCalls === 1 ? 'cursor-hash' : 'confirmed-burn-hash',
              },
            },
          ],
        });
      }
      return baseFetch(input, init);
    }) as typeof fetch;

    const result = await burnJetton(
      { walletAddress: USER, amount: 1_000_000_000n },
      {
        fetchImpl,
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: MASTER,
        sendTransactionImpl,
      },
    );

    expect(result).toEqual({ ok: true, boc: 'signed-burn' });
    expect(sendTransactionImpl).toHaveBeenCalledTimes(1);
    const messages = sendTransactionImpl.mock.calls[0]?.[0] as Array<{ address: string; payload: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.address).toBe(Address.parse(JETTON_USER_WALLET).toString());
    expect(messages[0]!.address).not.toBe(Address.parse(MASTER).toString());
    const op = Cell.fromBoc(Buffer.from(messages[0]!.payload, 'base64'))[0]!.beginParse().loadUint(32);
    expect(op).toBe(0x595f07bc);
  });
});
