/**
 * IMP-MNAUD-F16 — regression for measured gas floors (isolated chain samples).
 * Documents that native DEX default attach (0.05–0.3 TON) remains out of reach.
 */
import { describe, expect, it } from '@jest/globals';
import { toNano } from '@ton/core';
import '@ton/test-utils';
import {
    deployJetton,
    getWallet,
    MINT_TON,
    NANO_PER_BURN,
    type JettonDeployedContext,
} from './helpers';

async function prepareFeeCtx(): Promise<JettonDeployedContext> {
    const ctx = await deployJetton();
    await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
    await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
    await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, 1n, 1n, MINT_TON);
    await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.staking.address);
    await ctx.master.sendMint(ctx.deployer.getSender(), ctx.treasury.address, 1n, 1n, MINT_TON);
    await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.treasury.address);
    return ctx;
}

async function prepareExcludedCtx(): Promise<JettonDeployedContext> {
    const ctx = await deployJetton();
    await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, 50n * NANO_PER_BURN, 1n, MINT_TON);
    await ctx.master.sendAddExcluded(ctx.deployer.getSender(), ctx.staking.address);
    await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.staking.address);
    return ctx;
}

async function credited(
    ctx: JettonDeployedContext,
    fromOwner: import('@ton/core').Address,
    destOwner: import('@ton/core').Address,
    attach: bigint,
    sender: ReturnType<JettonDeployedContext['userX']['getSender']>,
): Promise<boolean> {
    const from = await getWallet(ctx, fromOwner);
    let before = 0n;
    try {
        before = (await (await getWallet(ctx, destOwner)).getGetWalletData()).balance;
    } catch {
        before = 0n;
    }
    const r = await from.sendTransfer(sender, {
        jettonAmount: 1n * NANO_PER_BURN,
        destinationOwner: destOwner,
        responseDestination: fromOwner,
        value: attach,
    });
    const walletOk = r.transactions.some(
        (t) =>
            t.inMessage?.info.type === 'internal' &&
            t.inMessage.info.dest?.equals(from.address) &&
            t.description.type === 'generic' &&
            t.description.computePhase.type === 'vm' &&
            t.description.computePhase.success,
    );
    if (!walletOk) return false;
    try {
        const after = (await (await getWallet(ctx, destOwner)).getGetWalletData()).balance;
        return after > before;
    } catch {
        return false;
    }
}

describe('IMP-MNAUD-F16 gas floors', () => {
    it('fee-path: DEX-default attach fails; 2.06 TON credits (gate 2.05 + fwd)', async () => {
        const ctxLo = await prepareFeeCtx();
        const destLo = await ctxLo.blockchain.treasury('f16-fee-lo');
        expect(
            await credited(ctxLo, ctxLo.userX.address, destLo.address, toNano('0.3'), ctxLo.userX.getSender()),
        ).toBe(false);

        const ctxHi = await prepareFeeCtx();
        const destHi = await ctxHi.blockchain.treasury('f16-fee-hi');
        expect(
            await credited(ctxHi, ctxHi.userX.address, destHi.address, toNano('2.06'), ctxHi.userX.getSender()),
        ).toBe(true);
    }, 180_000);

    it('excluded-path: 0.50 fails gate; 0.60 credits (gate 0.58 + fwd)', async () => {
        const ctxLo = await prepareExcludedCtx();
        const destLo = await ctxLo.blockchain.treasury('f16-ex-lo');
        expect(
            await credited(
                ctxLo,
                ctxLo.staking.address,
                destLo.address,
                toNano('0.50'),
                ctxLo.staking.getSender(),
            ),
        ).toBe(false);

        const ctxHi = await prepareExcludedCtx();
        const destHi = await ctxHi.blockchain.treasury('f16-ex-hi');
        expect(
            await credited(
                ctxHi,
                ctxHi.staking.address,
                destHi.address,
                toNano('0.60'),
                ctxHi.staking.getSender(),
            ),
        ).toBe(true);
    }, 180_000);
});
