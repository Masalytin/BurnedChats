/**
 * fs-staking-claim-rewards — ClaimRewards credits wallet; immediate re-claim does not double-pay.
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { readJettonWalletBalance } from '../lib/balances';
import {
    checkClaimNoDoublePay,
    FLEXIBLE_TIER,
    naWhenZeroPending,
    openStakingMaster,
    readPendingReward,
    resolveStaker,
    sleepMs,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenZeroPending(ctx, FLEXIBLE_TIER);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const staker = resolveStaker(ctx);
    const walletSender = provider.sender().address;
    if (!walletSender || !walletSender.equals(staker)) {
        throw new Error('Mnemonic wallet must equal stake sender for claim.');
    }

    const stakingMasterAddr = Address.parse(manifest.addresses.stakingMaster);
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const tier = FLEXIBLE_TIER;
    const master = openStakingMaster(ctx);

    const pendingBefore = await readPendingReward(provider, stakingMasterAddr, staker, tier);
    if (pendingBefore <= 0n) {
        throw new Error('pending reward is 0 after naWhen');
    }

    const walletBefore = await readJettonWalletBalance(provider, jettonMaster, staker);

    let seqno = await getSenderSeqno(provider);
    await master.sendClaimRewards(provider.sender(), { tier });
    await waitForSenderSeqnoIncrement(provider, seqno);
    await sleepMs(10_000);
    const walletAfterFirst = await readJettonWalletBalance(provider, jettonMaster, staker);

    seqno = await getSenderSeqno(provider);
    await master.sendClaimRewards(provider.sender(), { tier });
    await waitForSenderSeqnoIncrement(provider, seqno);
    await sleepMs(10_000);
    const walletAfterSecond = await readJettonWalletBalance(provider, jettonMaster, staker);

    return checkClaimNoDoublePay({
        walletBefore,
        walletAfterFirst,
        walletAfterSecond,
        pendingBefore,
    });
}

export const scenario: Scenario = {
    id: 'fs-staking-claim-rewards',
    title: 'Claim rewards (no double-pay)',
    description:
        'ClaimRewards increases jetton wallet; immediate re-claim does not credit again (no inflation).',
    tags: ['staking'],
    needsLiveTx: true,
    depends_on: ['fs-staking-stake-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
