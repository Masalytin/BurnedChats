import { Address, toNano } from '@ton/core';
import { filterTransactions } from '@ton/test-utils';
import { loadJettonTransferInternal } from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
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
/** Matches burn-jetton-wallet.tact gasPoolForwardMin + formula headroom in sandbox. */
const GAS_POOL_FORWARD_MAX_NANO = toNano('0.08');

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

function poolStakingLegForwardNano(
    transactions: Parameters<typeof filterTransactions>[0],
    senderJw: Address,
    poolJw: Address,
): bigint {
    for (const t of transactions) {
        const im = t.inMessage;
        if (!im || im.info.type !== 'internal') {
            continue;
        }
        const { src, dest } = im.info;
        if (!src?.equals(senderJw) || !dest?.equals(poolJw)) {
            continue;
        }
        const slice = im.body.beginParse();
        if (slice.remainingBits < 32) {
            continue;
        }
        try {
            const msg = loadJettonTransferInternal(slice);
            if (msg.forwardTonAmount > toNano('0.05')) {
                return msg.forwardTonAmount;
            }
        } catch {
            continue;
        }
    }
    throw new Error('pool staking JettonTransferInternal not found');
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

describe('IMP-JETTON-GAS-03 — reduced pool staking-leg forward TON', () => {
    it('fee-split staking leg forward ≤ 0.08 TON; pool_balance and accrual succeed', async () => {
        const env = await setupStakingEnvironment('https://example.com/gas03-forward.json');
        const alice = await env.blockchain.treasury('gas03-alice');
        const bob = await env.blockchain.treasury('gas03-bob');

        await mintAndSyncUser(env, alice, MIN_STAKE_NANO);
        await stakeAs(env, alice, 0, MIN_STAKE_NANO);

        const rpsBefore = await env.stakingMaster.getGetRewardPerShare(0n);

        await env.jettonMaster.sendMint(env.deployer.getSender(), alice.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
        await env.jettonMaster.sendSyncFeeConfigToWallet(env.deployer.getSender(), alice.address);

        const transferAmt = 100n * NANO_PER_BURN;
        const expectedStakingFee = (transferAmt * 30n) / 10000n;
        const tier0Slice = (expectedStakingFee * 5n) / 100n;
        const expectedDeltaRps = (tier0Slice * REWARD_SCALE) / MIN_STAKE_NANO;

        const aliceJwAddr = await env.jettonMaster.getGetWalletAddress(alice.address);
        const poolJwAddr = await env.jettonMaster.getGetWalletAddress(env.poolAddress);
        const aliceJw = env.blockchain.openContract(BurnJettonWallet.fromAddress(aliceJwAddr));

        const poolBalBefore = await env.pool.getGetPoolBalance();
        const tx = await aliceJw.sendTransfer(alice.getSender(), {
            jettonAmount: transferAmt,
            destinationOwner: bob.address,
            responseDestination: alice.address,
            value: toNano('5'),
        });

        expect(tx.transactions).toHaveTransaction({ success: true });
        const poolFwd = poolStakingLegForwardNano(tx.transactions, aliceJwAddr, poolJwAddr);
        expect(poolFwd).toBeLessThanOrEqual(GAS_POOL_FORWARD_MAX_NANO);
        expect(poolFwd).toBeGreaterThan(toNano('0.06'));
        expect(countPoolMasterTransfers(tx.transactions, env.pool.address, env.stakingMaster.address)).toBeLessThanOrEqual(
            2,
        );
        expect(await env.pool.getGetPoolBalance()).toBe(poolBalBefore + expectedStakingFee);
        expect(await env.stakingMaster.getGetRewardPerShare(0n)).toBe(rpsBefore + expectedDeltaRps);
    });
});
