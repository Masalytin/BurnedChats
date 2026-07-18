/**
 * fs-staking-unstake-happy — UnstakeJetton returns principal (Flexible).
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { NANO_PER_BURN, readJettonWalletBalance } from '../lib/balances';
import {
    checkUnstakeReturned,
    FLEXIBLE_TIER,
    MIN_STAKE_NANO,
    naWhenNoOpenStake,
    openStakingMaster,
    readStakeAmount,
    resolveStaker,
    sleepMs,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** Partial unstake slice (1 BURN) when stake is large enough. */
const STAKE_AMOUNT_SLICE = 1n * NANO_PER_BURN;

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenNoOpenStake(ctx, FLEXIBLE_TIER);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const staker = resolveStaker(ctx);
    const walletSender = provider.sender().address;
    if (!walletSender || !walletSender.equals(staker)) {
        throw new Error('Mnemonic wallet must equal stake sender for unstake.');
    }

    const stakingMasterAddr = Address.parse(manifest.addresses.stakingMaster);
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const tier = FLEXIBLE_TIER;
    const master = openStakingMaster(ctx);

    const stakeBefore = await readStakeAmount(provider, stakingMasterAddr, staker, tier);
    if (stakeBefore < MIN_STAKE_NANO) {
        throw new Error(`open Flexible stake ${stakeBefore} < MIN_STAKE after naWhen`);
    }
    // Unstake a slice so claim/gov packs can keep residual VP when possible.
    const amount = stakeBefore > STAKE_AMOUNT_SLICE * 2n ? STAKE_AMOUNT_SLICE : stakeBefore;

    const walletBefore = await readJettonWalletBalance(provider, jettonMaster, staker);
    const seqnoBefore = await getSenderSeqno(provider);
    await master.sendUnstakeJetton(provider.sender(), { tier, amount });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(10_000);

    const stakeAfter = await readStakeAmount(provider, stakingMasterAddr, staker, tier);
    const walletAfter = await readJettonWalletBalance(provider, jettonMaster, staker);

    return checkUnstakeReturned({
        stakeBefore,
        stakeAfter,
        walletBefore,
        walletAfter,
        amount,
    });
}

export const scenario: Scenario = {
    id: 'fs-staking-unstake-happy',
    title: 'Unstake happy (Flexible)',
    description:
        'UnstakeJetton on Flexible tier returns principal to user jetton wallet; stake map decreases.',
    tags: ['staking'],
    needsLiveTx: true,
    depends_on: ['fs-staking-stake-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
