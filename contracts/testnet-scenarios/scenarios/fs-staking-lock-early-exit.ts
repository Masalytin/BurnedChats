/**
 * fs-staking-lock-early-exit — early UnstakeJetton on locked tier is rejected (Still locked).
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { readJettonWalletBalance } from '../lib/balances';
import {
    checkEarlyExitRejected,
    LOCKED_TIER,
    lockDurationNaReason,
    MIN_STAKE_NANO,
    naWhenInsufficientBurn,
    naWhenStakerSenderReady,
    openStakingLock,
    openStakingMaster,
    readStakeAmount,
    resolveStaker,
    sendStakeJettons,
    sleepMs,
    waitForStakeAtLeast,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const senderNa = naWhenStakerSenderReady(ctx);
    if (senderNa) {
        return senderNa;
    }
    const lock = openStakingLock(ctx);
    let duration = 0n;
    try {
        const cfg = await lock.getGetLockConfig(BigInt(LOCKED_TIER));
        duration = cfg.durationSeconds;
    } catch {
        return 'tier has no lock / N/A in code';
    }
    const noLock = lockDurationNaReason(duration);
    if (noLock) {
        return noLock;
    }

    const staker = resolveStaker(ctx);
    const stakingMaster = Address.parse(ctx.manifest.addresses.stakingMaster);
    const existing = await readStakeAmount(ctx.provider, stakingMaster, staker, LOCKED_TIER);
    if (existing >= MIN_STAKE_NANO) {
        return null;
    }
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

    const stakingMasterAddr = Address.parse(manifest.addresses.stakingMaster);
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const tier = LOCKED_TIER;
    const lock = openStakingLock(ctx);
    const master = openStakingMaster(ctx);

    const cfg = await lock.getGetLockConfig(BigInt(tier));
    const lockDurationSeconds = cfg.durationSeconds;

    let stakeBefore = await readStakeAmount(provider, stakingMasterAddr, staker, tier);
    if (stakeBefore < MIN_STAKE_NANO) {
        const bal = await readJettonWalletBalance(provider, jettonMaster, staker);
        if (bal < MIN_STAKE_NANO) {
            throw new Error('insufficient BURN to open locked stake after naWhen');
        }
        const seqno = await getSenderSeqno(provider);
        await sendStakeJettons(ctx, { amount: MIN_STAKE_NANO, tier, staker });
        await waitForSenderSeqnoIncrement(provider, seqno);
        stakeBefore = await waitForStakeAtLeast(
            provider,
            stakingMasterAddr,
            staker,
            tier,
            MIN_STAKE_NANO,
        );
    }

    const amount = MIN_STAKE_NANO <= stakeBefore ? MIN_STAKE_NANO : stakeBefore;
    const seqnoBefore = await getSenderSeqno(provider);
    await master.sendUnstakeJetton(provider.sender(), { tier, amount });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(10_000);

    const stakeAfter = await readStakeAmount(provider, stakingMasterAddr, staker, tier);

    return checkEarlyExitRejected({
        stakeBefore,
        stakeAfter,
        lockDurationSeconds,
    });
}

export const scenario: Scenario = {
    id: 'fs-staking-lock-early-exit',
    title: 'Lock early-exit reject',
    description:
        'Early UnstakeJetton on Silver (locked) leaves stake unchanged — tact Still locked (no penalty path).',
    tags: ['staking', 'lock'],
    needsLiveTx: true,
    depends_on: ['fs-staking-stake-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
