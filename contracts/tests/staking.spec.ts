import { Blockchain, SandboxContract, TreasuryContract, internal } from '@ton/sandbox';
import { beginCell, toNano } from '@ton/core';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingLock, TIER_DIAMOND_SECONDS, TIER_GOLD_SECONDS, TIER_SILVER_SECONDS } from '../wrappers/StakingLock';
import { StakingMaster } from '../wrappers/StakingMaster';
import { emissionFundForwardPayload, StakingPool, STAKING_PLACEHOLDER_MASTER } from '../wrappers/StakingPool';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { StakingLock_errors_backward } from '../build/StakingMaster/StakingMaster_StakingLock';
import { StakingPool_errors_backward, storeCommitJettonTransfer } from '../build/StakingPool/StakingPool_StakingPool';
import { DEPLOY_TON, MINT_TON, NANO_PER_BURN, SANDBOX_NOW, stakeForwardPayload } from './helpers';
import { assertRelayFlowClean } from './helpers/cashbackLoopAssert';
import {
    advanceTime,
    assertPendingRewardCloseToNano,
    bootstrapStakeFeesAndPrimeMaster,
    fundEmissionReserveViaMint,
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
        // IMP-PREMNT-04/IMP-MNAUD-F01: emission only accrues up to the funded reserve;
        // back the full budget by minting to the pool with the EmissionFundForward payload.
        await jettonMaster.sendMint(
            deployer.getSender(),
            poolBase.address,
            TOTAL_EMISSION_BUDGET_NANO,
            toNano('0.1'),
            MINT_TON,
            emissionFundForwardPayload(),
        );
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

        // IMP-FAUDIT-F03: Flexible-only → only the 5% tier slice is credited/consumed.
        const expectedEmitted = (120n * EMISSION_NANO_PER_SEC * 5n) / 100n;
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

        it('stake below MIN_STAKE is rejected and jettons returned (IMP-STKFEE-04)', async () => {
            const env = await setupStakingEnvironment('https://example.com/md-p5224-minignore.json');
            const user = await env.blockchain.treasury('submin-user');
            const subMin = MIN_STAKE_NANO - 1n;
            await mintAndSyncUser(env, user, MIN_STAKE_NANO);

            const masterJw = env.blockchain.openContract(
                BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(env.stakingMaster.address)),
            );
            const masterJwBefore = (await masterJw.getGetWalletData()).balance;

            const tx = await stakeAs(env, user, 0, subMin);
            expect(tx.transactions).toHaveTransaction({ success: true });
            expect(await env.stakingMaster.getGetStake(user.address, 0n)).toBeNull();
            expect(await env.pool.getGetTotalStake(0n)).toBe(0n);

            const userJw = env.blockchain.openContract(
                BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
            );
            expect((await userJw.getGetWalletData()).balance).toBe(MIN_STAKE_NANO);
            expect((await masterJw.getGetWalletData()).balance).toBe(masterJwBefore);
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
            // Stake all four tiers so every reward-share slice is occupied — otherwise
            // IMP-FAUDIT-F03 forfeits empty-tier slices and the budget is not exhausted.
            const flex = await env.blockchain.treasury('phase2-flex');
            const silver = await env.blockchain.treasury('phase2-silver');
            const gold = await env.blockchain.treasury('phase2-gold');
            const diamond = await env.blockchain.treasury('phase2-diamond');

            await env.jettonMaster.sendMint(
                env.deployer.getSender(),
                env.poolAddress,
                500n * NANO_PER_BURN,
                1n,
                MINT_TON,
            );
            // IMP-PREMNT-04/IMP-MNAUD-F01: fund the full emission budget (mint-to-pool)
            // so the schedule can emit to its cap.
            await fundEmissionReserveViaMint(env, TOTAL_EMISSION_BUDGET_NANO);
            await mintAndSyncUser(env, flex, MIN_STAKE_NANO * 2n);
            await mintAndSyncUser(env, silver, MIN_STAKE_NANO);
            await mintAndSyncUser(env, gold, MIN_STAKE_NANO);
            await mintAndSyncUser(env, diamond, MIN_STAKE_NANO);
            await stakeAs(env, flex, 0, MIN_STAKE_NANO);
            await stakeAs(env, silver, 1, MIN_STAKE_NANO);
            await stakeAs(env, gold, 2, MIN_STAKE_NANO);
            await stakeAs(env, diamond, 3, MIN_STAKE_NANO);

            advanceTime(env.blockchain, 94608000 + 5000);
            expect((await tickEmissionViaMicroUnstake(env, flex)).transactions).toHaveTransaction({ success: true });

            const em = await env.stakingMaster.getGetEmittedSoFar();
            expect(em).toBeLessThanOrEqual(TOTAL_EMISSION_BUDGET_NANO);
            // Integer truncation across four share slices may leave a few nano unallocated.
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

/** Wire StakingLock → StakingMaster push sync (deployer acts as timelock in sandbox). */
async function wireStakingLockPushSync(
    stakingLock: SandboxContract<StakingLock>,
    stakingMaster: SandboxContract<StakingMaster>,
    timelock: SandboxContract<TreasuryContract>,
) {
    const wire = await stakingLock.sendSetStakingMasterForPush(timelock.getSender(), stakingMaster.address);
    expect(wire.transactions).toHaveTransaction({ success: true });
    const push = await stakingLock.sendPushAllTierConfigs(timelock.getSender());
    expect(push.transactions).toHaveTransaction({ success: true });
}

describe('IMP-AUDIT-03 — StakingLock runtime wiring', () => {
    it('governance lock-duration change updates unlock on subsequent stake', async () => {
        const env = await setupStakingEnvironment('https://example.com/audit03-unlock.json');
        await wireStakingLockPushSync(env.stakingLock, env.stakingMaster, env.deployer);

        const user = await env.blockchain.treasury('audit03-unlock-user');
        await mintAndSyncUser(env, user, 5n * MIN_STAKE_NANO);

        const newSilverSeconds = 7n * 24n * 3600n;
        const gov = await env.stakingLock.sendSetLockDuration(env.deployer.getSender(), {
            tier: 1,
            duration: newSilverSeconds,
        });
        expect(gov.transactions).toHaveTransaction({ success: true });
        expect((await env.stakingMaster.getGetTierConfig(1n)).durationSeconds).toBe(newSilverSeconds);

        await stakeAs(env, user, 1, MIN_STAKE_NANO);
        const stake = await env.stakingMaster.getGetStake(user.address, 1n);
        expect(stake).not.toBeNull();
        expect(stake!.unlockTime - stake!.startTime).toBe(newSilverSeconds);

        const early = await env.stakingMaster.sendUnstakeJetton(user.getSender(), {
            tier: 1,
            amount: MIN_STAKE_NANO,
        });
        expect(early.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingMaster_errors_backward['Still locked'],
        });

        advanceTime(env.blockchain, Number(newSilverSeconds));
        const late = await env.stakingMaster.sendUnstakeJetton(user.getSender(), {
            tier: 1,
            amount: MIN_STAKE_NANO,
        });
        expect(late.transactions).toHaveTransaction({ success: true });
    });

    it('governance reward-share change affects fee accrual on subsequent stakes', async () => {
        const env = await setupStakingEnvironment('https://example.com/audit03-share.json');
        await wireStakingLockPushSync(env.stakingLock, env.stakingMaster, env.deployer);

        const user = await env.blockchain.treasury('audit03-share-user');
        await mintAndSyncUser(env, user, 3n * MIN_STAKE_NANO);

        const gov = await env.stakingLock.sendSetAllTierRewardShares(env.deployer.getSender(), [
            10n,
            10n,
            25n,
            55n,
        ]);
        expect(gov.transactions).toHaveTransaction({ on: env.stakingLock.address, success: true });
        expect((await env.stakingMaster.getGetTierConfig(0n)).rewardShare).toBe(10n);

        await stakeAs(env, user, 0, MIN_STAKE_NANO);

        const feeAmount = 100n * NANO_PER_BURN;
        const tier0Slice = (feeAmount * 10n) / 100n;
        const masterSender = env.blockchain.sender(env.stakingMaster.address);
        await env.pool.sendRelayStakeFeeAccrual(masterSender, feeAmount);

        const pend = await env.stakingMaster.getGetPendingReward(user.address, 0n);
        expect(pend).toBe(tier0Slice);
    });

    it('governance VP multiplier change affects voting power on subsequent stake', async () => {
        const env = await setupStakingEnvironment('https://example.com/audit03-vp.json');
        await wireStakingLockPushSync(env.stakingLock, env.stakingMaster, env.deployer);

        const user = await env.blockchain.treasury('audit03-vp-user');
        await mintAndSyncUser(env, user, 2n * MIN_STAKE_NANO);

        const newMultiplier = 250n;
        const gov = await env.stakingLock.sendSetTierMultiplier(env.deployer.getSender(), {
            tier: 2,
            multiplier: newMultiplier,
        });
        expect(gov.transactions).toHaveTransaction({ success: true });
        expect((await env.stakingMaster.getGetTierConfig(2n)).multiplier).toBe(newMultiplier);

        const stakeAmt = MIN_STAKE_NANO;
        await stakeAs(env, user, 2, stakeAmt);

        const vp = await env.stakingMaster.getGetVotingPower(user.address);
        expect(vp).toBe((stakeAmt * newMultiplier) / 100n);
    });
});

describe('IMP-RELAY-03 — StakingLock ↔ StakingMaster tier sync relay', () => {
    it('SetLockDuration TierConfigSync has zero empty-body hops Lock↔Master', async () => {
        const env = await setupStakingEnvironment('https://example.com/relay03-duration.json');
        await wireStakingLockPushSync(env.stakingLock, env.stakingMaster, env.deployer);

        const newSilverSeconds = 14n * 24n * 3600n;
        const gov = await env.stakingLock.sendSetLockDuration(env.deployer.getSender(), {
            tier: 1,
            duration: newSilverSeconds,
        });
        expect(gov.transactions).toHaveTransaction({ success: true });
        expect((await env.stakingMaster.getGetTierConfig(1n)).durationSeconds).toBe(newSilverSeconds);

        assertRelayFlowClean(gov.transactions, {
            partnerPairs: [[env.stakingLock.address, env.stakingMaster.address]],
        });
    });

    it('PushAllTierConfigs batch sync has zero empty-body hops Lock↔Master', async () => {
        const env = await setupStakingEnvironment('https://example.com/relay03-pushall.json');
        await wireStakingLockPushSync(env.stakingLock, env.stakingMaster, env.deployer);

        const push = await env.stakingLock.sendPushAllTierConfigs(env.deployer.getSender());
        expect(push.transactions).toHaveTransaction({ success: true });

        assertRelayFlowClean(push.transactions, {
            maxTx: 25,
            partnerPairs: [[env.stakingLock.address, env.stakingMaster.address]],
        });
    });

    it('SetAllTierRewardShares multi-push has zero empty-body hops Lock↔Master', async () => {
        const env = await setupStakingEnvironment('https://example.com/relay03-shares.json');
        await wireStakingLockPushSync(env.stakingLock, env.stakingMaster, env.deployer);

        const gov = await env.stakingLock.sendSetAllTierRewardShares(env.deployer.getSender(), [
            12n,
            13n,
            25n,
            50n,
        ]);
        expect(gov.transactions).toHaveTransaction({ success: true });
        expect((await env.stakingMaster.getGetTierConfig(0n)).rewardShare).toBe(12n);

        assertRelayFlowClean(gov.transactions, {
            maxTx: 25,
            partnerPairs: [[env.stakingLock.address, env.stakingMaster.address]],
        });
    });

    it('stake/unstake after tier sync still succeeds (no regression)', async () => {
        const env = await setupStakingEnvironment('https://example.com/relay03-stake.json');
        await wireStakingLockPushSync(env.stakingLock, env.stakingMaster, env.deployer);

        const user = await env.blockchain.treasury('relay03-stake-user');
        await mintAndSyncUser(env, user, 3n * MIN_STAKE_NANO);

        await env.stakingLock.sendSetTierMultiplier(env.deployer.getSender(), {
            tier: 0,
            multiplier: 120n,
        });

        await stakeAs(env, user, 0, MIN_STAKE_NANO);
        expect((await env.stakingMaster.getGetStake(user.address, 0n))!.amount).toBe(MIN_STAKE_NANO);

        const unstake = await env.stakingMaster.sendUnstakeJetton(user.getSender(), {
            tier: 0,
            amount: MIN_STAKE_NANO,
        });
        expect(unstake.transactions).toHaveTransaction({ success: true });
    });
});

describe('IMP-STKFEE-04 — sub-min net stuck funds', () => {
    it('returns jettons to sender when net is below MinStakeNano with StakeForward', async () => {
        const env = await setupStakingEnvironment('https://example.com/stkfee04-return.json');
        const user = await env.blockchain.treasury('stkfee04-return');
        const subMin = MIN_STAKE_NANO - 1n;
        await mintAndSyncUser(env, user, MIN_STAKE_NANO * 2n);

        const masterJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(env.stakingMaster.address)),
        );
        const masterBefore = (await masterJw.getGetWalletData()).balance;

        const tx = await stakeAs(env, user, 1, subMin);
        expect(tx.transactions).toHaveTransaction({ success: true });
        expect(tx.transactions).toHaveTransaction({
            from: env.stakingMaster.address,
            op: 0xf8a7ea5,
            success: true,
        });

        const userJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
        );
        expect((await userJw.getGetWalletData()).balance).toBe(MIN_STAKE_NANO * 2n);
        expect((await masterJw.getGetWalletData()).balance).toBe(masterBefore);
        expect(await env.stakingMaster.getGetStake(user.address, 1n)).toBeNull();
    });

    it('ignores mint/refill dust without StakeForward (no refund path)', async () => {
        const env = await setupStakingEnvironment('https://example.com/stkfee04-dust.json');
        const sender = await env.blockchain.treasury('stkfee04-dust');
        const dust = MIN_STAKE_NANO - 1n;
        await mintAndSyncUser(env, sender, dust);

        const masterJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(env.stakingMaster.address)),
        );
        const masterBefore = (await masterJw.getGetWalletData()).balance;

        const senderJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(sender.address)),
        );
        // IMP-MNAUD-F11: destination (StakingMaster) is excluded → the transfer resolves
        // via master and the wallet entry gate is minTonFeePath (2.05), not 0.58.
        const tx = await senderJw.sendTransfer(sender.getSender(), {
            jettonAmount: dust,
            destinationOwner: env.stakingMaster.address,
            responseDestination: sender.address,
            forwardTonAmount: 0n,
            forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            value: toNano('2.3'),
        });
        expect(tx.transactions).toHaveTransaction({ success: true });

        expect((await masterJw.getGetWalletData()).balance).toBe(masterBefore + dust);
        expect((await senderJw.getGetWalletData()).balance).toBe(0n);
        expect(await env.stakingMaster.getGetStake(sender.address, 0n)).toBeNull();
    });

    it('normal stake at MinStakeNano is unchanged', async () => {
        const env = await setupStakingEnvironment('https://example.com/stkfee04-normal.json');
        const user = await env.blockchain.treasury('stkfee04-normal');
        await mintAndSyncUser(env, user, MIN_STAKE_NANO);
        const tx = await stakeAs(env, user, 0, MIN_STAKE_NANO);
        expect(tx.transactions).toHaveTransaction({ success: true });
        expect((await env.stakingMaster.getGetStake(user.address, 0n))!.amount).toBe(MIN_STAKE_NANO);
        expect(await env.pool.getGetTotalStake(0n)).toBe(MIN_STAKE_NANO);
    });
});

describe('IMP-STAKE-GAS-01 — stake notify gas guard + JettonExcesses', () => {
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

describe('IMP-MNAUD-F09 — underfunded / rejected stake refunds jettons', () => {
    /**
     * minStakeNotifyTon (new stake) = GasForwardStakeJetton(3.5) + GasToPool*2(0.12) + 0.08 = 3.7 TON.
     * Refund needs >= GasForwardStakeJetton (3.5). Window 3.5..3.7 refunds without recording stake.
     */
    const UNDERFUNDED_BUT_REFUNDABLE_FWD = toNano('3.55');

    it('underfunded stake (≥ MinStake, forward TON in refund window) returns jettons; no stake recorded', async () => {
        const env = await setupStakingEnvironment('https://example.com/mnaud-f09-underfund.json');
        const user = await env.blockchain.treasury('mnaud-f09-under');
        const amt = MIN_STAKE_NANO * 2n;
        await mintAndSyncUser(env, user, amt);

        const masterJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(env.stakingMaster.address)),
        );
        const masterBefore = (await masterJw.getGetWalletData()).balance;

        const tx = await stakeAsWithForward(env, user, 0, amt, UNDERFUNDED_BUT_REFUNDABLE_FWD);
        expect(tx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect(tx.transactions).toHaveTransaction({
            from: env.stakingMaster.address,
            op: 0xf8a7ea5, // JettonTransferOut refund
            success: true,
        });

        expect(await env.stakingMaster.getGetStake(user.address, 0n)).toBeNull();
        expect(await env.pool.getGetTotalStake(0n)).toBe(0n);

        const userJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
        );
        expect((await userJw.getGetWalletData()).balance).toBe(amt);
        expect((await masterJw.getGetWalletData()).balance).toBe(masterBefore);
    });

    it('normal funded stake (5 TON forward) still records stake (regression)', async () => {
        const env = await setupStakingEnvironment('https://example.com/mnaud-f09-ok.json');
        const user = await env.blockchain.treasury('mnaud-f09-ok');
        const amt = MIN_STAKE_NANO * 3n;
        await mintAndSyncUser(env, user, amt);

        const tx = await stakeAs(env, user, 0, amt);
        expect(tx.transactions).toHaveTransaction({ success: true });
        expect((await env.stakingMaster.getGetStake(user.address, 0n))!.amount).toBe(amt);
        expect(await env.pool.getGetTotalStake(0n)).toBe(amt);
    });

    it('full-amount transfer without StakeForward refunds jettons (bad forward layout)', async () => {
        const env = await setupStakingEnvironment('https://example.com/mnaud-f09-badfwd.json');
        const user = await env.blockchain.treasury('mnaud-f09-badfwd');
        const amt = MIN_STAKE_NANO;
        await mintAndSyncUser(env, user, amt);

        const masterJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(env.stakingMaster.address)),
        );
        const masterBefore = (await masterJw.getGetWalletData()).balance;

        const userJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
        );
        const tx = await userJw.sendTransfer(user.getSender(), {
            jettonAmount: amt,
            destinationOwner: env.stakingMaster.address,
            responseDestination: user.address,
            forwardTonAmount: toNano('5'),
            forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            value: toNano('10'),
        });
        expect(tx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect(tx.transactions).toHaveTransaction({
            from: env.stakingMaster.address,
            op: 0xf8a7ea5,
            success: true,
        });
        expect(await env.stakingMaster.getGetStake(user.address, 0n)).toBeNull();
        expect((await userJw.getGetWalletData()).balance).toBe(amt);
        expect((await masterJw.getGetWalletData()).balance).toBe(masterBefore);
    });

    it('out-of-range tier StakeForward refunds jettons (no stake recorded)', async () => {
        const env = await setupStakingEnvironment('https://example.com/mnaud-f09-badtier.json');
        const user = await env.blockchain.treasury('mnaud-f09-badtier');
        const amt = MIN_STAKE_NANO;
        await mintAndSyncUser(env, user, amt);

        const masterJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(env.stakingMaster.address)),
        );
        const masterBefore = (await masterJw.getGetWalletData()).balance;

        const userJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
        );
        const tx = await userJw.sendTransfer(user.getSender(), {
            jettonAmount: amt,
            destinationOwner: env.stakingMaster.address,
            responseDestination: user.address,
            forwardTonAmount: toNano('5'),
            forwardPayload: stakeForwardPayload(255),
            value: toNano('10'),
        });
        expect(tx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect(tx.transactions).toHaveTransaction({
            from: env.stakingMaster.address,
            op: 0xf8a7ea5,
            success: true,
        });
        expect(await env.stakingMaster.getGetStake(user.address, 0n)).toBeNull();
        expect((await userJw.getGetWalletData()).balance).toBe(amt);
        expect((await masterJw.getGetWalletData()).balance).toBe(masterBefore);
    });

    it('forward TON below GasForwardStakeJetton cannot refund (residual strand; Low TON return)', async () => {
        const env = await setupStakingEnvironment('https://example.com/mnaud-f09-residual.json');
        const user = await env.blockchain.treasury('mnaud-f09-residual');
        const amt = MIN_STAKE_NANO * 2n;
        await mintAndSyncUser(env, user, amt);

        const tx = await stakeAsWithForward(env, user, 0, amt, toNano('0.1'));
        expect(tx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: false,
            exitCode: StakingMaster_errors_backward['Low TON return'],
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
});

describe('IMP-MNAUD-F01 — mint-to-pool emission funding (physical backing)', () => {
    it('mint-to-pool funding → tickEmission accrues → claim pays real jettons from the funded reserve; principal untouched', async () => {
        const env = await setupStakingEnvironment('https://example.com/imp-mnaud-f01-e2e.json');
        const user = await env.blockchain.treasury('mnaud-f01-user');

        // 1. Fund the emission reserve the bootstrap way: mint 300 BURN directly to the
        //    pool's jetton wallet with the EmissionFundForward payload.
        const fund = await fundEmissionReserveViaMint(env, TOTAL_EMISSION_BUDGET_NANO);
        expect(fund.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: true,
        });
        expect(await env.stakingMaster.getGetEmissionFunded()).toBe(TOTAL_EMISSION_BUDGET_NANO);

        // Physical backing: the reserve jettons actually sit in the pool's wallet, while
        // pool_balance bookkeeping stays untouched (emission unlocks it via ticks only).
        const poolJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.pool.getGetJettonRewardsWallet()),
        );
        expect((await poolJw.getGetWalletData()).balance).toBe(TOTAL_EMISSION_BUDGET_NANO);
        expect(await env.pool.getGetPoolBalance()).toBe(0n);

        // 2. Stake and let the emission schedule run.
        const principal = 10n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, principal);
        await stakeAs(env, user, 0, principal);
        expect(await env.pool.getGetPoolBalance()).toBe(principal);

        const elapsed = 600n;
        advanceTime(env.blockchain, Number(elapsed));

        // 3. Claim ticks emission and must pay REAL jettons out of the funded reserve.
        //    Flexible is the only occupied tier → it earns its 5% slice (IMP-FAUDIT-F03).
        const expectedFlexSlice = (elapsed * EMISSION_NANO_PER_SEC * 5n) / 100n;
        const userJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
        );
        const userBalBefore = (await userJw.getGetWalletData()).balance;

        const claim = await env.stakingMaster.sendClaimRewards(user.getSender(), { tier: 0 });
        expect(claim.transactions).toHaveTransaction({ success: true });

        const emitted = await env.stakingMaster.getGetEmittedSoFar();
        assertPendingRewardCloseToNano(emitted, expectedFlexSlice, 10n);

        const paid = (await userJw.getGetWalletData()).balance - userBalBefore;
        assertPendingRewardCloseToNano(paid, expectedFlexSlice, 10n);
        expect(paid).toBeGreaterThan(0n);
        expect(await env.stakingMaster.getGetPendingReward(user.address, 0n)).toBe(0n);

        // 4. Stakers' principal is not spent by the emission payout: the stake body is
        //    intact and the pool's wallet still covers principal + unspent reserve.
        expect((await env.stakingMaster.getGetStake(user.address, 0n))!.amount).toBe(principal);
        expect((await poolJw.getGetWalletData()).balance).toBe(
            TOTAL_EMISSION_BUDGET_NANO + principal - paid,
        );
        // pool_balance bookkeeping: principal + emitted credit − reward paid out.
        expect(await env.pool.getGetPoolBalance()).toBe(principal + emitted - paid);

        // 5. Full principal exit still works after the emission payout.
        const unstake = await env.stakingMaster.sendUnstakeJetton(user.getSender(), {
            tier: 0,
            amount: principal,
        });
        expect(unstake.transactions).toHaveTransaction({ success: true });
        const finalBal = (await userJw.getGetWalletData()).balance;
        expect(finalBal).toBeGreaterThanOrEqual(userBalBefore + paid + principal);
    });
});

describe('bounce handlers (IMP-AUDIT-08)', () => {
    it('PayRewards bounce restores pool_balance when jetton wallet lacks balance', async () => {
        const env = await setupStakingEnvironment('https://example.com/stake-bounce-pay.json');
        const user = await env.blockchain.treasury('bounce-user');
        const stakeAmt = 10n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, stakeAmt);
        await stakeAs(env, user, 0, stakeAmt);

        const poolRewardWallet = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.pool.getGetJettonRewardsWallet()),
        );
        const walletBal = (await poolRewardWallet.getGetWalletData()).balance;
        expect(walletBal).toBeLessThan(20n * NANO_PER_BURN);

        const masterSender = env.blockchain.sender(env.stakingMaster.address);
        const creditDelta = 50n * NANO_PER_BURN;
        await env.pool.sendCreditPoolBalance(masterSender, creditDelta);
        const poolBalBeforePay = await env.pool.getGetPoolBalance();

        const payoutAmt = 40n * NANO_PER_BURN;
        expect(payoutAmt).toBeGreaterThan(walletBal);

        const payTx = await env.pool.sendPayRewards(masterSender, {
            recipient: user.address,
            amount: payoutAmt,
        });
        expect(payTx.transactions).toHaveTransaction({
            from: env.pool.address,
            to: poolRewardWallet.address,
            op: 0xf8a7ea5,
            success: false,
        });
        expect(payTx.transactions).toHaveTransaction({
            on: env.pool.address,
            success: true,
        });
        expect(await env.pool.getGetPoolBalance()).toBe(poolBalBeforePay);
    });
});

// IMP-MNAUD-F18: after F11 every pool/treasury payout hops wallet → master
// (ResolveJettonTransfer) → wallet (CommitJettonTransfer). A balance failure must
// reach the owner's rollback accounting either as a natural bounce of the inbound
// JettonTransfer (entry pre-check) or as an explicit JettonTransferCommitFailed
// (commit-stage race window).
describe('IMP-MNAUD-F18 — commit-stage failure rollback (resolve path)', () => {
    const OP_COMMIT_JETTON_TRANSFER = 0x6a3b2c21;
    const OP_JETTON_TRANSFER_COMMIT_FAILED = 0x6a3b2c22;
    const OP_COMMIT_JETTON_TRANSFER_BOUNCED_EVENT = 0x6a3b2c23;

    it('PayUnstake bounce restores pool_balance when jetton wallet lacks balance', async () => {
        const env = await setupStakingEnvironment('https://example.com/f18-unstake-bounce.json');
        const user = await env.blockchain.treasury('f18-unstake-user');
        const stakeAmt = 10n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, stakeAmt);
        await stakeAs(env, user, 0, stakeAmt);

        const poolRewardWallet = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.pool.getGetJettonRewardsWallet()),
        );
        const walletBal = (await poolRewardWallet.getGetWalletData()).balance;

        const masterSender = env.blockchain.sender(env.stakingMaster.address);
        await env.pool.sendCreditPoolBalance(masterSender, 50n * NANO_PER_BURN);
        const poolBalBefore = await env.pool.getGetPoolBalance();

        // principal + capped reward = 50 BURN > real wallet balance (~10 BURN).
        const rewardAsk = 40n * NANO_PER_BURN;
        expect(stakeAmt + rewardAsk).toBeGreaterThan(walletBal);

        const payTx = await env.pool.sendPayUnstake(masterSender, {
            recipient: user.address,
            principal: stakeAmt,
            reward: rewardAsk,
        });
        expect(payTx.transactions).toHaveTransaction({
            from: env.pool.address,
            to: poolRewardWallet.address,
            op: 0xf8a7ea5,
            success: false,
        });
        expect(payTx.transactions).toHaveTransaction({
            on: env.pool.address,
            inMessageBounced: true,
            success: true,
        });
        expect(await env.pool.getGetPoolBalance()).toBe(poolBalBefore);
    });

    it('commit-stage balance failure sends JettonTransferCommitFailed to the owner and pool rolls back', async () => {
        const env = await setupStakingEnvironment('https://example.com/f18-commit-fail.json');
        const user = await env.blockchain.treasury('f18-commit-user');
        const stakeAmt = 10n * NANO_PER_BURN;
        await mintAndSyncUser(env, user, stakeAmt);
        await stakeAs(env, user, 0, stakeAmt);

        const poolRewardWallet = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.pool.getGetJettonRewardsWallet()),
        );
        const walletBal = (await poolRewardWallet.getGetWalletData()).balance;
        const poolBalBefore = await env.pool.getGetPoolBalance();

        // Race window: balance changed between the wallet entry check and master's
        // commit hop. Forge the CommitJettonTransfer master would send.
        const payoutAmt = walletBal + 5n * NANO_PER_BURN;
        const commitTx = await env.blockchain.sendMessage(
            internal({
                from: env.jettonMaster.address,
                to: poolRewardWallet.address,
                value: toNano('2.2'),
                bounce: true,
                body: beginCell()
                    .store(
                        storeCommitJettonTransfer({
                            $$type: 'CommitJettonTransfer',
                            queryId: 777n,
                            amount: payoutAmt,
                            destination: user.address,
                            responseDestination: env.stakingMaster.address,
                            forwardTonAmount: 1n,
                            forwardPayload: beginCell().storeUint(0, 1).endCell(),
                            excludedTransfer: true,
                        }),
                    )
                    .endCell(),
            }),
        );

        // The wallet must NOT throw (the bounce would be silently swallowed by master);
        // it must deliver an explicit failure signal to its owner instead.
        expect(commitTx.transactions).toHaveTransaction({
            on: poolRewardWallet.address,
            op: OP_COMMIT_JETTON_TRANSFER,
            success: true,
        });
        expect(commitTx.transactions).toHaveTransaction({
            from: poolRewardWallet.address,
            to: env.pool.address,
            op: OP_JETTON_TRANSFER_COMMIT_FAILED,
            success: true,
        });
        // No jettons moved; pool bookkeeping restored by the rollback handler.
        expect((await poolRewardWallet.getGetWalletData()).balance).toBe(walletBal);
        expect(await env.pool.getGetPoolBalance()).toBe(poolBalBefore + payoutAmt);
    });

    it('pool rejects JettonTransferCommitFailed from a non-wallet sender', async () => {
        const env = await setupStakingEnvironment('https://example.com/f18-commit-auth.json');
        const rogue = await env.blockchain.treasury('f18-rogue');
        const poolBalBefore = await env.pool.getGetPoolBalance();

        const rogueTx = await env.blockchain.sendMessage(
            internal({
                from: rogue.address,
                to: env.pool.address,
                value: toNano('0.05'),
                bounce: true,
                body: beginCell()
                    .storeUint(OP_JETTON_TRANSFER_COMMIT_FAILED, 32)
                    .storeUint(1n, 64)
                    .storeCoins(100n * NANO_PER_BURN)
                    .endCell(),
            }),
        );
        expect(rogueTx.transactions).toHaveTransaction({
            on: env.pool.address,
            success: false,
        });
        expect(await env.pool.getGetPoolBalance()).toBe(poolBalBefore);
    });

    it('master emits CommitJettonTransferBounced when a commit hop bounces back', async () => {
        const env = await setupStakingEnvironment('https://example.com/f18-master-emit.json');
        const poolJw = await env.pool.getGetJettonRewardsWallet();
        const bouncedAmt = 7n * NANO_PER_BURN;

        // Residual (non-balance) commit failure: the bounce body only carries the
        // prefix (opcode + queryId + amount) back to master.
        const bounceTx = await env.blockchain.sendMessage(
            internal({
                from: poolJw,
                to: env.jettonMaster.address,
                value: toNano('0.05'),
                bounced: true,
                body: beginCell()
                    .storeUint(0xffffffff, 32)
                    .storeUint(OP_COMMIT_JETTON_TRANSFER, 32)
                    .storeUint(888n, 64)
                    .storeCoins(bouncedAmt)
                    .endCell(),
            }),
        );
        expect(bounceTx.transactions).toHaveTransaction({
            on: env.jettonMaster.address,
            inMessageBounced: true,
            success: true,
        });
        // Not silently swallowed anymore: an external event is emitted for monitoring.
        expect(bounceTx.externals.length).toBeGreaterThanOrEqual(1);
        const eventBody = bounceTx.externals[0].body.beginParse();
        expect(eventBody.loadUint(32)).toBe(OP_COMMIT_JETTON_TRANSFER_BOUNCED_EVENT);
        expect(eventBody.loadUintBig(64)).toBe(888n);
        expect(eventBody.loadCoins()).toBe(bouncedAmt);
    });
});
