import { Address, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { assertCheck } from './checks';
import type { CheckResult } from '../types';

export const NANO_PER_BURN = 10n ** 9n;
export const TRANSFER_AMOUNT = 1n * NANO_PER_BURN;
/** Hardcoded 1% burn: 1 BURN transfer delivers 0.99 and burns 0.01. */
export const EXPECTED_NET = 990_000_000n;
export const EXPECTED_BURN = 10_000_000n;
export const MIN_SENDER_BALANCE = 2n * NANO_PER_BURN;
/** Recommended burn-only attach — matches tests/helpers.ts TRANSFER_TON. */
export const TRANSFER_TON = toNano('0.8');

/** Recipient env: card name first, then legacy verify-burn name. */
export function parseRecipientAddress(): Address | undefined {
    for (const key of ['VERIFY_RECIPIENT', 'BURN_TEST_RECIPIENT']) {
        const raw = process.env[key]?.trim();
        if (raw) {
            return Address.parse(raw);
        }
    }
    return undefined;
}

/** TEP-74 jetton wallets deploy lazily; until then get_wallet_data throws (exit -13) → 0. */
export async function readJettonWalletBalance(
    provider: NetworkProvider,
    jettonMaster: Address,
    owner: Address,
): Promise<bigint> {
    try {
        const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
        const walletAddr = await master.getGetWalletAddress(owner);
        const wallet = provider.open(BurnJettonWallet.fromAddress(walletAddr));
        const data = await wallet.getGetWalletData();
        return data.balance;
    } catch {
        return 0n;
    }
}

export function checkLiveBurnBalances(input: {
    netReceived: bigint;
    supplyDelta: bigint;
}): CheckResult[] {
    return [
        assertCheck(
            input.netReceived === EXPECTED_NET,
            `recipient received ${input.netReceived} nano (expected ${EXPECTED_NET} = 0.99 BURN)`,
        ),
        assertCheck(
            input.supplyDelta === -EXPECTED_BURN,
            `totalSupply decreased by ${-input.supplyDelta} nano (expected ${EXPECTED_BURN} = 0.01 BURN)`,
        ),
    ];
}
