import { Blockchain } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingMaster } from '../wrappers/StakingMaster';
import {
    StakingLock,
    TIER_DIAMOND_SECONDS,
    TIER_GOLD_SECONDS,
    TIER_SILVER_SECONDS,
} from '../wrappers/StakingLock';
import { StakingPool, STAKING_PLACEHOLDER_MASTER } from '../wrappers/StakingPool';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { StakingLock_errors_backward } from '../build/StakingMaster/StakingMaster_StakingLock';
import { StakingPool_errors_backward } from '../build/StakingPool/StakingPool_StakingPool';
import { DEPLOY_TON, MINT_TON, NANO_PER_BURN, SANDBOX_NOW } from './helpers';
import '@ton/test-utils';

describe('Staking Pool + Master (P5-2-1-1)', () => {
    it('deploys in Sandbox; stake updates pool tiers; exclusions + payouts', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');
        const user = await blockchain.treasury('user');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/md.json');
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

        const inferredRw = await poolOnChain.getGetJettonRewardsWallet();
        expect(inferredRw.equals(await jettonMaster.getGetWalletAddress(poolBase.address))).toBe(true);

        const lockBase = await StakingLock.prepareInit(deployer.address);
        const stakingLock = blockchain.openContract(lockBase);
        await stakingLock.send(deployer.getSender(), { value: toNano('0.08') }, null);

        const masterBase = await StakingMaster.prepareInit(
            poolBase.address,
            jettonMaster.address,
            stakingLock.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('10') }, null);

        expect((await stakingMaster.getGetStakingLock()).equals(stakingLock.address)).toBe(true);

        const wire = await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);
        expect(wire.transactions).toHaveTransaction({ success: true });
        expect(await poolOnChain.getGetMasterWired()).toBe(true);
        expect((await stakingMaster.getGetStake(user.address)) == null).toBe(true);

        await jettonMaster.sendSetFeeDestinations(deployer.getSender(), poolBase.address, deployer.address);
        await jettonMaster.sendAddExcluded(deployer.getSender(), poolBase.address);

        const stakeAmt = 10n * NANO_PER_BURN;
        await jettonMaster.sendMint(deployer.getSender(), user.address, stakeAmt, 1n, MINT_TON);
        await jettonMaster.sendMint(deployer.getSender(), poolBase.address, 50n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), user.address);

        const userStakeTx = await stakingMaster.sendUserStake(user.getSender(), { amount: stakeAmt, tier: 0 });
        expect(userStakeTx.transactions).toHaveTransaction({ success: true });
        expect(await poolOnChain.getGetTotalStake(0n)).toBe(stakeAmt);

        const stakeData = await stakingMaster.getGetStake(user.address);
        expect(stakeData != null).toBe(true);

        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), poolBase.address);

        const poolRewardWallet = blockchain.openContract(
            BurnJettonWallet.fromAddress(await poolOnChain.getGetJettonRewardsWallet()),
        );
        expect((await poolRewardWallet.getGetWalletData()).balance).toBe(50n * NANO_PER_BURN);

        const masterSender = blockchain.sender(stakingMaster.address);

        const creditTx = await poolOnChain.sendCreditPoolBalance(masterSender, 5n * NANO_PER_BURN);
        expect(creditTx.transactions).toHaveTransaction({ success: true });
        expect(await poolOnChain.getGetPoolBalance()).toBe(5n * NANO_PER_BURN);

        const payoutUserWalletAddr = await jettonMaster.getGetWalletAddress(user.address);
        const payTx = await poolOnChain.sendPayRewards(masterSender, {
            recipient: user.address,
            amount: 1n * NANO_PER_BURN,
        });
        expect(payTx.transactions).toHaveTransaction({ success: true });
        const userJw = blockchain.openContract(BurnJettonWallet.fromAddress(payoutUserWalletAddr));
        // Pool wallet is excluded: reward transfer should settle without deducting staking fee splits.
        expect((await userJw.getGetWalletData()).balance).toBe(stakeAmt + NANO_PER_BURN);
        expect(await poolOnChain.getGetPoolBalance()).toBe(4n * NANO_PER_BURN);

        const rogueInc = await poolOnChain.sendIncrementDirect(user.getSender(), { tier: 0, delta: 1n });
        expect(rogueInc.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingPool_errors_backward['Only staking master'],
        });

        await stakingMaster.sendUserUnstake(user.getSender());
        expect((await stakingMaster.getGetStake(user.address)) == null).toBe(true);
        expect(await poolOnChain.getGetTotalStake(0n)).toBe(0n);
    });

    it('Master rejects duplicate stake', async () => {
        const blockchain = await Blockchain.create();
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
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('10') }, null);

        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await jettonMaster.sendMint(deployer.getSender(), user.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        const a = await stakingMaster.sendUserStake(user.getSender(), { amount: NANO_PER_BURN, tier: 1 });
        expect(a.transactions).toHaveTransaction({ success: true });

        const b = await stakingMaster.sendUserStake(user.getSender(), { amount: NANO_PER_BURN, tier: 1 });
        expect(b.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingMaster_errors_backward['Already staked'],
        });
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
            exitCode: StakingLock_errors_backward['Not governor'],
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
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('10') }, null);
        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await jettonMaster.sendMint(deployer.getSender(), user.address, 15n * NANO_PER_BURN, 1n, MINT_TON);

        const silverStake = await stakingMaster.sendUserStake(user.getSender(), {
            amount: NANO_PER_BURN,
            tier: 1,
        });
        expect(silverStake.transactions).toHaveTransaction({ success: true });

        const silverEarly = await stakingMaster.sendUserUnstake(user.getSender());
        expect(silverEarly.transactions).toHaveTransaction({
            success: false,
            exitCode: StakingMaster_errors_backward['Still locked'],
        });

        blockchain.now += Number(TIER_SILVER_SECONDS);
        const silverLate = await stakingMaster.sendUserUnstake(user.getSender());
        expect(silverLate.transactions).toHaveTransaction({ success: true });

        const flexStake = await stakingMaster.sendUserStake(user.getSender(), {
            amount: NANO_PER_BURN,
            tier: 0,
        });
        expect(flexStake.transactions).toHaveTransaction({ success: true });
        const flexUnstake = await stakingMaster.sendUserUnstake(user.getSender());
        expect(flexUnstake.transactions).toHaveTransaction({ success: true });
    });
});
