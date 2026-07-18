/**
 * Jetton balance / fee-config helpers + full-stack fee constants (0.5/0.3/0.2).
 */
import { Address } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { readJettonWalletBalance as readBalanceFromBootstrap } from '../../scripts/deploy/bootstrap';

/** 1 BURN in nano. */
export const NANO_PER_BURN = 10n ** 9n;
/** Live fee-split transfer size. */
export const TRANSFER_AMOUNT = 1n * NANO_PER_BURN;
/** Recipient net after 1% total fee (0.99 BURN). */
export const EXPECTED_NET = 990_000_000n;
/** Burn leg 0.5% of 1 BURN. */
export const EXPECTED_BURN = 5_000_000n;
/** Staking pool leg 0.3% of 1 BURN. */
export const EXPECTED_STAKING = 3_000_000n;
/** Treasury leg 0.2% of 1 BURN. */
export const EXPECTED_TREASURY = 2_000_000n;
export const MIN_SENDER_BALANCE = 2n * NANO_PER_BURN;
/** Wallet get_fee_config_active false / inactive fee config. */
export const EXIT_FEE_CONFIG_INACTIVE = 21507;

export const FEE_SPLIT_EXPECTED = {
    net: EXPECTED_NET,
    burn: EXPECTED_BURN,
    staking: EXPECTED_STAKING,
    treasury: EXPECTED_TREASURY,
} as const;

export function parseEnvAddress(...keys: string[]): Address | undefined {
    for (const key of keys) {
        const raw = process.env[key]?.trim();
        if (raw) {
            return Address.parse(raw);
        }
    }
    return undefined;
}

export async function readJettonWalletBalance(
    provider: NetworkProvider,
    jettonMaster: Address,
    owner: Address,
): Promise<bigint> {
    return readBalanceFromBootstrap(provider, jettonMaster, owner);
}

export async function readFeeConfigActive(
    provider: NetworkProvider,
    master: Address,
    owner: Address,
): Promise<boolean> {
    try {
        const m = provider.open(BurnJettonMaster.fromAddress(master));
        const walletAddr = await m.getGetWalletAddress(owner);
        const wallet = provider.open(BurnJettonWallet.fromAddress(walletAddr));
        return await wallet.getGetFeeConfigActive();
    } catch {
        return false;
    }
}

export async function assertSenderFeePreflight(
    provider: NetworkProvider,
    jettonMaster: Address,
    sender: Address,
    balance: bigint,
): Promise<void> {
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const excluded = await master.getGetIsExcluded(sender);
    if (excluded) {
        throw new Error(
            `FEE_TEST_SENDER ${sender.toString()} is fee-excluded on master — use a non-excluded smoke wallet.`,
        );
    }

    const feeActive = await readFeeConfigActive(provider, jettonMaster, sender);
    if (!feeActive) {
        const err = new Error(
            `Sender jetton wallet has get_fee_config_active=false (exit ${EXIT_FEE_CONFIG_INACTIVE}). ` +
                `Run SYNC_FEE_OWNER=${sender.toString({ urlSafe: true, bounceable: true })} npm run sync:fee:testnet ` +
                `or redeploy with fee propagate fix.`,
        );
        (err as NodeJS.ErrnoException).code = String(EXIT_FEE_CONFIG_INACTIVE);
        throw err;
    }

    if (balance < MIN_SENDER_BALANCE) {
        throw new Error(
            `Sender balance ${balance} nano < ${MIN_SENDER_BALANCE} nano (need ≥ 2 BURN for 1 BURN transfer + fees).`,
        );
    }
}
