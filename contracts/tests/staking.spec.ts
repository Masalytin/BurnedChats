import { Blockchain } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingLock, TIER_DIAMOND_SECONDS, TIER_GOLD_SECONDS, TIER_SILVER_SECONDS } from '../wrappers/StakingLock';
import { StakingMaster } from '../wrappers/StakingMaster';
import { StakingPool, STAKING_PLACEHOLDER_MASTER } from '../wrappers/StakingPool';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { StakingLock_errors_backward } from '../build/StakingMaster/StakingMaster_StakingLock';
import { StakingPool_errors_backward } from '../build/StakingPool/StakingPool_StakingPool';
import { DEPLOY_TON, MINT_TON, NANO_PER_BURN, SANDBOX_NOW } from './helpers';
import {
    advanceTime,
    assertPendingRewardCloseToNano,
    bootstrapStakeFeesAndPrimeMaster,
    jettonStakeToMaster,
    MIN_STAKE_NANO,
    mintAndSyncUser,
    setupStakingEnvironment,
    stakeAs,
    stakeAsWithForward,
    tickEmissionViaMicroUnstake,
    wireMasterJettonWallet,
    EMISSION_NANO_PER_SEC,
    SECONDS_PER_DAY,
    TOTAL_EMISSION_BUDGET_NANO,
} from './staking-helpers';
import '@ton/test-utils';

const REWARD_SCALE = StakingMaster.RewardScale;

describe('Staking Pool + Master (P5-2-1-1)', () => {
    it('deploys in Sandbox; stake updates pool tiers; exclusions + payouts', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = SANDBOX_NOW;
        const deployer = await blockchain.treasury('deployer');
        const user = await blockchain.treasury('user');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
        });

        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const inferredRw = await poolOnChain.getGetJettonRewardsWallet();
        expect(inferredRw.equals(await jettonMaster.getGetWalletAddress(poolBase.address))).toBe(true);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);

        expect((await stakingMaster.getGetStakingLock()).equals(stakingLock.address)).toBe(true);

        const wire = await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);
        expect(wire.transactions).toHaveTransaction({ success: true });
        expect(await poolOnChain.getGetMasterWired()).toBe(true);
        expect((await stakingMaster.getGetStake(user.address, 0n)) == null).toBe(true);

        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        const stakeAmt = 10n * NANO_PER_BURN;
        await jettonMaster.sendMint(deployer.getSender(), user.address, stakeAmt, 1n, MINT_TON);
        await jettonMaster.sendMint(deployer.getSender(), poolBase.address, 50n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), user.address);

        const userStakeTx = await jettonStakeToMaster(
            blockchain,
            jettonMaster,
            user,
            stakingMaster.address,
            stakeAmt,
            0,
        );
        expect(userStakeTx.transactions).toHaveTransaction({ success: true });
        expect(await poolOnChain.getGetTotalStake(0n)).toBe(stakeAmt);

        const stakeData = await stakingMaster.getGetStake(user.address, 0n);
        expect(stakeData != null).toBe(true);

        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), poolBase.address);

        const poolRewardWallet = blockchain.openContract(
            BurnJettonWallet.fromAddress(await poolOnChain.getGetJettonRewardsWallet()),
        );
        expect((await poolRewardWallet.getGetWalletData()).balance).toBe(stakeAmt + 50n * NANO_PER_BURN);

        const masterSender = blockchain.sender(stakingMaster.address);

        const creditTx = await poolOnChain.sendCreditPoolBalance(masterSender, 5n * NANO_PER_BURN);
        expect(creditTx.transactions).toHaveTransaction({ success: true });
        expect(await poolOnChain.getGetPoolBalance()).toBe(stakeAmt + 5n * NANO_PER_BURN);

        const payoutUserWalletAddr = await jettonMaster.getGetWalletAddress(user.address);
        const payTx = await poolOnChain.sendPayRewards(masterSender, {
            recipient: user.address,
            amount: 1n * NANO_PER_BURN,
        });
        expect(payTx.transactions).toHaveTransaction({ success: true });
        const userJw = blockchain.openContract(BurnJettonWallet.fromAddress(payoutUserWalletAddr));
        // Pool wallet is excluded: reward transfer should settle without deducting staking fee splits.
        expect((await userJw.getGetWalletData()).balance).toBe(1n * NANO_PER_BURN);
        expect(await poolOnChain.getGetPoolBalance()).toBe(stakeAmt + 4n * NANO_PER_BURN);

        const rogueInc = await poolOnChain.sendIncrementDirect(user.getSender(), { tier: 0, delta: 1n });
        expect(rogueInc.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingPool_errors_backward['Only staking master'],
        });

        await stakingMaster.sendUnstakeJetton(user.getSender(), { tier: 0, amount: stakeAmt });
        expect((await stakingMaster.getGetStake(user.address, 0n)) == null).toBe(true);
        expect(await poolOnChain.getGetTotalStake(0n)).toBe(0n);
    });

    it('merges two stakes in the same tier (re-lock)', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = SANDBOX_NOW;
        const deployer = await blockchain.treasury('deployer');
        const user = await blockchain.treasury('user');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md2.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
        });

        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);

        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), user.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), user.address);

        const a = await jettonStakeToMaster(blockchain, jettonMaster, user, stakingMaster.address, NANO_PER_BURN, 1);
        expect(a.transactions).toHaveTransaction({ success: true });

        blockchain.now = SANDBOX_NOW;
        const b = await jettonStakeToMaster(blockchain, jettonMaster, user, stakingMaster.address, NANO_PER_BURN, 1);
        expect(b.transactions).toHaveTransaction({ success: true });

        const merged = await stakingMaster.getGetStake(user.address, 1n);
        expect(merged).not.toBeNull();
        expect(merged!.amount).toBe(2n * NANO_PER_BURN);
        expect(await poolOnChain.getGetTotalStake(1n)).toBe(2n * NANO_PER_BURN);
    });
});

describe('StakingLock + unstake guards (P5-2-1-2)', () => {
    it('exposes TOKENOMICS lock durations, multipliers, shares and is_unlocked', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = SANDBOX_NOW;
        const deployer = await blockchain.treasury('deployer');

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const lock = blockchain.openContract(lockBase);
        await lock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        expect((await lock.getGetLockConfig(0n)).durationSeconds).toBe(0n);
        expect((await lock.getGetLockConfig(1n)).durationSeconds).toBe(TIER_SILVER_SECONDS);
        expect((await lock.getGetLockConfig(2n)).durationSeconds).toBe(TIER_GOLD_SECONDS);
        expect((await lock.getGetLockConfig(3n)).durationSeconds).toBe(TIER_DIAMOND_SECONDS);

        expect((await lock.getGetLockConfig(0n)).multiplier).toBe(100n);
        expect((await lock.getGetLockConfig(1n)).multiplier).toBe(150n);
        expect((await lock.getGetLockConfig(2n)).multiplier).toBe(200n);
        expect((await lock.getGetLockConfig(3n)).multiplier).toBe(300n);

        let shareSum = 0n;
        for (let t = 0; t <= 3; t++) {
            shareSum += (await lock.getGetLockConfig(BigInt(t))).rewardShare;
        }
        expect(shareSum).toBe(100n);

        const start = BigInt(blockchain.now!);
        expect(await lock.getGetUnlockTime(1n, start)).toBe(start + TIER_SILVER_SECONDS);
        expect(await lock.getIsUnlocked(1n, start, start + TIER_SILVER_SECONDS - 1n)).toBe(false);
        expect(await lock.getIsUnlocked(1n, start, start + TIER_SILVER_SECONDS)).toBe(true);
    });

    it('rejects SetTierRewardShare when other tiers no longer sum to 100', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');
        const user = await blockchain.treasury('user');

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const lock = blockchain.openContract(lockBase);
        await lock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const bad = await lock.sendSetTierRewardShare(deployer.getSender(), { tier: 0, share: 4n });
        expect(bad.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingLock_errors_backward['Shares must sum to 100'],
        });

        const rogue = await lock.sendSetTierRewardShare(user.getSender(), { tier: 0, share: 5n });
        expect(rogue.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingLock_errors_backward['Only timelock'],
        });
    });

    it('Silver stake cannot unstake until unlock; Flexible can', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = SANDBOX_NOW;
        const deployer = await blockchain.treasury('deployer');
        const user = await blockchain.treasury('user');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md-lock.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);
        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), user.address, 15n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), user.address);

        const silverStake = await jettonStakeToMaster(
            blockchain,
            jettonMaster,
            user,
            stakingMaster.address,
            NANO_PER_BURN,
            1,
        );
        expect(silverStake.transactions).toHaveTransaction({ success: true });

        const silverEarly = await stakingMaster.sendUnstakeJetton(user.getSender(), {
            tier: 1,
            amount: NANO_PER_BURN,
        });
        expect(silverEarly.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingMaster_errors_backward['Still locked'],
        });

        blockchain.now += Number(TIER_SILVER_SECONDS);
        const silverLate = await stakingMaster.sendUnstakeJetton(user.getSender(), {
            tier: 1,
            amount: NANO_PER_BURN,
        });
        expect(silverLate.transactions).toHaveTransaction({ success: true });

        const flexStake = await jettonStakeToMaster(
            blockchain,
            jettonMaster,
            user,
            stakingMaster.address,
            NANO_PER_BURN,
            0,
        );
        expect(flexStake.transactions).toHaveTransaction({ success: true });
        const flexUnstake = await stakingMaster.sendUnstakeJetton(user.getSender(), {
            tier: 0,
            amount: NANO_PER_BURN,
        });
        expect(flexUnstake.transactions).toHaveTransaction({ success: true });
    });
});

describe('Accumulated staking rewards (P5-2-2-1)', () => {
    it('RelayStakeFeeAccrual distributes 5/10/25/60 tier slices into rewardPerShare; solo Flexible gets tier-0 slice', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = SANDBOX_NOW;
        const deployer = await blockchain.treasury('deployer');
        const alice = await blockchain.treasury('alice');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md-rewards.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);

        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);
        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), alice.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), alice.address);

        const aliceStakeAmt = NANO_PER_BURN;
        await jettonStakeToMaster(blockchain, jettonMaster, alice, stakingMaster.address, aliceStakeAmt, 0);
        expect(await poolOnChain.getGetTotalStake(0n)).toBe(aliceStakeAmt);

        expect(await stakingMaster.getGetMasterTotalStake(0n)).toBe(aliceStakeAmt);
        expect(await stakingMaster.getGetPendingReward(alice.address, 0n)).toBe(0n);

        const feeAmount = 1000n * NANO_PER_BURN;
        const tier0Slice = (feeAmount * 5n) / 100n;
        const expectedDeltaRps = (tier0Slice * REWARD_SCALE) / aliceStakeAmt;

        const masterSender = blockchain.sender(stakingMaster.address);
        const relayTx = await poolOnChain.sendRelayStakeFeeAccrual(masterSender, feeAmount);
        expect(relayTx.transactions).toHaveTransaction({ success: true });

        expect(await stakingMaster.getGetRewardPerShare(0n)).toBe(expectedDeltaRps);
        const pend = await stakingMaster.getGetPendingReward(alice.address, 0n);
        expect(pend).toBe((aliceStakeAmt * expectedDeltaRps) / REWARD_SCALE);
        expect(pend).toBe(tier0Slice);
    });

    it('splits tier-0 fee between two Flexible stakers by stake ratio', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = SANDBOX_NOW;
        const deployer = await blockchain.treasury('deployer');
        const alice = await blockchain.treasury('alice2');
        const bob = await blockchain.treasury('bob2');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md-rewards-split.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);

        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), alice.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendMint(deployer.getSender(), bob.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), alice.address);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), bob.address);

        const aAmt = 6n * NANO_PER_BURN;
        const bAmt = 4n * NANO_PER_BURN;

        await jettonStakeToMaster(blockchain, jettonMaster, alice, stakingMaster.address, aAmt, 0);
        await jettonStakeToMaster(blockchain, jettonMaster, bob, stakingMaster.address, bAmt, 0);

        const feeAmount = 100n * NANO_PER_BURN;
        const tier0Slice = (feeAmount * 5n) / 100n;
        const masterSender = blockchain.sender(stakingMaster.address);
        await poolOnChain.sendRelayStakeFeeAccrual(masterSender, feeAmount);

        const pA = await stakingMaster.getGetPendingReward(alice.address, 0n);
        const pB = await stakingMaster.getGetPendingReward(bob.address, 0n);
        expect(pA).toBe((tier0Slice * aAmt) / (aAmt + bAmt));
        expect(pB).toBe((tier0Slice * bAmt) / (aAmt + bAmt));
        expect(pA + pB).toBe(tier0Slice);
    });

    it('rejects RelayStakeFeeAccrual unless sender is StakingMaster', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');
        const outsider = await blockchain.treasury('outsider');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md-poolguard.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);

        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        const rogue = await poolOnChain.sendRelayStakeFeeAccrual(outsider.getSender(), NANO_PER_BURN);
        expect(rogue.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingPool_errors_backward['Only staking master'],
        });
    });

    it('accrues with no stakers: no division-by-zero and reward_per_share unchanged', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md-nostake.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);

        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        const masterSender = blockchain.sender(stakingMaster.address);
        const tx = await poolOnChain.sendRelayStakeFeeAccrual(masterSender, 123n * NANO_PER_BURN);
        expect(tx.transactions).toHaveTransaction({ success: true });

        for (let t = 0; t <= 3; t++) {
            expect(await stakingMaster.getGetRewardPerShare(BigInt(t))).toBe(0n);
        }
    });
});

describe('Emission + staking fee Jetton pipe (P5-2-2-3)', () => {
    it('linear emission tick accrues to emitted_so_far and pool_balance while stakes exist', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = SANDBOX_NOW;
        const deployer = await blockchain.treasury('deployer');
        const alice = await blockchain.treasury('alice-em');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md-emission.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);
        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), poolBase.address, 50n * NANO_PER_BURN, 1n, MINT_TON);
        // IMP-PREMNT-04: emission only accrues up to the funded reserve; back the full budget.
        await stakingMaster.sendFundEmissionReserve(deployer.getSender(), TOTAL_EMISSION_BUDGET_NANO);
        await jettonMaster.sendMint(deployer.getSender(), alice.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), alice.address);

        const stakeTx = await jettonStakeToMaster(
            blockchain,
            jettonMaster,
            alice,
            stakingMaster.address,
            MIN_STAKE_NANO,
            0,
        );
        expect(stakeTx.transactions).toHaveTransaction({ success: true });
        expect(await stakingMaster.getGetEmittedSoFar()).toBe(0n);

        blockchain.now! += 120;
        const unstakeTiny = await stakingMaster.sendUnstakeJetton(alice.getSender(), {
            tier: 0,
            amount: 1n,
        });
        expect(unstakeTiny.transactions).toHaveTransaction({ success: true });

        const expectedEmitted = 120n * EMISSION_NANO_PER_SEC;
        expect(await stakingMaster.getGetEmittedSoFar()).toBe(expectedEmitted);
        expect(await stakingMaster.getGetRewardPerShare(0n)).toBeGreaterThan(0n);
    });

    it('staking fee transfer notifies Pool and credits pool_balance', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');
        const alice = await blockchain.treasury('alice-fee');
        const bob = await blockchain.treasury('bob-fee');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md-feepipe.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const jettonMaster = blockchain.openContract(m);
        await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

        const poolBase = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jettonMaster.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        const poolOnChain = blockchain.openContract(poolBase);
        await poolOnChain.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
            deployer.address,
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await jettonMaster.sendSetFeeDestinations(deployer.getSender(), poolBase.address, deployer.address);
        await jettonMaster.sendMint(deployer.getSender(), alice.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), alice.address);

        const transferAmt = 100n * NANO_PER_BURN;
        const expectedStaking = (transferAmt * 30n) / 10000n;

        const aliceJw = blockchain.openContract(
            BurnJettonWallet.fromAddress(await jettonMaster.getGetWalletAddress(alice.address)),
        );
        const tx = await aliceJw.sendTransfer(alice.getSender(), {
            jettonAmount: transferAmt,
            destinationOwner: bob.address,
            responseDestination: alice.address,
            value: toNano('5'),
        });
        expect(tx.transactions).toHaveTransaction({ success: true });

        expect(await poolOnChain.getGetPoolBalance()).toBe(expectedStaking);
    });
});

describe('Staking integration & coverage (P5-2-2-4)', () => {
    function expectedYearNanoFromPhase1Tier(
        tierRewardPct: bigint,
        tierTotalStakeNano: bigint,
        userStakeNano: bigint,
    ): bigint {
        const dailyTotal = SECONDS_PER_DAY * EMISSION_NANO_PER_SEC;
        const tierSlice = (dailyTotal * tierRewardPct) / 100n;
        const userDay = (tierSlice * userStakeNano) / tierTotalStakeNano;
        return userDay * 365n;
    }

    describe('Stake flow', () => {
        it('single stake updates master totalStakeByTier for that tier', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-single.json');
            const user = await env.blockchain.treasury('stake-one');
            const amt = 5n * NANO_PER_BURN;
            await mintAndSyncUser(env, user, amt);
            const tx = await stakeAs(env, user, 2, amt);
            expect(tx.transactions).toHaveTransaction({ success: true });
            expect(await env.pool.getGetTotalStake(2n)).toBe(amt);
            expect(await env.stakingMaster.getGetMasterTotalStake(2n)).toBe(amt);
        });

        it('stake below MIN_STAKE is ignored (no stake record / no pool increment)', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-minignore.json');
            const user = await env.blockchain.treasury('submin-user');
            await mintAndSyncUser(env, user, MIN_STAKE_NANO);
            const tx = await stakeAs(env, user, 0, MIN_STAKE_NANO - 1n);
            expect(tx.transactions).toHaveTransaction({ success: true });
            expect(await env.stakingMaster.getGetStake(user.address, 0n)).toBeNull();
            expect(await env.pool.getGetTotalStake(0n)).toBe(0n);
        });

        it('one user can stake into multiple tiers independently', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-multitier.json');
            const user = await env.blockchain.treasury('multi');
            const amt0 = MIN_STAKE_NANO;
            const amt1 = 2n * MIN_STAKE_NANO;
            await mintAndSyncUser(env, user, amt0 + amt1 + NANO_PER_BURN);
            expect((await stakeAs(env, user, 0, amt0)).transactions).toHaveTransaction({ success: true });
            expect((await stakeAs(env, user, 1, amt1)).transactions).toHaveTransaction({ success: true });
            expect((await env.stakingMaster.getGetStake(user.address, 0n))!.amount).toBe(amt0);
            expect((await env.stakingMaster.getGetStake(user.address, 1n))!.amount).toBe(amt1);
        });
    });

    describe('Unstake flow', () => {
        it('rejects unstake without an existing stake', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-no-unst.json');
            const user = await env.blockchain.treasury('fresh');
            const tx = await env.stakingMaster.sendUnstakeJetton(user.getSender(), { tier: 0, amount: 1n });
            expect(tx.transactions).toHaveTransaction({
                success: false,
                exitCode: StakingMaster_errors_backward['No stake'],
            });
        });

        it('partial unstake decreases stake.amount; remainder keeps unlockTime', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-partial.json');
            const user = await env.blockchain.treasury('partial');
            const total = MIN_STAKE_NANO * 5n;
            await mintAndSyncUser(env, user, total + NANO_PER_BURN);
            await stakeAs(env, user, 0, total);
            const beforeUn = await env.stakingMaster.getGetStake(user.address, 0n);
            expect(beforeUn).not.toBeNull();
            const u0 = beforeUn!;
            const half = total / 2n;
            const tx = await env.stakingMaster.sendUnstakeJetton(user.getSender(), { tier: 0, amount: half });
            expect(tx.transactions).toHaveTransaction({ success: true });
            const afterUn = await env.stakingMaster.getGetStake(user.address, 0n);
            expect(afterUn!.amount).toBe(total - half);
            expect(afterUn!.unlockTime).toBe(u0.unlockTime);
        });

        it('Gold cannot unstake early; unstake succeeds after Sandbox time passes lock duration', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-goldlock.json');
            const user = await env.blockchain.treasury('gold-user');
            await mintAndSyncUser(env, user, 20n * MIN_STAKE_NANO);
            await stakeAs(env, user, 2, 10n * MIN_STAKE_NANO);

            const early = await env.stakingMaster.sendUnstakeJetton(user.getSender(), {
                tier: 2,
                amount: MIN_STAKE_NANO,
            });
            expect(early.transactions).toHaveTransaction({
                success: false,
                exitCode: StakingMaster_errors_backward['Still locked'],
            });

            advanceTime(env.blockchain, Number(TIER_GOLD_SECONDS));
            const late = await env.stakingMaster.sendUnstakeJetton(user.getSender(), {
                tier: 2,
                amount: MIN_STAKE_NANO,
            });
            expect(late.transactions).toHaveTransaction({ success: true });
        });
    });

    describe('Claim flow', () => {
        it('reject claim when tier has no stake', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-nocl.json');
            const user = await env.blockchain.treasury('no-stake-cl');
            const tx = await env.stakingMaster.sendClaimRewards(user.getSender(), { tier: 1 });
            expect(tx.transactions).toHaveTransaction({
                success: false,
                exitCode: StakingMaster_errors_backward['No stake'],
            });
        });

        it('reject second claim immediately after draining pending rewards', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-dclaim.json');
            const user = await env.blockchain.treasury('dbl-cl');
            await mintAndSyncUser(env, user, MIN_STAKE_NANO * 3n);

            await stakeAs(env, user, 0, MIN_STAKE_NANO);

            const masterSender = env.blockchain.sender(env.stakingMaster.address);
            await env.pool.sendRelayStakeFeeAccrual(masterSender, 25n * NANO_PER_BURN);

            const pi = await env.stakingMaster.getGetPendingReward(user.address, 0n);
            expect(pi).toBeGreaterThan(0n);

            expect(
                (await env.stakingMaster.sendClaimRewards(user.getSender(), { tier: 0 })).transactions,
            ).toHaveTransaction({ success: true });

            const tx2 = await env.stakingMaster.sendClaimRewards(user.getSender(), { tier: 0 });
            expect(tx2.transactions).toHaveTransaction({
                success: false,
                exitCode: StakingMaster_errors_backward['Nothing to claim'],
            });
        });
    });

    describe('Rewards distribution', () => {
        it('Phase 1: ~0.274 BURN/day volume relayed matches Flexible solo tier0 slice (~5%)', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-daily.json');
            const alice = await env.blockchain.treasury('solo-flex-day');
            await mintAndSyncUser(env, alice, MIN_STAKE_NANO);

            await stakeAs(env, alice, 0, MIN_STAKE_NANO);

            const dailyEmissionEquivalent = SECONDS_PER_DAY * EMISSION_NANO_PER_SEC;
            const tier0Slice = (dailyEmissionEquivalent * 5n) / 100n;

            const masterSender = env.blockchain.sender(env.stakingMaster.address);
            const tx = await env.pool.sendRelayStakeFeeAccrual(masterSender, dailyEmissionEquivalent);
            expect(tx.transactions).toHaveTransaction({ success: true });

            const pend = await env.stakingMaster.getGetPendingReward(alice.address, 0n);
            assertPendingRewardCloseToNano(pend, tier0Slice, 500_000n);
        });

        it('relay 0.3 BURN staking-fee nano accrues to solo Flexible proportional to tier-0 share only', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-f03.json');
            const user = await env.blockchain.treasury('fee03');
            const feeNano = (3n * NANO_PER_BURN) / 10n;

            await mintAndSyncUser(env, user, MIN_STAKE_NANO);
            await stakeAs(env, user, 0, MIN_STAKE_NANO);

            const masterSender = env.blockchain.sender(env.stakingMaster.address);
            const tx = await env.pool.sendRelayStakeFeeAccrual(masterSender, feeNano);
            expect(tx.transactions).toHaveTransaction({ success: true });

            const expectedPending = (((feeNano * 5n) / 100n) * MIN_STAKE_NANO) / MIN_STAKE_NANO;

            assertPendingRewardCloseToNano(
                await env.stakingMaster.getGetPendingReward(user.address, 0n),
                expectedPending,
                250n,
            );
        });

        it('Diamond vs Flexible same stake nano: pooled pending ratio matches 60% / 5% tier slices', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-1260.json');
            const alice = await env.blockchain.treasury('diamond-a');
            const bob = await env.blockchain.treasury('flex-b');
            const one = MIN_STAKE_NANO;

            await mintAndSyncUser(env, alice, one * 2n);
            await mintAndSyncUser(env, bob, one * 2n);
            await stakeAs(env, alice, 3, one);
            await stakeAs(env, bob, 0, one);

            const masterSender = env.blockchain.sender(env.stakingMaster.address);
            const feeNano = NANO_PER_BURN;
            await env.pool.sendRelayStakeFeeAccrual(masterSender, feeNano);

            const pD = await env.stakingMaster.getGetPendingReward(alice.address, 3n);
            const pF = await env.stakingMaster.getGetPendingReward(bob.address, 0n);

            const tierD_expected = (((feeNano * 60n) / 100n) * one) / one;
            const tierF_expected = (((feeNano * 5n) / 100n) * one) / one;

            assertPendingRewardCloseToNano(pD, tierD_expected, NANO_PER_BURN / 1_000_000n);
            assertPendingRewardCloseToNano(pF, tierF_expected, NANO_PER_BURN / 1_000_000n);

            assertPendingRewardCloseToNano(pF * 12n, pD, 1000n);
        });

        it('same tier: Alice 2× Bob stake → Alice pending ≈ 2× Bob pending', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-twice.json');
            const alice = await env.blockchain.treasury('2x-alice');
            const bob = await env.blockchain.treasury('b-b');

            await mintAndSyncUser(env, alice, NANO_PER_BURN * 3n);
            await mintAndSyncUser(env, bob, NANO_PER_BURN * 2n);
            await stakeAs(env, alice, 0, MIN_STAKE_NANO * 2n);
            await stakeAs(env, bob, 0, MIN_STAKE_NANO);

            const masterSender = env.blockchain.sender(env.stakingMaster.address);
            await env.pool.sendRelayStakeFeeAccrual(masterSender, 100n * NANO_PER_BURN);

            const pA = await env.stakingMaster.getGetPendingReward(alice.address, 0n);
            const pB = await env.stakingMaster.getGetPendingReward(bob.address, 0n);
            expect(pB).toBeGreaterThan(0n);
            assertPendingRewardCloseToNano(pA, pB * 2n, 500n);
        });
    });

    describe('Governance tier table (StakingLock)', () => {
        it('default rewardShare matches TOKENOMICS: Flexible 5% and Diamond 60%', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-sharedef.json');
            expect((await env.stakingLock.getGetLockConfig(0n)).rewardShare).toBe(5n);
            expect((await env.stakingLock.getGetLockConfig(3n)).rewardShare).toBe(60n);
        });
    });

    describe('Concurrency & time Travel', () => {
        it('10 users staking same tier increments totalStake to sum of individual stakes', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-many.json');

            let sum = 0n;
            for (let i = 0; i < 10; i++) {
                const user = await env.blockchain.treasury(`p5224-batch-${i}`);
                const amt = BigInt(i + 1) * MIN_STAKE_NANO;
                await mintAndSyncUser(env, user, amt + NANO_PER_BURN);
                expect((await stakeAs(env, user, 0, amt)).transactions).toHaveTransaction({ success: true });
                sum += amt;
            }
            expect(await env.pool.getGetTotalStake(0n)).toBe(sum);
        });

        it('Stake by user A while user B unstakes same Sandbox logical step keeps correct pool total', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-consame.json');

            const a = await env.blockchain.treasury('con-a');
            const b = await env.blockchain.treasury('con-b');
            await mintAndSyncUser(env, a, 20n * MIN_STAKE_NANO);
            await mintAndSyncUser(env, b, 20n * MIN_STAKE_NANO);

            await stakeAs(env, a, 0, 10n * MIN_STAKE_NANO);
            await stakeAs(env, b, 0, 10n * MIN_STAKE_NANO);

            const txA = await stakeAs(env, a, 0, MIN_STAKE_NANO);
            const txB = await env.stakingMaster.sendUnstakeJetton(b.getSender(), {
                tier: 0,
                amount: 3n * MIN_STAKE_NANO,
            });

            expect(txA.transactions).toHaveTransaction({ success: true });
            expect(txB.transactions).toHaveTransaction({ success: true });

            expect(await env.pool.getGetTotalStake(0n)).toBe(18n * MIN_STAKE_NANO);
        });

        it('near end of emission schedule emitted_so_far clamps to Phase 1 budget', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-phase2.json');
            const user = await env.blockchain.treasury('phase2');

            await env.jettonMaster.sendMint(
                env.deployer.getSender(),
                env.poolAddress,
                500n * NANO_PER_BURN,
                1n,
                MINT_TON,
            );
            // IMP-PREMNT-04: fund the full emission budget so the schedule can emit to its cap.
            await env.stakingMaster.sendFundEmissionReserve(env.deployer.getSender(), TOTAL_EMISSION_BUDGET_NANO);
            await mintAndSyncUser(env, user, MIN_STAKE_NANO * 2n);
            await stakeAs(env, user, 0, MIN_STAKE_NANO);

            advanceTime(env.blockchain, 94608000 + 5000);
            expect((await tickEmissionViaMicroUnstake(env, user)).transactions).toHaveTransaction({ success: true });

            const em = await env.stakingMaster.getGetEmittedSoFar();
            expect(em).toBeLessThanOrEqual(TOTAL_EMISSION_BUDGET_NANO);
            expect(em).toBeGreaterThanOrEqual(TOTAL_EMISSION_BUDGET_NANO - 200_000_000n);
        });
    });

    describe('End-to-end & TOKENOMICS APY table', () => {
        it('stake → relay accrue → claim clears pending on-chain bookkeeping', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-e2e.json');
            const user = await env.blockchain.treasury('e2e');

            await env.jettonMaster.sendMint(
                env.deployer.getSender(),
                env.poolAddress,
                500n * NANO_PER_BURN,
                1n,
                MINT_TON,
            );
            const stakeAmt = 5n * MIN_STAKE_NANO;
            await mintAndSyncUser(env, user, stakeAmt + NANO_PER_BURN);

            await stakeAs(env, user, 0, stakeAmt);

            advanceTime(env.blockchain, 3 * Number(SECONDS_PER_DAY));

            const masterSender = env.blockchain.sender(env.stakingMaster.address);
            await env.pool.sendRelayStakeFeeAccrual(masterSender, 100n * NANO_PER_BURN);

            const pendBefore = await env.stakingMaster.getGetPendingReward(user.address, 0n);
            expect(pendBefore).toBeGreaterThan(0n);

            expect(
                (await env.stakingMaster.sendClaimRewards(user.getSender(), { tier: 0 })).transactions,
            ).toHaveTransaction({
                success: true,
            });

            expect(await env.stakingMaster.getGetPendingReward(user.address, 0n)).toBe(0n);
        });

        it('TOKENOMICS APY calculator indicative yearly rewards (Phase 1, no tx fees, analytic)', () => {
            const flexY = expectedYearNanoFromPhase1Tier(5n, 60n * NANO_PER_BURN, 10n * NANO_PER_BURN);
            const silverY = expectedYearNanoFromPhase1Tier(10n, 75n * NANO_PER_BURN, 10n * NANO_PER_BURN);
            const goldY = expectedYearNanoFromPhase1Tier(25n, 75n * NANO_PER_BURN, 10n * NANO_PER_BURN);
            const diaY = expectedYearNanoFromPhase1Tier(60n, 90n * NANO_PER_BURN, 10n * NANO_PER_BURN);

            assertPendingRewardCloseToNano(flexY, 833_076_000n, 5_000n);
            assertPendingRewardCloseToNano(silverY, 1_332_921_600n, 5_000n);
            assertPendingRewardCloseToNano(goldY, 3_332_304_000n, 5_000n);
            assertPendingRewardCloseToNano(diaY, 6_664_608_000n, 5_000n);
        });
    });
});

describe('IMP-STAKE-GAS-01 — stake notify gas guard + JettonExcesses', () => {
    it('rejects JettonNotification with insufficient forward TON (no stake recorded)', async () => {
        const env = await setupStakingEnvironment('https://example.com/stake-gas01-lowfwd.json');
        const user = await env.blockchain.treasury('low-fwd');
        const amt = MIN_STAKE_NANO * 2n;
        await mintAndSyncUser(env, user, amt);

        const tx = await stakeAsWithForward(env, user, 0, amt, toNano('0.1'));
        expect(tx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: false,
            exitCode: StakingMaster_errors_backward['Low TON stake'],
        });
        expect(await env.stakingMaster.getGetStake(user.address, 0n)).toBeNull();
        expect(await env.pool.getGetTotalStake(0n)).toBe(0n);

        const masterJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(env.stakingMaster.address)),
        );
        const jwBal = (await masterJw.getGetWalletData()).balance;
        expect(jwBal).toBeGreaterThanOrEqual(amt);
        expect(jwBal).toBeLessThan(amt + MIN_STAKE_NANO);
    });

    it('accepts stake with sufficient forward TON (5 TON profile)', async () => {
        const env = await setupStakingEnvironment('https://example.com/stake-gas01-ok.json');
        const user = await env.blockchain.treasury('ok-fwd');
        const amt = MIN_STAKE_NANO * 3n;
        await mintAndSyncUser(env, user, amt);

        const tx = await stakeAs(env, user, 0, amt);
        expect(tx.transactions).toHaveTransaction({ success: true });
        expect((await env.stakingMaster.getGetStake(user.address, 0n))!.amount).toBe(amt);
        expect(await env.pool.getGetTotalStake(0n)).toBe(amt);
    });

    it('JettonExcesses on Master returns TON to sender (no exit 130)', async () => {
        const env = await setupStakingEnvironment('https://example.com/stake-gas01-excess.json');
        const sender = await env.blockchain.treasury('excess-sender');
        const excessValue = toNano('0.55');

        const tx = await env.stakingMaster.sendJettonExcesses(sender.getSender(), 42n, excessValue);
        expect(tx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            op: 0xd53276db,
            success: true,
            exitCode: 0,
        });
        expect(tx.transactions).toHaveTransaction({
            from: env.stakingMaster.address,
            to: sender.address,
            success: true,
        });
    });
});
