import { StakingMaster } from '../wrappers/StakingMaster';
import {
    advanceTime,
    EMISSION_NANO_PER_SEC,
    fundEmissionReserveViaMint,
    MIN_STAKE_NANO,
    mintAndSyncUser,
    setupStakingEnvironment,
    stakeAs,
    tickEmissionViaMicroUnstake,
    TOTAL_EMISSION_BUDGET_NANO,
} from './staking-helpers';
import '@ton/test-utils';

const REWARD_SCALE = StakingMaster.RewardScale;

/** Default TOKENOMICS reward shares (must sum to 100). */
const SHARE_FLEXIBLE = 5n;
const SHARE_SILVER = 10n;
const SHARE_GOLD = 25n;
const SHARE_DIAMOND = 60n;

/**
 * IMP-FAUDIT-F03 / F-1 — empty-tier emission slices must not orphan budget into
 * inaccessible pool_balance. Variant (a): only credit / consume the sum of
 * slices that actually land in non-empty tiers' rewardPerShare.
 */
describe('IMP-FAUDIT-F03 — emission orphan empty tiers', () => {
    it('Flexible-only stake: tickEmission does not leak empty-tier slices into pool_balance or emittedSoFar', async () => {
        const env = await setupStakingEnvironment('https://example.com/imp-faudit-f03-orphan.json');
        const user = await env.blockchain.treasury('orphan-flex');

        await fundEmissionReserveViaMint(env, TOTAL_EMISSION_BUDGET_NANO);

        const principal = MIN_STAKE_NANO * 2n;
        await mintAndSyncUser(env, user, principal * 2n);
        await stakeAs(env, user, 0, principal);

        expect(await env.stakingMaster.getGetMasterTotalStake(0n)).toBe(principal);
        expect(await env.stakingMaster.getGetMasterTotalStake(1n)).toBe(0n);
        expect(await env.stakingMaster.getGetMasterTotalStake(2n)).toBe(0n);
        expect(await env.stakingMaster.getGetMasterTotalStake(3n)).toBe(0n);

        const poolBefore = await env.pool.getGetPoolBalance();
        expect(poolBefore).toBe(principal);

        const elapsed = 1_000;
        advanceTime(env.blockchain, elapsed);
        const tx = await tickEmissionViaMicroUnstake(env, user);
        expect(tx.transactions).toHaveTransaction({ success: true });

        const pendingFull = BigInt(elapsed) * EMISSION_NANO_PER_SEC;
        // Only Flexible (5%) has stake — empty-tier slices must be forfeited, not credited.
        const distributed = (pendingFull * SHARE_FLEXIBLE) / 100n;
        expect(distributed).toBeGreaterThan(0n);
        expect(distributed).toBeLessThan(pendingFull);

        const emitted = await env.stakingMaster.getGetEmittedSoFar();
        expect(emitted).toBe(distributed);

        const rps0 = await env.stakingMaster.getGetRewardPerShare(0n);
        const expectedRps = (distributed * REWARD_SCALE) / principal;
        expect(rps0).toBe(expectedRps);

        // Empty tiers must not receive RPS from this tick.
        expect(await env.stakingMaster.getGetRewardPerShare(1n)).toBe(0n);
        expect(await env.stakingMaster.getGetRewardPerShare(2n)).toBe(0n);
        expect(await env.stakingMaster.getGetRewardPerShare(3n)).toBe(0n);

        // Micro-unstake pays 1 nano principal + full Flexible pending (== distributed, debt was 0).
        // If empty-tier slices had been credited to pool_balance they would remain as inaccessible
        // funding (not in RPS → not paid) — so pool would be principal - 1 + orphan.
        // With the fix, credit == payout reward and pool collapses to principal - 1.
        const poolAfter = await env.pool.getGetPoolBalance();
        expect(poolAfter).toBe(principal - 1n);

        // After payout, remaining stake has debt reset to current RPS → pending ≈ 0.
        const pendingReward = await env.stakingMaster.getGetPendingReward(user.address, 0n);
        expect(pendingReward).toBe(0n);

        // Sanity: default shares still sum to 100 (documents orphan magnitude if unfixed).
        expect(SHARE_FLEXIBLE + SHARE_SILVER + SHARE_GOLD + SHARE_DIAMOND).toBe(100n);
    });

    it('all tiers empty: empty window is forfeited without consuming budget or funding the pool', async () => {
        const env = await setupStakingEnvironment('https://example.com/imp-faudit-f03-all-empty.json');
        const alice = await env.blockchain.treasury('f03-alice');
        const bob = await env.blockchain.treasury('f03-bob');

        await fundEmissionReserveViaMint(env, TOTAL_EMISSION_BUDGET_NANO);

        await mintAndSyncUser(env, alice, MIN_STAKE_NANO * 4n);
        await stakeAs(env, alice, 0, MIN_STAKE_NANO * 2n);

        advanceTime(env.blockchain, 600);
        await tickEmissionViaMicroUnstake(env, alice);
        const emittedWithAlice = await env.stakingMaster.getGetEmittedSoFar();
        expect(emittedWithAlice).toBeGreaterThan(0n);

        const aliceStake = await env.stakingMaster.getGetStake(alice.address, 0n);
        expect(aliceStake).not.toBeNull();
        await env.stakingMaster.sendUnstakeJetton(alice.getSender(), { tier: 0, amount: aliceStake!.amount });
        expect(await env.stakingMaster.getGetMasterTotalStake(0n)).toBe(0n);

        const emittedNoStakers = await env.stakingMaster.getGetEmittedSoFar();
        const poolNoStakers = await env.pool.getGetPoolBalance();

        advanceTime(env.blockchain, 10_000);
        await mintAndSyncUser(env, bob, MIN_STAKE_NANO * 4n);
        await stakeAs(env, bob, 0, MIN_STAKE_NANO * 2n);

        expect(await env.stakingMaster.getGetEmittedSoFar()).toBe(emittedNoStakers);
        // Stake credits principal only — empty-window tick must not have added emission credit.
        expect(await env.pool.getGetPoolBalance()).toBe(poolNoStakers + MIN_STAKE_NANO * 2n);
    });
});
