/**
 * IMP-CIP-10 — leftover TON on stake/claim/unstake must return to the payer.
 *
 * Live (2026-09-04): claim attach 4 TON → W5 −4.00; pool JW +2.93;
 * stake forward 5 TON → W5 −5.02. Excesses circled master↔JW, not the user.
 */
import { Blockchain } from '@ton/sandbox';
import { Address, toNano } from '@ton/core';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { countEmptyBodyHopsBetween } from './helpers/cashbackLoopAssert';
import {
    advanceTime,
    fundEmissionReserveViaMint,
    mintAndSyncUser,
    setupStakingEnvironment,
    stakeAs,
    NANO_PER_BURN,
    TOTAL_EMISSION_BUDGET_NANO,
} from './staking-helpers';
import '@ton/test-utils';

/** Wrapper `sendClaimRewards` attach. Live claim lost this almost in full. */
const CLAIM_ATTACH_TON = toNano('4');
/** `jettonStakeToMaster` attach (forward 5 sits inside). Live stake lost ~5. */
const STAKE_ATTACH_TON = toNano('10');
/** Wrapper `sendUnstakeJetton` attach. */
const UNSTAKE_ATTACH_TON = toNano('4.2');

/**
 * Honest gas+storage ceiling. Live leftover was 4–5 TON; after CIP-10 the
 * payer's net must be ≪ attach (report target ~0.10–0.20).
 */
const PAYER_NET_CEILING = toNano('0.5');
/** Live claim parked ~2.93 TON on the pool JW. Must not grow by ~3 TON. */
const POOL_JW_TON_GROWTH_CEILING = toNano('0.5');

async function contractTon(blockchain: Blockchain, addr: Address): Promise<bigint> {
    return (await blockchain.getContract(addr)).balance;
}

function payerLost(before: bigint, after: bigint): bigint {
    return before - after;
}

describe('IMP-CIP-10 — excess / cashback to payer (net TON)', () => {
    it('claim: claimer net TON ≪ 4 TON attach (not −4)', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip10-claim-net.json');
        const user = await env.blockchain.treasury('cip10-claimer');

        await fundEmissionReserveViaMint(env, TOTAL_EMISSION_BUDGET_NANO);
        const principal = 10n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, principal);
        await stakeAs(env, user, 0, principal);

        // Getter does not tick; ClaimRewards does. Same setup as F01 e2e.
        advanceTime(env.blockchain, 600);

        const before = await user.getBalance();
        const claim = await env.stakingMaster.sendClaimRewards(user.getSender(), { tier: 0 });
        expect(claim.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        const after = await user.getBalance();
        const lost = payerLost(before, after);

        // Pre-fix: lost ≈ 4 TON. Post-fix: leftover returns (lost may be
        // slightly positive = gas, or negative = Excesses + flushed JW surplus).
        expect(lost).toBeLessThan(PAYER_NET_CEILING);
        expect(CLAIM_ATTACH_TON).toBeGreaterThan(PAYER_NET_CEILING);
    });

    it('claim: pool JW TON does not grow by ~3 TON', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip10-claim-jw.json');
        const user = await env.blockchain.treasury('cip10-claimer-jw');

        await fundEmissionReserveViaMint(env, TOTAL_EMISSION_BUDGET_NANO);
        const principal = 10n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, principal);
        await stakeAs(env, user, 0, principal);

        const poolJwAddr = await env.pool.getGetJettonRewardsWallet();
        const jwTonBefore = await contractTon(env.blockchain, poolJwAddr);

        advanceTime(env.blockchain, 600);
        const claim = await env.stakingMaster.sendClaimRewards(user.getSender(), { tier: 0 });
        expect(claim.transactions).toHaveTransaction({ success: true });

        const jwTonAfter = await contractTon(env.blockchain, poolJwAddr);
        const jwGrown = jwTonAfter - jwTonBefore;

        // Pre-fix: pool JW +~3 TON (Excesses cashback to JW). Post-fix: storage dust only.
        expect(jwGrown).toBeLessThan(POOL_JW_TON_GROWTH_CEILING);
    });

    it('stake warm-path: staker net TON ≪ attach (not −5)', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip10-stake-net.json');
        const user = await env.blockchain.treasury('cip10-staker');
        const amt = 5n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, amt * 2n);

        // First stake deploys / warms master+pool JW so the measured hop is warm.
        const warm = await stakeAs(env, user, 0, amt);
        expect(warm.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });

        const before = await user.getBalance();
        const stake = await stakeAs(env, user, 0, amt);
        expect(stake.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect((await env.stakingMaster.getGetStake(user.address, 0n))!.amount).toBe(amt * 2n);

        const after = await user.getBalance();
        const lost = payerLost(before, after);

        // Pre-fix: leftover of the 5 TON notify parks on master/JW (~5 TON).
        // Post-fix: Excesses + cashback(staker) return attach (net ≪ 5 TON).
        expect(lost).toBeLessThan(PAYER_NET_CEILING);
        expect(STAKE_ATTACH_TON).toBeGreaterThan(PAYER_NET_CEILING);
    });

    it('unstake: leftover does not ping-pong master↔JW', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip10-unstake-loop.json');
        const user = await env.blockchain.treasury('cip10-unstaker');
        const amt = 5n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, amt);
        await stakeAs(env, user, 0, amt);

        const masterJwAddr = await env.jettonMaster.getGetWalletAddress(env.stakingMaster.address);
        const poolJwAddr = await env.pool.getGetJettonRewardsWallet();
        const masterJw = env.blockchain.openContract(BurnJettonWallet.fromAddress(masterJwAddr));
        expect((await masterJw.getGetWalletData()).balance).toBeGreaterThanOrEqual(0n);

        const masterJwTonBefore = await contractTon(env.blockchain, masterJwAddr);
        const poolJwTonBefore = await contractTon(env.blockchain, poolJwAddr);
        const before = await user.getBalance();

        const unstake = await env.stakingMaster.sendUnstakeJetton(user.getSender(), {
            tier: 0,
            amount: amt,
        });
        expect(unstake.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect(await env.stakingMaster.getGetStake(user.address, 0n)).toBeNull();

        const after = await user.getBalance();
        const lost = payerLost(before, after);
        const masterJwGrown = (await contractTon(env.blockchain, masterJwAddr)) - masterJwTonBefore;
        const poolJwGrown = (await contractTon(env.blockchain, poolJwAddr)) - poolJwTonBefore;

        expect(lost).toBeLessThan(PAYER_NET_CEILING);
        expect(UNSTAKE_ATTACH_TON).toBeGreaterThan(PAYER_NET_CEILING);

        // Pre-fix: Excesses → master → cashback(JW) parks ~3 TON on a JW.
        expect(masterJwGrown).toBeLessThan(POOL_JW_TON_GROWTH_CEILING);
        expect(poolJwGrown).toBeLessThan(POOL_JW_TON_GROWTH_CEILING);

        expect(
            countEmptyBodyHopsBetween(unstake.transactions, env.stakingMaster.address, masterJwAddr),
        ).toBe(0);
        expect(
            countEmptyBodyHopsBetween(unstake.transactions, env.stakingMaster.address, poolJwAddr),
        ).toBe(0);
    });

    it('JettonExcesses handler on Master still accepts (no exit 130)', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip10-excesses-kept.json');
        const sender = await env.blockchain.treasury('cip10-excess-sender');
        const tx = await env.stakingMaster.sendJettonExcesses(sender.getSender(), 7n, toNano('0.55'));
        expect(tx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            op: 0xd53276db,
            success: true,
            exitCode: 0,
        });
    });
});
