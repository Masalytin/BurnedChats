import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { expect } from '@jest/globals';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingLock } from '../wrappers/StakingLock';
import { StakingMaster } from '../wrappers/StakingMaster';
import { StakingPool, STAKING_PLACEHOLDER_MASTER } from '../wrappers/StakingPool';
import { BurnJettonWallet_errors_backward } from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';
import { DEPLOY_TON, MINT_TON, NANO_PER_BURN, SANDBOX_NOW, stakeForwardPayload } from './helpers';
import {
    MIN_STAKE_NANO,
    mintAndSyncUser,
    primeStakingMasterJettonWallet,
    setupStakingEnvironment,
    StakingTestEnv,
    wireMasterJettonWallet,
} from './staking-helpers';
import '@ton/test-utils';

/** Frontend excluded-path stake attach (IMP-STKFEE-03 / REPORT §3.3). */
const STAKE_ATTACHED_TON = 5_850_540_001n;
/**
 * Cold / live-resolve stake attach after IMP-MNAUD-F10: wallet no longer treats
 * live-resolve as excluded-path floor; need forward + minTonFeePath (2.1) headroom.
 */
const STAKE_ATTACHED_TON_LIVE_RESOLVE = toNano('8');
const STAKE_FORWARD_TON = toNano('5');
const STAKE_TIER = 2;

async function openUserWallet(env: StakingTestEnv, user: SandboxContract<TreasuryContract>) {
    const addr = await env.jettonMaster.getGetWalletAddress(user.address);
    return env.blockchain.openContract(BurnJettonWallet.fromAddress(addr));
}

/**
 * Deploy staking stack, sync staker fee-config while master excluded-list is still empty,
 * then add StakingMaster/Pool to excluded on master without re-syncing staker wallet.
 */
async function setupColdStakerEnv(stakeAmt: bigint): Promise<{
    env: StakingTestEnv;
    staker: SandboxContract<TreasuryContract>;
}> {
    const blockchain = await Blockchain.create();
    blockchain.now = SANDBOX_NOW;
    const deployer = await blockchain.treasury('deployer');
    const staker = await blockchain.treasury('staker');

    const content = BurnJettonMaster.jettonContentFromUri('https://example.com/stkgate-cold.json');
    const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
    const jettonMaster = blockchain.openContract(m);
    await jettonMaster.send(deployer.getSender(), { value: DEPLOY_TON }, null);

    const poolBase = await StakingPool.prepareInit({
        bootstrapOwner: deployer.address,
        jettonMinter: jettonMaster.address,
        stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
    });
    const pool = blockchain.openContract(poolBase);
    await pool.send(deployer.getSender(), { value: toNano('0.2') }, null);

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

    const wire = await pool.sendWireStakingMaster(deployer.getSender(), stakingMaster.address);
    expect(wire.transactions).toHaveTransaction({ success: true });

    await jettonMaster.sendSetFeeDestinations(deployer.getSender(), poolBase.address, deployer.address);
    await jettonMaster.sendMint(deployer.getSender(), staker.address, stakeAmt, 1n, MINT_TON);
    await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), staker.address);

    await jettonMaster.sendAddExcluded(deployer.getSender(), poolBase.address);
    await jettonMaster.sendAddExcluded(deployer.getSender(), stakingMaster.address);
    await primeStakingMasterJettonWallet(jettonMaster, deployer, stakingMaster);
    await jettonMaster.sendMint(deployer.getSender(), poolBase.address, 50n * NANO_PER_BURN, 1n, MINT_TON);

    const env: StakingTestEnv = {
        blockchain,
        deployer,
        jettonMaster,
        poolAddress: poolBase.address,
        stakingLock,
        stakingMaster,
        pool,
    };
    return { env, staker };
}

describe('IMP-STKGATE-03 — staking deposit from unsynced jetton wallet', () => {
    it('cold wallet: excluded attach passes live-resolve gate and stakes (not exit 32113)', async () => {
        const stakeAmt = 30n * NANO_PER_BURN;
        const { env, staker } = await setupColdStakerEnv(stakeAmt);

        expect(await env.jettonMaster.getGetIsExcluded(env.stakingMaster.address)).toBe(true);
        const userJw = await openUserWallet(env, staker);
        expect(await userJw.getGetFeeConfigActive()).toBe(true);

        const balanceBefore = (await userJw.getGetWalletData()).balance;
        const r = await userJw.sendTransfer(staker.getSender(), {
            jettonAmount: stakeAmt,
            destinationOwner: env.stakingMaster.address,
            responseDestination: staker.address,
            forwardTonAmount: STAKE_FORWARD_TON,
            forwardPayload: stakeForwardPayload(STAKE_TIER),
            value: STAKE_ATTACHED_TON_LIVE_RESOLVE,
        });

        expect(r.transactions).not.toHaveTransaction({
            success: false,
            exitCode: BurnJettonWallet_errors_backward['Insufficient amount of TON attached'],
        });
        expect(r.transactions).toHaveTransaction({ success: true });

        const stake = await env.stakingMaster.getGetStake(staker.address, BigInt(STAKE_TIER));
        expect(stake != null).toBe(true);
        expect(stake!.amount).toBeGreaterThanOrEqual(MIN_STAKE_NANO);
        expect((await userJw.getGetWalletData()).balance).toBeLessThan(balanceBefore);
        expect(await env.pool.getGetTotalStake(BigInt(STAKE_TIER))).toBeGreaterThan(0n);
    });

    it('defense: under-gassed live-resolve rejects at wallet before balance debit (IMP-MNAUD-F10)', async () => {
        const env = await setupStakingEnvironment('https://example.com/stkgate-defense.json');
        const staker = await env.blockchain.treasury('staker');
        const recipient = await env.blockchain.treasury('recipient');

        const amount = 5n * NANO_PER_BURN;
        await mintAndSyncUser(env, staker, amount);
        await mintAndSyncUser(env, recipient, 1n);

        expect(await env.jettonMaster.getGetIsExcluded(recipient.address)).toBe(false);

        const userJw = await openUserWallet(env, staker);
        const balanceBefore = (await userJw.getGetWalletData()).balance;

        // Excluded-path attach (≈5.85) with forward 5 TON: clears old cheap live-resolve
        // gate, fails new minTonFeePath gate at wallet entry (no master strand).
        const r = await userJw.sendTransfer(staker.getSender(), {
            jettonAmount: amount,
            destinationOwner: recipient.address,
            responseDestination: staker.address,
            forwardTonAmount: STAKE_FORWARD_TON,
            value: STAKE_ATTACHED_TON,
        });

        expect(r.transactions).toHaveTransaction({
            success: false,
            exitCode: BurnJettonWallet_errors_backward['Insufficient amount of TON attached'],
        });
        expect((await userJw.getGetWalletData()).balance).toBe(balanceBefore);
    });
});
