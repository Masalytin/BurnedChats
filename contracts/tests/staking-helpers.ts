import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, toNano } from '@ton/core';
import { expect } from '@jest/globals';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingLock } from '../wrappers/StakingLock';
import { StakingMaster } from '../wrappers/StakingMaster';
import { emissionFundForwardPayload, StakingPool, STAKING_PLACEHOLDER_MASTER } from '../wrappers/StakingPool';
import { DEPLOY_TON, MINT_TON, NANO_PER_BURN, SANDBOX_NOW, stakeForwardPayload } from './helpers';

/** Matches StakingMaster.MinStakeNano (0.01 BURN). */
export const MIN_STAKE_NANO = 10_000_000n;

/** EmissionNanoPerSec in staking-master.tact */
export const EMISSION_NANO_PER_SEC = 3170n;

/** TotalEmissionNano (300 BURN) */
export const TOTAL_EMISSION_BUDGET_NANO = 300_000_000_000n;

export const SECONDS_PER_DAY = 86_400n;

export type StakingTestEnv = {
    blockchain: Blockchain;
    deployer: SandboxContract<TreasuryContract>;
    jettonMaster: SandboxContract<BurnJettonMaster>;
    /** Pool contract address (for mint/fee targets). */
    poolAddress: Address;
    stakingLock: SandboxContract<StakingLock>;
    stakingMaster: SandboxContract<StakingMaster>;
    pool: SandboxContract<StakingPool>;
};

export async function wireMasterJettonWallet(
    stakingMaster: SandboxContract<StakingMaster>,
    jettonMaster: { getGetWalletAddress(owner: Address): Promise<Address> },
    bootstrap: SandboxContract<TreasuryContract>,
) {
    const jwAddr = await jettonMaster.getGetWalletAddress(stakingMaster.address);
    const tx = await stakingMaster.sendSetMasterJettonWallet(bootstrap.getSender(), jwAddr);
    expect(tx.transactions).toHaveTransaction({ success: true });
}

/** Deploy staking master's jetton wallet (if needed) and sync fee config so exclusions apply on JW routing. */
export async function primeStakingMasterJettonWallet(
    jettonMaster: SandboxContract<BurnJettonMaster>,
    deployer: SandboxContract<TreasuryContract>,
    stakingMaster: SandboxContract<StakingMaster>,
) {
    const mintTx = await jettonMaster.sendMint(deployer.getSender(), stakingMaster.address, 1n, 1n, MINT_TON);
    expect(mintTx.transactions).toHaveTransaction({ success: true });
    const syncTx = await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), stakingMaster.address);
    expect(syncTx.transactions).toHaveTransaction({ success: true });
}

export async function bootstrapStakeFeesAndPrimeMaster(
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

/**
 * Single-call deploy: Jetton master, Pool, Lock, Master, wire + fee bootstrap.
 * Pool uses STAKING_PLACEHOLDER_MASTER until wire completes.
 */
export async function setupStakingEnvironment(
    jettonMetadataUri = 'https://example.com/staking-test.json',
): Promise<StakingTestEnv> {
    const blockchain = await Blockchain.create();
    blockchain.now = SANDBOX_NOW;
    const deployer = await blockchain.treasury('deployer');

    const content = BurnJettonMaster.jettonContentFromUri(jettonMetadataUri);
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

    await bootstrapStakeFeesAndPrimeMaster(jettonMaster, deployer, poolBase.address, stakingMaster);

    return {
        blockchain,
        deployer,
        jettonMaster,
        poolAddress: poolBase.address,
        stakingLock,
        stakingMaster,
        pool,
    };
}

/** Low-level jetton stake (legacy tests construct pool/master manually without StakingTestEnv). */
export async function jettonStakeToMaster(
    blockchain: Blockchain,
    jettonMaster: { getGetWalletAddress(owner: Address): Promise<Address> },
    from: SandboxContract<TreasuryContract>,
    stakingMasterAddr: Address,
    amountNano: bigint,
    tier: number,
) {
    const userJw = blockchain.openContract(
        BurnJettonWallet.fromAddress(await jettonMaster.getGetWalletAddress(from.address)),
    );
    return userJw.sendTransfer(from.getSender(), {
        jettonAmount: amountNano,
        destinationOwner: stakingMasterAddr,
        responseDestination: from.address,
        forwardTonAmount: toNano('5'),
        forwardPayload: stakeForwardPayload(tier),
        value: toNano('10'),
    });
}

/** Stake via user's jetton wallet with custom forward TON (for gas guard tests). */
export async function stakeAsWithForward(
    env: StakingTestEnv,
    user: SandboxContract<TreasuryContract>,
    tier: number,
    amountNano: bigint,
    forwardTonNano: bigint,
    attachTonNano = toNano('10'),
) {
    const userJw = env.blockchain.openContract(
        BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(user.address)),
    );
    return userJw.sendTransfer(user.getSender(), {
        jettonAmount: amountNano,
        destinationOwner: env.stakingMaster.address,
        responseDestination: user.address,
        forwardTonAmount: forwardTonNano,
        forwardPayload: stakeForwardPayload(tier),
        value: attachTonNano,
    });
}

/** Stake via user's jetton wallet (TransferNotification → StakingMaster). */
export async function stakeAs(
    env: StakingTestEnv,
    user: SandboxContract<TreasuryContract>,
    tier: number,
    amountNano: bigint,
) {
    return jettonStakeToMaster(env.blockchain, env.jettonMaster, user, env.stakingMaster.address, amountNano, tier);
}

/** Advance Sandbox clock (`blockchain.now`). */
export function advanceTime(blockchain: Blockchain, seconds: number): void {
    expect(blockchain.now !== undefined && blockchain.now !== null).toBe(true);
    blockchain.now = blockchain.now! + seconds;
}

/** Assert bigint reward is within nano tolerance of expected (rounding). */
export function assertPendingRewardCloseToNano(actual: bigint, expectedNano: bigint, toleranceNano: bigint): void {
    const lo = expectedNano > toleranceNano ? expectedNano - toleranceNano : 0n;
    const hi = expectedNano + toleranceNano;
    expect(actual >= lo && actual <= hi).toBe(true);
}

/**
 * Fund the emission reserve the mint-to-pool way (IMP-MNAUD-F01): mint `amountNano`
 * BURN directly to the pool's jetton wallet with an `EmissionFundForward` payload.
 * The pool's JettonNotification handler relays `EmissionReserveFunded` to the master,
 * which is the only path that raises `emissionFunded` (real physical backing).
 */
export async function fundEmissionReserveViaMint(env: StakingTestEnv, amountNano: bigint) {
    return env.jettonMaster.sendMint(
        env.deployer.getSender(),
        env.poolAddress,
        amountNano,
        toNano('0.1'),
        MINT_TON,
        emissionFundForwardPayload(),
    );
}

export async function mintAndSyncUser(
    env: StakingTestEnv,
    user: SandboxContract<TreasuryContract>,
    amountNano: bigint,
) {
    const { deployer, jettonMaster } = env;
    await jettonMaster.sendMint(deployer.getSender(), user.address, amountNano, 1n, MINT_TON);
    await jettonMaster.sendSyncFeeConfigToWallet(deployer.getSender(), user.address);
}

/** Triggers staking-master emission tick via tiny Flexible unstake (requires active stake >= amount). */
export async function tickEmissionViaMicroUnstake(
    env: StakingTestEnv,
    holder: SandboxContract<TreasuryContract>,
    unstakeNANO = 1n,
) {
    return env.stakingMaster.sendUnstakeJetton(holder.getSender(), {
        tier: 0,
        amount: unstakeNANO,
    });
}

export { NANO_PER_BURN };
