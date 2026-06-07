import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Slice, toNano } from '@ton/core';
import { storeStakeForward, type StakeForward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { expect } from '@jest/globals';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';

/** 9 decimals */
export const NANO_PER_BURN = 10n ** 9n;

export const DEPLOY_TON = toNano('0.15');
export const MINT_TON = toNano('0.25');
export const TRANSFER_TON = toNano('3.5');
/** Excluded-path JettonTransfer attach (post IMP-JETTON-GAS-02 gate). */
export const TRANSFER_TON_EXCLUDED = toNano('0.7');

/** Jetton forward_payload for staking master (`StakeForward` in ref, either-bit = 1). */
export function stakeForwardPayload(tier: number): Slice {
    const sf: StakeForward = { $$type: 'StakeForward', tier: BigInt(tier) };
    return beginCell()
        .storeUint(1, 1)
        .storeRef(beginCell().store(storeStakeForward(sf)).endCell())
        .endCell()
        .asSlice();
}

/** Fixed sandbox clock for reproducible hour buckets / activity windows. */
export const SANDBOX_NOW = 1_700_000_000;

export type JettonDeployedContext = {
    blockchain: Blockchain;
    deployer: SandboxContract<TreasuryContract>;
    userX: SandboxContract<TreasuryContract>;
    userY: SandboxContract<TreasuryContract>;
    staking: SandboxContract<TreasuryContract>;
    treasury: SandboxContract<TreasuryContract>;
    master: SandboxContract<BurnJettonMaster>;
};

/**
 * Deploy BURN master, configure staking/treasury fee destinations.
 */
export async function deployJetton(): Promise<JettonDeployedContext> {
    const blockchain = await Blockchain.create();
    blockchain.now = SANDBOX_NOW;

    const deployer = await blockchain.treasury('deployer');
    const userX = await blockchain.treasury('userX');
    const userY = await blockchain.treasury('userY');
    const staking = await blockchain.treasury('stakingPool');
    const treasury = await blockchain.treasury('treasury');

    const content = BurnJettonMaster.jettonContentFromUri('https://example.com/jetton/metadata.json');
    const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
    const master = blockchain.openContract(m);

    const deployResult = await master.send(deployer.getSender(), { value: DEPLOY_TON }, null);
    expect(deployResult.transactions).toHaveTransaction({
        from: deployer.address,
        to: master.address,
        deploy: true,
        success: true,
    });

    const feeDest = await master.sendSetFeeDestinations(deployer.getSender(), staking.address, treasury.address);
    expect(feeDest.transactions).toHaveTransaction({ success: true });

    return { blockchain, deployer, userX, userY, staking, treasury, master };
}

export async function getWallet(
    ctx: JettonDeployedContext,
    owner: Address,
): Promise<SandboxContract<BurnJettonWallet>> {
    const addr = await ctx.master.getGetWalletAddress(owner);
    return ctx.blockchain.openContract(BurnJettonWallet.fromAddress(addr));
}

async function tryWalletBalance(w: SandboxContract<BurnJettonWallet>): Promise<bigint> {
    try {
        return (await w.getGetWalletData()).balance;
    } catch {
        return 0n;
    }
}

/**
 * Mark TEP-74 owner addresses as fee-excluded on master (admin must sync wallets afterward).
 */
export async function setupExcluded(ctx: JettonDeployedContext, holders: Address[]): Promise<void> {
    for (const h of holders) {
        const r = await ctx.master.sendAddExcluded(ctx.deployer.getSender(), h);
        expect(r.transactions).toHaveTransaction({ success: true });
    }
}

/**
 * Executes a fee-bearing transfer from `from` to `toOwner` and asserts burn/staking/treasury buckets and recipient net.
 * Call `sendSyncFeeConfigToWallet` for the sender holder before transfer when the wallet needs an up-to-date fee config.
 */
export async function transferAndAssertFees(
    ctx: JettonDeployedContext,
    from: SandboxContract<TreasuryContract>,
    toOwner: Address,
    jettonAmount: bigint,
    expectedBurn: bigint,
    expectedStaking: bigint,
    expectedTreasury: bigint,
): Promise<void> {
    const net = jettonAmount - expectedBurn - expectedStaking - expectedTreasury;
    expect(net >= 0n).toBe(true);
    expect(expectedBurn + expectedStaking + expectedTreasury + net).toBe(jettonAmount);

    const supplyBefore = (await ctx.master.getGetJettonData()).totalSupply;
    const walletFrom = await getWallet(ctx, from.address);
    const recipientW = await getWallet(ctx, toOwner);
    const stakeW = await getWallet(ctx, ctx.staking.address);
    const treasW = await getWallet(ctx, ctx.treasury.address);

    const recipientBefore = await tryWalletBalance(recipientW);
    const stakeBefore = (await stakeW.getGetWalletData()).balance;
    const treasBefore = (await treasW.getGetWalletData()).balance;

    await walletFrom.sendTransfer(from.getSender(), {
        jettonAmount,
        destinationOwner: toOwner,
        responseDestination: from.address,
        value: TRANSFER_TON,
    });

    expect((await recipientW.getGetWalletData()).balance).toBe(recipientBefore + net);
    expect((await stakeW.getGetWalletData()).balance).toBe(stakeBefore + expectedStaking);
    expect((await treasW.getGetWalletData()).balance).toBe(treasBefore + expectedTreasury);
    expect((await ctx.master.getGetJettonData()).totalSupply).toBe(supplyBefore - expectedBurn);
}
