/**
 * IMP-CIP-12 — warm-path attach must sit above the JW fee-path gate (1.0)
 * and well below the historical 3.5 / 4 / 5 TON pads.
 *
 * Pre-cut: claim 2.0 fails `Low TON claim` (gate 3.56). Stake forward 2.0
 * falls in the 3.5–3.7 refund window and does not record a stake.
 */
import { toNano } from '@ton/core';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import {
    advanceTime,
    fundEmissionReserveViaMint,
    mintAndSyncUser,
    setupStakingEnvironment,
    stakeAsWithForward,
    NANO_PER_BURN,
    TOTAL_EMISSION_BUDGET_NANO,
} from './staking-helpers';
import '@ton/test-utils';

/** Target GasPayRewards / GasForwardStakeJetton / PayRewardsTon. */
const PAYOUT_TON = toNano('1.5');
/** STAKE_FORWARD after cut: 1.5 + 2*0.06 + 0.08 = 1.70 minNotify + headroom. */
const STAKE_FORWARD_CUT = toNano('2');
/** Claim attach: GasPayRewards + 0.06 + margin. */
const CLAIM_ATTACH_CUT = toNano('2');
/** Unstake attach: GasPayRewards + GasToPool + 0.08 + margin. */
const UNSTAKE_ATTACH_CUT = toNano('2.1');

describe('IMP-CIP-12 — warm-path gas cut', () => {
    it('stake with 2 TON forward records (no bounce, no refund window)', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip12-stake-fwd.json');
        const user = await env.blockchain.treasury('cip12-staker');
        const amt = 2n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, amt);

        const tx = await stakeAsWithForward(env, user, 0, amt, STAKE_FORWARD_CUT);
        expect(tx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect((await env.stakingMaster.getGetStake(user.address, 0n))!.amount).toBe(amt);
        expect(STAKE_FORWARD_CUT).toBeLessThan(toNano('3.5'));
        expect(STAKE_FORWARD_CUT).toBeGreaterThan(PAYOUT_TON);
    });

    it('claim with 2 TON attach pays out without Low TON claim', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip12-claim-cut.json');
        const user = await env.blockchain.treasury('cip12-claimer');
        await fundEmissionReserveViaMint(env, TOTAL_EMISSION_BUDGET_NANO);
        const principal = 10n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, principal);
        await stakeAsWithForward(env, user, 0, principal, toNano('5'));
        advanceTime(env.blockchain, 600);

        const claim = await env.stakingMaster.send(user.getSender(), { value: CLAIM_ATTACH_CUT }, {
            $$type: 'ClaimRewards',
            queryId: 0n,
            tier: 0n,
        });
        expect(claim.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect(claim.transactions).not.toHaveTransaction({
            on: env.stakingMaster.address,
            exitCode: StakingMaster_errors_backward['Low TON claim'],
        });
        const userJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
        );
        expect((await userJw.getGetWalletData()).balance).toBeGreaterThan(0n);
        expect(CLAIM_ATTACH_CUT).toBeLessThan(toNano('3.5'));
    });

    it('unstake with 2.1 TON attach returns principal without Low TON unstake', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip12-unstake-cut.json');
        const user = await env.blockchain.treasury('cip12-unstaker');
        await fundEmissionReserveViaMint(env, TOTAL_EMISSION_BUDGET_NANO);
        const principal = 5n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, principal);
        await stakeAsWithForward(env, user, 0, principal, toNano('5'));

        const unstake = await env.stakingMaster.send(user.getSender(), { value: UNSTAKE_ATTACH_CUT }, {
            $$type: 'UnstakeJetton',
            queryId: 0n,
            tier: 0n,
            amount: principal,
        });
        expect(unstake.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect(unstake.transactions).not.toHaveTransaction({
            on: env.stakingMaster.address,
            exitCode: StakingMaster_errors_backward['Low TON unstake'],
        });
        const userJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
        );
        expect((await userJw.getGetWalletData()).balance).toBeGreaterThanOrEqual(principal);
        expect(UNSTAKE_ATTACH_CUT).toBeLessThan(toNano('3.5'));
    });
});
