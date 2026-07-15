import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Slice, toNano } from '@ton/core';
import { storeStakeForward, type StakeForward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { expect } from '@jest/globals';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';

/** 9 decimals */
export const NANO_PER_BURN = 10n ** 9n;

/** Hardcoded burn fee (basis points) in burn-jetton-wallet.tact — 1% on every transfer. */
export const BURN_BPS = 100n;

export const DEPLOY_TON = toNano('0.15');
export const MINT_TON = toNano('0.25');
/** Burn-only JettonTransfer attach: recipient deploy leg 0.55 + burn notify 0.06 + headroom. */
export const TRANSFER_TON = toNano('0.8');

/** Burn taken from a transfer of `amount` (integer truncation: < 100 nano burns 0). */
export function burnOf(amount: bigint): bigint {
    return (amount * BURN_BPS) / 10000n;
}

/** Net amount the recipient receives after the hardcoded 1% burn. */
export function netOf(amount: bigint): bigint {
    return amount - burnOf(amount);
}

/** Jetton forward_payload for staking master (`StakeForward` in ref, either-bit = 1). */
export function stakeForwardPayload(tier: number): Slice {
    const sf: StakeForward = { $$type: 'StakeForward', tier: BigInt(tier) };
    return beginCell()
        .storeUint(1, 1)
        .storeRef(beginCell().store(storeStakeForward(sf)).endCell())
        .endCell()
        .asSlice();
}

/** Fixed sandbox clock for reproducible time-dependent tests. */
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
 * Deploy BURN master. The wallet works immediately after deploy — there is no
 * fee config to push (hardcoded 1% burn on every transfer).
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
 * Executes a transfer from `from` to `toOwner` and asserts the hardcoded 1% burn:
 * totalSupply decreases by `burnOf(amount)`, the recipient receives `netOf(amount)`.
 */
export async function transferAndAssertBurn(
    ctx: JettonDeployedContext,
    from: SandboxContract<TreasuryContract>,
    toOwner: Address,
    jettonAmount: bigint,
): Promise<void> {
    const expectedBurn = burnOf(jettonAmount);
    const net = netOf(jettonAmount);
    expect(expectedBurn + net).toBe(jettonAmount);

    const supplyBefore = (await ctx.master.getGetJettonData()).totalSupply;
    const walletFrom = await getWallet(ctx, from.address);
    const recipientW = await getWallet(ctx, toOwner);
    const recipientBefore = await tryWalletBalance(recipientW);

    const r = await walletFrom.sendTransfer(from.getSender(), {
        jettonAmount,
        destinationOwner: toOwner,
        responseDestination: from.address,
        value: TRANSFER_TON,
    });
    expect(r.transactions).toHaveTransaction({ from: walletFrom.address, success: true });

    expect((await recipientW.getGetWalletData()).balance).toBe(recipientBefore + net);
    expect((await ctx.master.getGetJettonData()).totalSupply).toBe(supplyBefore - expectedBurn);
}
