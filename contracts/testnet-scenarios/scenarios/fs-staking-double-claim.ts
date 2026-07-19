/**
 * fs-staking-double-claim — second claim without new accrual → 0 credit / no inflation.
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { check } from '../lib/checks';
import { readJettonWalletBalance } from '../lib/balances';
import {
    FLEXIBLE_TIER,
    NA_ZERO_PENDING,
    naWhenStakerSenderReady,
    openStakingMaster,
    readPendingReward,
    resolveStaker,
    sleepMs,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/**
 * Runs after claim-rewards. Pending should already be drained; assert a further claim
 * does not inflate the wallet. If pending somehow accrued again, claim once then assert
 * the next attempt pays 0.
 */
export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const senderNa = naWhenStakerSenderReady(ctx);
    if (senderNa) {
        return senderNa;
    }
    try {
        resolveStaker(ctx);
        return null;
    } catch {
        return NA_ZERO_PENDING;
    }
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

    const stakingMasterAddr = Address.parse(manifest.addresses.stakingMaster);
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const tier = FLEXIBLE_TIER;
    const master = openStakingMaster(ctx);

    let pending = await readPendingReward(provider, stakingMasterAddr, staker, tier);
    if (pending > 0n) {
        // Drain first so the probe is a true second claim.
        const seqno = await getSenderSeqno(provider);
        await master.sendClaimRewards(provider.sender(), { tier });
        await waitForSenderSeqnoIncrement(provider, seqno);
        await sleepMs(10_000);
        pending = await readPendingReward(provider, stakingMasterAddr, staker, tier);
    }

    const walletBefore = await readJettonWalletBalance(provider, jettonMaster, staker);
    const seqnoBefore = await getSenderSeqno(provider);
    await master.sendClaimRewards(provider.sender(), { tier });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(10_000);
    const walletAfter = await readJettonWalletBalance(provider, jettonMaster, staker);
    const pendingAfter = await readPendingReward(provider, stakingMasterAddr, staker, tier);
    const gain = walletAfter - walletBefore;

    return [
        check(
            'second-claim-zero',
            gain === 0n,
            `second claim wallet delta ${gain} (expected 0; pending was ${pending})`,
        ),
        check(
            'no-pending-inflation',
            pendingAfter === 0n,
            `pending after second claim ${pendingAfter} (expected 0)`,
        ),
    ];
}

export const scenario: Scenario = {
    id: 'fs-staking-double-claim',
    title: 'Double claim (no inflation)',
    description:
        'Second ClaimRewards without new accrual credits 0 (or rejects); wallet/pending do not inflate.',
    tags: ['staking', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-staking-claim-rewards'],
    naWhen,
    run: runChecks,
};

export default scenario;
