/**
 * IMP-MNAUD-F16 — regression for measured gas floors (isolated chain samples).
 * Documents that native DEX default attach (0.05–0.3 TON) remains out of reach.
 * IMP-MNAUD-F22: the floors below are now the DEFAULTS of the governance-tunable
 * gas params (SetGasParams) — this suite pins the no-governance-intervention
 * behavior identity (same numbers as the pre-F22 constants).
 */
import { describe, expect, it } from '@jest/globals';
import { toNano } from '@ton/core';
import '@ton/test-utils';
import { deployJetton, getWallet, MINT_TON, NANO_PER_BURN, type JettonDeployedContext } from './helpers';

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

describe('IMP-MNAUD-F16/F17 gas floors', () => {
    // IMP-MNAUD-F17 (W1): warm message() sink legs lowered the fanout requirement;
    // sandbox first-credit is 0.91–0.93 TON, uniform gate is 1.0 (strict >).
    it('fee-path: DEX-default attach fails; 1.01 TON credits (gate 1.0 + fwd)', async () => {
        const ctxLo = await prepareFeeCtx();
        const destLo = await ctxLo.blockchain.treasury('f16-fee-lo');
        expect(await credited(ctxLo, ctxLo.userX.address, destLo.address, toNano('0.3'), ctxLo.userX.getSender())).toBe(
            false,
        );

        const ctxHi = await prepareFeeCtx();
        const destHi = await ctxHi.blockchain.treasury('f16-fee-hi');
        expect(
            await credited(ctxHi, ctxHi.userX.address, destHi.address, toNano('1.01'), ctxHi.userX.getSender()),
        ).toBe(true);
    }, 180_000);

    // IMP-MNAUD-F11: a locally-excluded sender no longer takes the cheap 0.58 gate —
    // the wallet entry gate is always minTonFeePath (1.0 after F17) and the transfer
    // resolves via master (surplus refunded once master confirms exclusion).
    it('excluded-path: legacy 0.60 fails after F11; 1.01 credits (gate 1.0 + fwd)', async () => {
        const ctxLo = await prepareExcludedCtx();
        const destLo = await ctxLo.blockchain.treasury('f16-ex-lo');
        expect(
            await credited(ctxLo, ctxLo.staking.address, destLo.address, toNano('0.60'), ctxLo.staking.getSender()),
        ).toBe(false);

        const ctxHi = await prepareExcludedCtx();
        const destHi = await ctxHi.blockchain.treasury('f16-ex-hi');
        expect(
            await credited(ctxHi, ctxHi.staking.address, destHi.address, toNano('1.01'), ctxHi.staking.getSender()),
        ).toBe(true);
    }, 180_000);
});
