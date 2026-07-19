/**
 * fs-staking-stake-happy — stake via JettonNotification+StakeForward (Flexible tier).
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { readJettonWalletBalance } from '../lib/balances';
import {
    checkStakeMapUpdated,
    FLEXIBLE_TIER,
    naWhenInsufficientBurn,
    readPoolTotalStake,
    readStakeAmount,
    requireStakingPoolAddr,
    resolveStaker,
    sendStakeJettons,
    STAKE_AMOUNT_HAPPY,
    waitForStakeAtLeast,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenInsufficientBurn(ctx, STAKE_AMOUNT_HAPPY);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const staker = resolveStaker(ctx);
    const walletSender = provider.sender().address;
    if (!walletSender || !walletSender.equals(staker)) {
        // naWhen should have returned NA_TEST_ACTOR_* — safety net only.
        throw new Error(
            `Blueprint signer must equal Actor A stake sender ${staker.toString()} (set TEST_ACTOR_MNEMONIC).`,
        );
    }

    const stakingMaster = Address.parse(manifest.addresses.stakingMaster);
    const pool = requireStakingPoolAddr(ctx);
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const tier = FLEXIBLE_TIER;

    const stakeBefore = await readStakeAmount(provider, stakingMaster, staker, tier);
    const poolBefore = await readPoolTotalStake(provider, pool, tier);
    const bal = await readJettonWalletBalance(provider, jettonMaster, staker);

    // Idempotent: already staked enough for this run.
    if (stakeBefore >= STAKE_AMOUNT_HAPPY) {
        return checkStakeMapUpdated({
            stakeBefore: stakeBefore - STAKE_AMOUNT_HAPPY,
            stakeAfter: stakeBefore,
            poolBefore: poolBefore >= STAKE_AMOUNT_HAPPY ? poolBefore - STAKE_AMOUNT_HAPPY : 0n,
            poolAfter: poolBefore,
            amount: STAKE_AMOUNT_HAPPY,
            tier,
        }).map((c) =>
            c.name === 'stake-map-updated'
                ? {
                      ...c,
                      message: `${c.message} (idempotent — Flexible stake already ≥ ${STAKE_AMOUNT_HAPPY})`,
                  }
                : c,
        );
    }

    if (bal < STAKE_AMOUNT_HAPPY) {
        throw new Error(`staker BURN ${bal} < ${STAKE_AMOUNT_HAPPY} after naWhen`);
    }

    const seqnoBefore = await getSenderSeqno(provider);
    await sendStakeJettons(ctx, { amount: STAKE_AMOUNT_HAPPY, tier, staker });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    const stakeAfter = await waitForStakeAtLeast(
        provider,
        stakingMaster,
        staker,
        tier,
        stakeBefore + STAKE_AMOUNT_HAPPY,
    );
    const poolAfter = await readPoolTotalStake(provider, pool, tier);

    return checkStakeMapUpdated({
        stakeBefore,
        stakeAfter,
        poolBefore,
        poolAfter,
        amount: STAKE_AMOUNT_HAPPY,
        tier,
    });
}

export const scenario: Scenario = {
    id: 'fs-staking-stake-happy',
    title: 'Stake happy (Flexible)',
    description:
        'Stake via JettonNotification+StakeForward into Flexible tier; assert stake map + pool total updated.',
    tags: ['staking'],
    needsLiveTx: true,
    depends_on: ['fs-staking-master-smoke', 'fs-jetton-fee-split'],
    naWhen,
    run: runChecks,
};

export default scenario;
