import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, toNano } from '@ton/core';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import {
    StakingLock,
    TIER_DIAMOND_SECONDS,
    TIER_GOLD_SECONDS,
    TIER_SILVER_SECONDS,
} from '../wrappers/StakingLock';
import { StakingMaster } from '../wrappers/StakingMaster';
import { StakingPool, STAKING_PLACEHOLDER_MASTER } from '../wrappers/StakingPool';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { StakingLock_errors_backward } from '../build/StakingMaster/StakingMaster_StakingLock';
import { StakingPool_errors_backward } from '../build/StakingPool/StakingPool_StakingPool';
import { DEPLOY_TON, MINT_TON, NANO_PER_BURN, SANDBOX_NOW, stakeForwardPayload } from './helpers';
import '@ton/test-utils';

const REWARD_SCALE = StakingMaster.RewardScale;

async function wireMasterJettonWallet(
    stakingMaster: SandboxContract<StakingMaster>,
    jettonMaster: { getGetWalletAddress(owner: Address): Promise<Address> },
    bootstrap: SandboxContract<TreasuryContract>,
) {
    const jwAddr = await jettonMaster.getGetWalletAddress(stakingMaster.address);
    const tx = await stakingMaster.sendSetMasterJettonWallet(bootstrap.getSender(), jwAddr);
    expect(tx.transactions).toHaveTransaction({ success: true });
}

/** Deploy staking master's jetton wallet (if needed) and sync fee config so exclusions apply on JW routing. */
async function primeStakingMasterJettonWallet(
    jettonMaster: SandboxContract<BurnJettonMaster>,
    deployer: SandboxContract<TreasuryContract>,
    stakingMaster: SandboxContract<StakingMaster>,
) {
    const mintTx = await jettonMaster.sendMint(deployer.getSender(), stakingMaster.address, 1n, 1n, MINT_TON);
    expect(mintTx.transactions).toHaveTransaction({ success: true });
    const syncTx = await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), stakingMaster.address);
    expect(syncTx.transactions).toHaveTransaction({ success: true });
}

async function bootstrapStakeFeesAndPrimeMaster(
    jettonMaster: SandboxContract<BurnJettonMaster>,
    deployer: SandboxContract<TreasuryContract>,
    poolHolder: Address,
    stakingMaster: SandboxContract<StakingMaster>,
) {
    await jettonMaster.sendSetFeeDestinations(deployer.getSender(), poolHolder, deployer.address);
    await jettonMaster.sendAddExcluded(deployer.getSender(), poolHolder);
    await jettonMaster.sendAddExcluded(deployer.getSender(), stakingMaster.address);
    await primeStakingMasterJettonWallet(jettonMaster, deployer, stakingMaster);
}

async function jettonStake(
    blockchain: Blockchain,
    jettonMaster: { getGetWalletAddress(owner: Address): Promise<Address> },
    from: SandboxContract<TreasuryContract>,
    stakingMasterAddr: Address,
    amount: bigint,
    tier: number,
) {
    const userJw = blockchain.openContract(
        BurnJettonWallet.fromAddress(await jettonMaster.getGetWalletAddress(from.address)),
    );
    return userJw.sendTransfer(from.getSender(), {
        jettonAmount: amount,
        destinationOwner: stakingMasterAddr,
        responseDestination: from.address,
        forwardTonAmount: toNano('5'),
        forwardPayload: stakeForwardPayload(tier),
        value: toNano('10'),
    });
}

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

        const userStakeTx = await jettonStake(blockchain, jettonMaster, user, stakingMaster.address, stakeAmt, 0);
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
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);

        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), user.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), user.address);

        const a = await jettonStake(blockchain, jettonMaster, user, stakingMaster.address, NANO_PER_BURN, 1);
        expect(a.transactions).toHaveTransaction({ success: true });

        blockchain.now = SANDBOX_NOW;
        const b = await jettonStake(blockchain, jettonMaster, user, stakingMaster.address, NANO_PER_BURN, 1);
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
            deployer.address,
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);
        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), user.address, 15n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), user.address);

        const silverStake = await jettonStake(blockchain, jettonMaster, user, stakingMaster.address, NANO_PER_BURN, 1);
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

        const flexStake = await jettonStake(blockchain, jettonMaster, user, stakingMaster.address, NANO_PER_BURN, 0);
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
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);

        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);
        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), alice.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), alice.address);

        const aliceStakeAmt = NANO_PER_BURN;
        await jettonStake(blockchain, jettonMaster, alice, stakingMaster.address, aliceStakeAmt, 0);
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

        await jettonStake(blockchain, jettonMaster, alice, stakingMaster.address, aAmt, 0);
        await jettonStake(blockchain, jettonMaster, bob, stakingMaster.address, bAmt, 0);

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
    const MIN_STAKE_NANO = 10_000_000n;

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
        );
        const stakingMaster = blockchain.openContract(masterBase);
        await stakingMaster.send(deployer.getSender(), { value: toNano('50') }, null);
        await wireMasterJettonWallet(stakingMaster, jettonMaster, deployer);
        await poolOnChain.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);

        await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

        await jettonMaster.sendMint(deployer.getSender(), poolBase.address, 50n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendMint(deployer.getSender(), alice.address, 20n * NANO_PER_BURN, 1n, MINT_TON);
        await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), alice.address);

        const stakeTx = await jettonStake(blockchain, jettonMaster, alice, stakingMaster.address, MIN_STAKE_NANO, 0);
        expect(stakeTx.transactions).toHaveTransaction({ success: true });
        expect(await stakingMaster.getGetEmittedSoFar()).toBe(0n);

        blockchain.now! += 120;
        const unstakeTiny = await stakingMaster.sendUnstakeJetton(alice.getSender(), {
            tier: 0,
            amount: 1n,
        });
        expect(unstakeTiny.transactions).toHaveTransaction({ success: true });

        const expectedEmitted = 120n * 3170n;
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
