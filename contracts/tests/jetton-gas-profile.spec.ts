import { Address, toNano } from '@ton/core';
import { filterTransactions } from '@ton/test-utils';
import { expect } from '@jest/globals';
import { BurnJettonWallet_errors_backward } from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';
import {
    deployJetton,
    getWallet,
    MINT_TON,
    NANO_PER_BURN,
    TRANSFER_TON,
    type JettonDeployedContext,
} from './helpers';
import '@ton/test-utils';

/**
 * Minimum TON attach for the burn-only `JettonTransfer` path (IMP-TOKSIM-02).
 *
 * Mirrors the gate in `contracts/jetton/burn-jetton-wallet.tact`:
 *
 *   ctx.value > deliverTon + burnNotifyTon + gasTransferHeadroom
 *
 * where with the default (dust) forwardTonAmount:
 *   deliverTon          = perInternalDeployTon   = 0.55 TON  (recipient leg, cold wallet deploy)
 *   burnNotifyTon       = gasBurnNotifyTon       = 0.06 TON  (JettonBurnNotification to master; 0 when burn == 0)
 *   gasTransferHeadroom                          = 0.05 TON  (sender JW compute + fwd fees)
 *
 * The gate is strict (`>`), so exactly 0.66 TON reverts and 0.66 TON + 1 nano
 * passes. Off-chain estimator: `scripts/lib/estimateJettonTransferTon.ts`;
 * recommended attach is `TRANSFER_TON` (0.8 TON) from `tests/helpers.ts`.
 */
export const MIN_TRANSFER_ATTACH_NANO = toNano('0.66');

/** Gate when burn truncates to 0 (amount < 100 nano): no burn-notify leg. */
export const MIN_DUST_TRANSFER_ATTACH_NANO = toNano('0.6');

/** Nano-anchors for the two burn-only out-msg legs (contract constants). */
export const RECIPIENT_LEG_NANO = toNano('0.55');
export const BURN_NOTIFY_LEG_NANO = toNano('0.06');

type Transactions = Parameters<typeof filterTransactions>[0];

export type BurnOnlyOutMsgProfile = {
    /** JettonTransferInternal to the recipient jetton wallet (deploy included). */
    recipientLegNano: bigint;
    /** JettonBurnNotification to the master (absent when burn == 0). */
    burnNotifyNano: bigint;
    /** JettonExcesses surplus returned to the owner / responseDestination. */
    excessesNano: bigint;
    /** Internal out-msgs from the sender JW to anything else — must stay 0. */
    unexpectedLegCount: number;
    outMsgCount: number;
    totalOutNano: bigint;
    senderSurplusNano: bigint;
};

const OP_JETTON_TRANSFER = 0xf8a7ea5;

function findSenderJwTransferTx(senderJw: Address, transactions: Transactions) {
    for (const t of transactions) {
        const im = t.inMessage;
        if (!im || im.info.type !== 'internal') {
            continue;
        }
        if (!im.info.dest.equals(senderJw)) {
            continue;
        }
        const body = im.body.beginParse();
        if (body.remainingBits >= 32 && body.loadUint(32) === OP_JETTON_TRANSFER) {
            return t;
        }
    }
    return undefined;
}

function burnOnlyOutProfile(
    senderJw: Address,
    master: Address,
    recipientJw: Address,
    owner: Address,
    transactions: Transactions,
    attachNano: bigint,
): BurnOnlyOutMsgProfile {
    const tx = findSenderJwTransferTx(senderJw, transactions);
    expect(tx).toBeDefined();

    let recipientLegNano = 0n;
    let burnNotifyNano = 0n;
    let excessesNano = 0n;
    let unexpectedLegCount = 0;
    let outMsgCount = 0;

    for (const out of tx!.outMessages.values()) {
        if (out.info.type !== 'internal') {
            continue;
        }
        outMsgCount += 1;
        const coins = out.info.value.coins;
        if (out.info.dest.equals(recipientJw)) {
            recipientLegNano += coins;
        } else if (out.info.dest.equals(master)) {
            burnNotifyNano += coins;
        } else if (out.info.dest.equals(owner)) {
            excessesNano += coins;
        } else {
            unexpectedLegCount += 1;
        }
    }

    const totalOutNano = recipientLegNano + burnNotifyNano + excessesNano;
    return {
        recipientLegNano,
        burnNotifyNano,
        excessesNano,
        unexpectedLegCount,
        outMsgCount,
        totalOutNano,
        senderSurplusNano: attachNano - totalOutNano,
    };
}

async function runBurnTransfer(
    ctx: JettonDeployedContext,
    from: typeof ctx.userX,
    toOwner: Address,
    amount: bigint,
    attachNano: bigint = TRANSFER_TON,
): Promise<BurnOnlyOutMsgProfile> {
    const walletFrom = await getWallet(ctx, from.address);
    const recipientJw = await ctx.master.getGetWalletAddress(toOwner);

    const tx = await walletFrom.sendTransfer(from.getSender(), {
        jettonAmount: amount,
        destinationOwner: toOwner,
        responseDestination: from.address,
        value: attachNano,
    });
    expect(tx.transactions).toHaveTransaction({ from: walletFrom.address, success: true });

    return burnOnlyOutProfile(
        walletFrom.address,
        ctx.master.address,
        recipientJw,
        from.address,
        tx.transactions,
        attachNano,
    );
}

describe('IMP-TOKSIM-02 — burn-only transfer gas profile', () => {
    let ctx: JettonDeployedContext;

    beforeEach(async () => {
        ctx = await deployJetton();
        await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 200n * NANO_PER_BURN, 1n, MINT_TON);
    });

    it('cold transfer: exactly two value legs — recipient deploy 0.55 + burn notify 0.06', async () => {
        const profile = await runBurnTransfer(ctx, ctx.userX, ctx.userY.address, 100n * NANO_PER_BURN);

        expect(profile.recipientLegNano).toBe(RECIPIENT_LEG_NANO);
        expect(profile.burnNotifyNano).toBe(BURN_NOTIFY_LEG_NANO);
        expect(profile.unexpectedLegCount).toBe(0);
        // recipient leg + burn notify + surplus return — nothing else.
        expect(profile.outMsgCount).toBe(3);
        expect(profile.excessesNano).toBeGreaterThan(0n);
        expect(profile.totalOutNano).toBeLessThanOrEqual(TRANSFER_TON);
    });

    it('warm repeat: per-leg attach identical to cold (deploy() even when wallet exists)', async () => {
        const cold = await runBurnTransfer(ctx, ctx.userX, ctx.userY.address, 10n * NANO_PER_BURN);
        const warm = await runBurnTransfer(ctx, ctx.userX, ctx.userY.address, 10n * NANO_PER_BURN);

        expect(warm.recipientLegNano).toBe(cold.recipientLegNano);
        expect(warm.burnNotifyNano).toBe(cold.burnNotifyNano);
        expect(warm.outMsgCount).toBe(cold.outMsgCount);
        const surplusDelta =
            warm.senderSurplusNano > cold.senderSurplusNano
                ? warm.senderSurplusNano - cold.senderSurplusNano
                : cold.senderSurplusNano - warm.senderSurplusNano;
        expect(surplusDelta).toBeLessThanOrEqual(toNano('0.0001'));
    });

    it('minimum attach: exactly 0.66 TON reverts (strict gate), 0.66 + 1 nano succeeds', async () => {
        const wx = await getWallet(ctx, ctx.userX.address);
        const amount = 10n * NANO_PER_BURN;

        const atGate = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: MIN_TRANSFER_ATTACH_NANO,
        });
        expect(atGate.transactions).toHaveTransaction({
            success: false,
            exitCode: BurnJettonWallet_errors_backward['Insufficient amount of TON attached'],
        });

        const aboveGate = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: MIN_TRANSFER_ATTACH_NANO + 1n,
        });
        expect(aboveGate.transactions).toHaveTransaction({ from: wx.address, success: true });
    });

    it('dust transfer (burn == 0): burn-notify leg absent, lower 0.6 TON gate applies', async () => {
        const wx = await getWallet(ctx, ctx.userX.address);
        const dust = 99n; // < 100 nano → 1% truncates to 0

        const atGate = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: dust,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: MIN_DUST_TRANSFER_ATTACH_NANO,
        });
        expect(atGate.transactions).toHaveTransaction({
            success: false,
            exitCode: BurnJettonWallet_errors_backward['Insufficient amount of TON attached'],
        });

        const profile = await runBurnTransfer(
            ctx,
            ctx.userX,
            ctx.userY.address,
            dust,
            MIN_DUST_TRANSFER_ATTACH_NANO + 1n,
        );
        expect(profile.recipientLegNano).toBe(RECIPIENT_LEG_NANO);
        expect(profile.burnNotifyNano).toBe(0n);
        // recipient leg + surplus return only.
        expect(profile.outMsgCount).toBe(2);
    });

    it('exports profiling table for decision log (cold vs warm nano per leg)', async () => {
        const amount = 10n * NANO_PER_BURN;
        const cold = await runBurnTransfer(ctx, ctx.userX, ctx.userY.address, amount);
        const warm = await runBurnTransfer(ctx, ctx.userX, ctx.userY.address, amount);

        const table = { cold, warm };

        // Stable anchors for the IMP-TOKSIM-02 decision log.
        expect(table.cold.recipientLegNano).toBe(RECIPIENT_LEG_NANO);
        expect(table.warm.recipientLegNano).toBe(RECIPIENT_LEG_NANO);
        expect(table.cold.burnNotifyNano).toBe(BURN_NOTIFY_LEG_NANO);
        expect(table.warm.burnNotifyNano).toBe(BURN_NOTIFY_LEG_NANO);

        if (process.env.LOG_GAS_PROFILE === '1') {
            console.log(JSON.stringify(table, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
        }
    });
});
