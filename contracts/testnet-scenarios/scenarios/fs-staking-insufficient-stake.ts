/**
 * fs-staking-insufficient-stake — below MinStakeNano (0.01 BURN) refunded / not credited.
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { readJettonWalletBalance } from '../lib/balances';
import {
    checkInsufficientStakeRejected,
    FLEXIBLE_TIER,
    naWhenInsufficientBurn,
    readStakeAmount,
    resolveStaker,
    sendStakeJettons,
    sleepMs,
    SUB_MIN_STAKE_NANO,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    // Need sub-min amount available to attempt (refunded).
    return naWhenInsufficientBurn(ctx, SUB_MIN_STAKE_NANO);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const staker = resolveStaker(ctx);
    const walletSender = provider.sender().address;
    if (!walletSender || !walletSender.equals(staker)) {
        throw new Error(
            `Blueprint signer must equal Actor A stake sender ${staker.toString()} (set TEST_ACTOR_MNEMONIC).`,
        );
    }

    const stakingMaster = Address.parse(manifest.addresses.stakingMaster);
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const tier = FLEXIBLE_TIER;

    const stakeBefore = await readStakeAmount(provider, stakingMaster, staker, tier);
    const walletBefore = await readJettonWalletBalance(provider, jettonMaster, staker);

    const seqnoBefore = await getSenderSeqno(provider);
    await sendStakeJettons(ctx, { amount: SUB_MIN_STAKE_NANO, tier, staker });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    // Refund path needs indexing lag.
    await sleepMs(15_000);

    const stakeAfter = await readStakeAmount(provider, stakingMaster, staker, tier);
    const walletAfter = await readJettonWalletBalance(provider, jettonMaster, staker);

    return checkInsufficientStakeRejected({
        stakeBefore,
        stakeAfter,
        walletBefore,
        walletAfter,
        attempted: SUB_MIN_STAKE_NANO,
    });
}

export const scenario: Scenario = {
    id: 'fs-staking-insufficient-stake',
    title: 'Insufficient stake (sub-min refund)',
    description:
        'Stake below MinStakeNano (0.01 BURN) is not credited; jettons refunded to sender wallet.',
    tags: ['staking', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-staking-master-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
