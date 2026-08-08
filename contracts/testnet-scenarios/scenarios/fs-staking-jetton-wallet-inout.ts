/**
 * fs-staking-jetton-wallet-inout — stake in / unstake out conserve excluded-fee rules.
 */
import { Address, toNano } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { readJettonWalletBalance } from '../lib/balances';
import {
    checkExcludedWalletInOut,
    FLEXIBLE_TIER,
    MIN_STAKE_NANO,
    naWhenInsufficientBurn,
    openStakingMaster,
    readPendingReward,
    readStakeAmount,
    requireStakingPoolAddr,
    resolveStaker,
    sendStakeJettons,
    sleepMs,
    STAKE_ATTACHED_TON,
    waitForStakeAtLeast,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenInsufficientBurn(ctx, MIN_STAKE_NANO);
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

    const jettonMasterAddr = Address.parse(manifest.addresses.jettonMaster);
    const stakingMasterAddr = Address.parse(manifest.addresses.stakingMaster);
    const poolAddr = requireStakingPoolAddr(ctx);
    const jetton = provider.open(BurnJettonMaster.fromAddress(jettonMasterAddr));
    const master = openStakingMaster(ctx);
    const tier = FLEXIBLE_TIER;
    const amount = MIN_STAKE_NANO;

    const stakingMasterExcluded = await jetton.getGetIsExcluded(stakingMasterAddr);
    const stakingPoolExcluded = await jetton.getGetIsExcluded(poolAddr);

    // Top-up with pending rewards auto-claims into the JW (master merge path) —
    // capture pending so transfer-in-full allows that credit (live −9983199 vs −10M).
    const pendingBefore = await readPendingReward(provider, stakingMasterAddr, staker, tier);

    const walletBeforeStake = await readJettonWalletBalance(provider, jettonMasterAddr, staker);
    const stakeBefore = await readStakeAmount(provider, stakingMasterAddr, staker, tier);

    const seqnoStake = await getSenderSeqno(provider);
    await sendStakeJettons(ctx, { amount, tier, staker });
    await waitForSenderSeqnoIncrement(provider, seqnoStake);
    await waitForStakeAtLeast(provider, stakingMasterAddr, staker, tier, stakeBefore + amount);
    await sleepMs(5_000);

    const walletAfterStake = await readJettonWalletBalance(provider, jettonMasterAddr, staker);
    const userDeltaOnStake = walletAfterStake - walletBeforeStake;

    const walletBeforeUnstake = walletAfterStake;
    const seqnoUnstake = await getSenderSeqno(provider);
    await master.sendUnstakeJetton(provider.sender(), { tier, amount });
    await waitForSenderSeqnoIncrement(provider, seqnoUnstake);
    await sleepMs(12_000);
    const walletAfterUnstake = await readJettonWalletBalance(provider, jettonMasterAddr, staker);
    const userDeltaOnUnstake = walletAfterUnstake - walletBeforeUnstake;

    return checkExcludedWalletInOut({
        stakingMasterExcluded,
        stakingPoolExcluded,
        transferInAmount: amount,
        userDeltaOnStake,
        userDeltaOnUnstake,
        pendingBefore,
    });
}

export const scenario: Scenario = {
    id: 'fs-staking-jetton-wallet-inout',
    title: 'Staking JW in/out (excluded fee)',
    description:
        'Stake transfer-in and unstake payout conserve full amount — stakingMaster/pool fee-excluded.',
    tags: ['staking'],
    needsLiveTx: true,
    depends_on: ['fs-staking-stake-happy'],
    naWhen,
    run: runChecks,
    budget: { signer: 'actor', minTon: STAKE_ATTACHED_TON + toNano('0.2') },
};

export default scenario;
