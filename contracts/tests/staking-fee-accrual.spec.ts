import { Address, toNano } from '@ton/core';
import { filterTransactions } from '@ton/test-utils';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingMaster } from '../wrappers/StakingMaster';
import {
    mintAndSyncUser,
    NANO_PER_BURN,
    setupStakingEnvironment,
    stakeAs,
    MIN_STAKE_NANO,
} from './staking-helpers';
import { MINT_TON } from './helpers';
import '@ton/test-utils';

const REWARD_SCALE = StakingMaster.RewardScale;

function countPoolMasterTransfers(
    transactions: Parameters<typeof filterTransactions>[0],
    pool: Address,
    master: Address,
): number {
    return (
        filterTransactions(transactions, { from: pool, to: master }).length +
        filterTransactions(transactions, { from: master, to: pool }).length
    );
}

describe('IMP-JETTON-GAS-01 — StakeFeeRewardsAccrue without Pool↔Master ping-pong', () => {
    it('RelayStakeFeeAccrual → StakeFeeRewardsAccrue: at most one Pool→Master hop, rewardPerShare updates', async () => {
        const env = await setupStakingEnvironment('https://example.com/gas01-relay.json');
        const user = await env.blockchain.treasury('accrue-user');

        await mintAndSyncUser(env, user, MIN_STAKE_NANO);
        await stakeAs(env, user, 0, MIN_STAKE_NANO);

        const feeAmount = 50n * NANO_PER_BURN;
        const tier0Slice = (feeAmount * 5n) / 100n;
        const expectedDeltaRps = (tier0Slice * REWARD_SCALE) / MIN_STAKE_NANO;

        const rpsBefore = await env.stakingMaster.getGetRewardPerShare(0n);
        const masterSender = env.blockchain.sender(env.stakingMaster.address);
        const tx = await env.pool.sendRelayStakeFeeAccrual(masterSender, feeAmount);

        expect(tx.transactions).toHaveTransaction({ success: true });
        expect(countPoolMasterTransfers(tx.transactions, env.pool.address, env.stakingMaster.address)).toBeLessThanOrEqual(
            2,
        );
        expect(await env.stakingMaster.getGetRewardPerShare(0n)).toBe(rpsBefore + expectedDeltaRps);
    });

    it('JettonNotification fee pipe: no cashback loop Pool↔Master', async () => {
        const env = await setupStakingEnvironment('https://example.com/gas01-jetton.json');
        const alice = await env.blockchain.treasury('fee-alice');
        const bob = await env.blockchain.treasury('fee-bob');

        await mintAndSyncUser(env, alice, MIN_STAKE_NANO);
        await stakeAs(env, alice, 0, MIN_STAKE_NANO);

        const rpsBefore = await env.stakingMaster.getGetRewardPerShare(0n);

        await env.jettonMaster.sendMint(env.deployer.getSender(), alice.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
        await env.jettonMaster.sendSyncFeeConfigToWallet(env.deployer.getSender(), alice.address);

        const transferAmt = 100n * NANO_PER_BURN;
        const expectedStakingFee = (transferAmt * 30n) / 10000n;
        const tier0Slice = (expectedStakingFee * 5n) / 100n;
        const expectedDeltaRps = (tier0Slice * REWARD_SCALE) / MIN_STAKE_NANO;

        const aliceJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(alice.address)),
        );
        const tx = await aliceJw.sendTransfer(alice.getSender(), {
            jettonAmount: transferAmt,
            destinationOwner: bob.address,
            responseDestination: alice.address,
            value: toNano('5'),
        });

        expect(tx.transactions).toHaveTransaction({ success: true });
        expect(countPoolMasterTransfers(tx.transactions, env.pool.address, env.stakingMaster.address)).toBeLessThanOrEqual(
            2,
        );
        expect(await env.stakingMaster.getGetRewardPerShare(0n)).toBe(rpsBefore + expectedDeltaRps);
    });

    it('plain TON from Master to Pool is absorbed (no bounce to Master)', async () => {
        const env = await setupStakingEnvironment('https://example.com/gas01-plain-ton.json');
        const masterSender = env.blockchain.sender(env.stakingMaster.address);

        const tx = await env.pool.send(masterSender, { value: toNano('0.05') }, null);

        expect(tx.transactions).toHaveTransaction({ success: true });
        expect(countPoolMasterTransfers(tx.transactions, env.pool.address, env.stakingMaster.address)).toBe(1);
    });
});
