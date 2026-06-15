import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { NANO_PER_BURN } from './helpers';
import {
    advanceTime,
    MIN_STAKE_NANO,
    mintAndSyncUser,
    setupStakingEnvironment,
    stakeAs,
    tickEmissionViaMicroUnstake,
    TOTAL_EMISSION_BUDGET_NANO,
} from './staking-helpers';
import '@ton/test-utils';

// IMP-PREMNT-04 — staking pool solvency: emission accrues only up to the funded reserve,
// unstake always returns the staked body, rewards degrade on underfunding, and tickEmission
// with no stakers neither consumes the budget nor desyncs the accounting.
describe('IMP-PREMNT-04 — staking pool solvency', () => {
    describe('Emission funding gate', () => {
        it('emission does not accrue while the reserve is unfunded (emissionFunded = 0)', async () => {
            const env = await setupStakingEnvironment('https://example.com/imp-premnt-04-unfunded.json');
            const user = await env.blockchain.treasury('unfunded-staker');

            await mintAndSyncUser(env, user, MIN_STAKE_NANO * 4n);
            await stakeAs(env, user, 0, MIN_STAKE_NANO * 2n);

            expect(await env.stakingMaster.getGetEmissionFunded()).toBe(0n);

            advanceTime(env.blockchain, 1000);
            await tickEmissionViaMicroUnstake(env, user);

            expect(await env.stakingMaster.getGetEmittedSoFar()).toBe(0n);
            expect(await env.stakingMaster.getGetRewardPerShare(0n)).toBe(0n);
        });

        it('emission accrual is clamped to the funded reserve, never beyond', async () => {
            const env = await setupStakingEnvironment('https://example.com/imp-premnt-04-clamp.json');
            const user = await env.blockchain.treasury('clamp-staker');

            await mintAndSyncUser(env, user, MIN_STAKE_NANO * 4n);
            await stakeAs(env, user, 0, MIN_STAKE_NANO * 2n);

            // Fund a tiny reserve far below what the elapsed time alone would emit.
            const reserve = 500_000n;
            await env.stakingMaster.sendFundEmissionReserve(env.deployer.getSender(), reserve);
            expect(await env.stakingMaster.getGetEmissionFunded()).toBe(reserve);

            // 1000s * 3170 nano/s = 3_170_000 nano of time-based emission >> reserve.
            advanceTime(env.blockchain, 1000);
            await tickEmissionViaMicroUnstake(env, user);
            expect(await env.stakingMaster.getGetEmittedSoFar()).toBe(reserve);

            // Reserve exhausted: a further tick must not emit a single nano more.
            advanceTime(env.blockchain, 1000);
            await tickEmissionViaMicroUnstake(env, user);
            expect(await env.stakingMaster.getGetEmittedSoFar()).toBe(reserve);
        });

        it('rejects FundEmissionReserve from a non-bootstrap caller and above the budget', async () => {
            const env = await setupStakingEnvironment('https://example.com/imp-premnt-04-fundguard.json');
            const outsider = await env.blockchain.treasury('fund-outsider');

            const rogue = await env.stakingMaster.sendFundEmissionReserve(outsider.getSender(), 100n);
            expect(rogue.transactions).toHaveTransaction({
                on: env.stakingMaster.address,
                success: false,
                exitCode: StakingMaster_errors_backward['Only bootstrap'],
            });
            expect(await env.stakingMaster.getGetEmissionFunded()).toBe(0n);

            await env.stakingMaster.sendFundEmissionReserve(env.deployer.getSender(), TOTAL_EMISSION_BUDGET_NANO);
            expect(await env.stakingMaster.getGetEmissionFunded()).toBe(TOTAL_EMISSION_BUDGET_NANO);

            const overflow = await env.stakingMaster.sendFundEmissionReserve(env.deployer.getSender(), 1n);
            expect(overflow.transactions).toHaveTransaction({
                on: env.stakingMaster.address,
                success: false,
                exitCode: StakingMaster_errors_backward['Exceeds emission budget'],
            });
            expect(await env.stakingMaster.getGetEmissionFunded()).toBe(TOTAL_EMISSION_BUDGET_NANO);
        });
    });

    describe('tickEmission with no stakers', () => {
        it('forfeits the empty window without consuming budget or desyncing accounting', async () => {
            const env = await setupStakingEnvironment('https://example.com/imp-premnt-04-nostakers.json');
            const alice = await env.blockchain.treasury('zero-alice');
            const bob = await env.blockchain.treasury('zero-bob');

            await env.stakingMaster.sendFundEmissionReserve(env.deployer.getSender(), TOTAL_EMISSION_BUDGET_NANO);

            await mintAndSyncUser(env, alice, MIN_STAKE_NANO * 4n);
            await stakeAs(env, alice, 0, MIN_STAKE_NANO * 2n);

            advanceTime(env.blockchain, 600);
            await tickEmissionViaMicroUnstake(env, alice);
            const emittedWithAlice = await env.stakingMaster.getGetEmittedSoFar();
            expect(emittedWithAlice).toBeGreaterThan(0n);

            // Alice fully exits → no stakers remain.
            const aliceStake = await env.stakingMaster.getGetStake(alice.address, 0n);
            expect(aliceStake).not.toBeNull();
            await env.stakingMaster.sendUnstakeJetton(alice.getSender(), { tier: 0, amount: aliceStake!.amount });
            expect(await env.stakingMaster.getGetStake(alice.address, 0n)).toBeNull();
            expect(await env.stakingMaster.getGetMasterTotalStake(0n)).toBe(0n);
            const emittedNoStakers = await env.stakingMaster.getGetEmittedSoFar();

            // Long empty window: emission must NOT advance while there are no stakers.
            advanceTime(env.blockchain, 10_000);
            await mintAndSyncUser(env, bob, MIN_STAKE_NANO * 4n);
            await stakeAs(env, bob, 0, MIN_STAKE_NANO * 2n);
            expect(await env.stakingMaster.getGetEmittedSoFar()).toBe(emittedNoStakers);

            // Emission resumes deterministically once a staker is present again.
            advanceTime(env.blockchain, 600);
            await tickEmissionViaMicroUnstake(env, bob);
            expect(await env.stakingMaster.getGetEmittedSoFar()).toBeGreaterThan(emittedNoStakers);
        });
    });

    describe('Unstake under reward underfunding', () => {
        it('returns the full staked body and degrades reward to zero when reward funding is absent', async () => {
            const env = await setupStakingEnvironment('https://example.com/imp-premnt-04-degrade.json');
            const user = await env.blockchain.treasury('degrade-staker');

            const principal = 5n * NANO_PER_BURN;
            await mintAndSyncUser(env, user, principal);
            await stakeAs(env, user, 0, principal);

            const userJw = env.blockchain.openContract(
                BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
            );
            expect((await userJw.getGetWalletData()).balance).toBe(0n);
            expect(await env.pool.getGetPoolBalance()).toBe(principal);

            // Accrue a large reward into rewardPerShare WITHOUT any real reward funding in the pool
            // (RelayStakeFeeAccrual bumps bookkeeping only). pending now exceeds reward funding (0).
            const masterSender = env.blockchain.sender(env.stakingMaster.address);
            await env.pool.sendRelayStakeFeeAccrual(masterSender, 1000n * NANO_PER_BURN);
            const pending = await env.stakingMaster.getGetPendingReward(user.address, 0n);
            expect(pending).toBeGreaterThan(0n);

            const un = await env.stakingMaster.sendUnstakeJetton(user.getSender(), { tier: 0, amount: principal });
            expect(un.transactions).toHaveTransaction({ success: true });

            // Stake body fully returned; phantom reward NOT paid; pool bookkeeping drained to zero.
            expect(await env.stakingMaster.getGetStake(user.address, 0n)).toBeNull();
            expect((await userJw.getGetWalletData()).balance).toBe(principal);
            expect(await env.pool.getGetPoolBalance()).toBe(0n);
            expect(await env.pool.getGetTotalStake(0n)).toBe(0n);
        });
    });
});
