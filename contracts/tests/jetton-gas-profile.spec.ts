import { Address, toNano } from '@ton/core';
import { filterTransactions } from '@ton/test-utils';
import { expect } from '@jest/globals';
import {
    deployJetton,
    getWallet,
    MINT_TON,
    NANO_PER_BURN,
    TRANSFER_TON,
    type JettonDeployedContext,
} from './helpers';
import '@ton/test-utils';

export type FeeSplitOutMsgProfile = {
    recipientLegNano: bigint;
    poolLegNano: bigint;
    treasuryLegNano: bigint;
    burnNotifyNano: bigint;
    propagateNano: bigint;
    totalOutNano: bigint;
    senderSurplusNano: bigint;
};

function sumInternalOutValues(from: Address, transactions: Parameters<typeof filterTransactions>[0]): bigint {
    let total = 0n;
    for (const t of transactions) {
        for (const out of t.outMessages.values()) {
            if (out.info.type !== 'internal') {
                continue;
            }
            if (!out.info.src?.equals(from)) {
                continue;
            }
            total += out.info.value.coins;
        }
    }
    return total;
}

function feeSplitOutProfile(
    senderJw: Address,
    master: Address,
    recipientJw: Address,
    poolJw: Address,
    treasuryJw: Address,
    transactions: Parameters<typeof filterTransactions>[0],
    attachNano: bigint,
): FeeSplitOutMsgProfile {
    const leg = (dest: Address): bigint => {
        for (const t of transactions) {
            const im = t.inMessage;
            if (!im || im.info.type !== 'internal') {
                continue;
            }
            const { src, dest: to } = im.info;
            if (!src?.equals(senderJw) || !to?.equals(dest)) {
                continue;
            }
            return im.info.value.coins;
        }
        return 0n;
    };

    const recipientLegNano = leg(recipientJw);
    const poolLegNano = leg(poolJw);
    const treasuryLegNano = leg(treasuryJw);
    const burnNotifyNano = leg(master);
    const propagateNano = sumInternalOutValues(
        master,
        filterTransactions(transactions, { from: senderJw, to: master }),
    );

    const totalOutNano = sumInternalOutValues(senderJw, transactions);
    const senderSurplusNano = attachNano - totalOutNano;

    return {
        recipientLegNano,
        poolLegNano,
        treasuryLegNano,
        burnNotifyNano,
        propagateNano,
        totalOutNano,
        senderSurplusNano,
    };
}

async function runFeeSplitTransfer(
    ctx: JettonDeployedContext,
    from: typeof ctx.userX,
    toOwner: Address,
    amount: bigint,
): Promise<{ profile: FeeSplitOutMsgProfile; transactions: Parameters<typeof filterTransactions>[0] }> {
    const walletFrom = await getWallet(ctx, from.address);
    const recipientJw = await ctx.master.getGetWalletAddress(toOwner);
    const poolJw = await ctx.master.getGetWalletAddress(ctx.staking.address);
    const treasuryJw = await ctx.master.getGetWalletAddress(ctx.treasury.address);

    const tx = await walletFrom.sendTransfer(from.getSender(), {
        jettonAmount: amount,
        destinationOwner: toOwner,
        responseDestination: from.address,
        value: TRANSFER_TON,
    });

    expect(tx.transactions).toHaveTransaction({ from: walletFrom.address, success: true });

    const profile = feeSplitOutProfile(
        walletFrom.address,
        ctx.master.address,
        recipientJw,
        poolJw,
        treasuryJw,
        tx.transactions,
        TRANSFER_TON,
    );

    return { profile, transactions: tx.transactions };
}

describe('IMP-JETTON-GAS-06 — fee-split gas profile (cold vs warm wallets)', () => {
    let ctx: JettonDeployedContext;

    beforeEach(async () => {
        ctx = await deployJetton();
        await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 200n * NANO_PER_BURN, 1n, MINT_TON);
        await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, 1n, 1n, MINT_TON);
        await ctx.master.sendMint(ctx.deployer.getSender(), ctx.treasury.address, 1n, 1n, MINT_TON);
        await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
    });

    it('cold deploy: all three sink wallets receive perInternalDeployTon attach', async () => {
        const amount = 100n * NANO_PER_BURN;
        const { profile } = await runFeeSplitTransfer(ctx, ctx.userX, ctx.userY.address, amount);

        expect(profile.recipientLegNano).toBe(toNano('0.55'));
        expect(profile.poolLegNano).toBeGreaterThanOrEqual(toNano('0.07'));
        expect(profile.treasuryLegNano).toBe(toNano('0.55'));
        expect(profile.burnNotifyNano).toBe(toNano('0.06'));
        expect(profile.totalOutNano).toBeGreaterThanOrEqual(toNano('1.76'));
        expect(profile.senderSurplusNano).toBeLessThan(TRANSFER_TON);
    });

    it('warm wallets: repeat transfer uses identical out_msg attach (deploy path unchanged)', async () => {
        const amount = 10n * NANO_PER_BURN;
        const cold = await runFeeSplitTransfer(ctx, ctx.userX, ctx.userY.address, amount);
        const warm = await runFeeSplitTransfer(ctx, ctx.userX, ctx.userY.address, amount);

        // On-chain attach per leg unchanged (deploy() even when wallet exists).
        expect(warm.profile.recipientLegNano).toBe(cold.profile.recipientLegNano);
        expect(warm.profile.poolLegNano).toBe(cold.profile.poolLegNano);
        expect(warm.profile.treasuryLegNano).toBe(cold.profile.treasuryLegNano);
        expect(warm.profile.totalOutNano).toBe(cold.profile.totalOutNano);
        expect(warm.profile.senderSurplusNano).toBe(cold.profile.senderSurplusNano);
    });

    it('minimum attach: cold deploy succeeds above gate; warm repeat succeeds with same floor', async () => {
        const amount = 10n * NANO_PER_BURN;
        const walletFrom = await getWallet(ctx, ctx.userX.address);
        const minAttach = toNano('2.15');

        const coldTx = await walletFrom.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: minAttach,
        });
        expect(coldTx.transactions).toHaveTransaction({ from: walletFrom.address, success: true });

        const warmTx = await walletFrom.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: minAttach,
        });
        expect(warmTx.transactions).toHaveTransaction({ from: walletFrom.address, success: true });

        const wy = await getWallet(ctx, ctx.userY.address);
        expect(await wy.getGetFeeConfigActive()).toBe(true);
    });

    it('exports profiling table for decision log (cold vs warm nano per leg)', async () => {
        const amount = 10n * NANO_PER_BURN;
        const cold = await runFeeSplitTransfer(ctx, ctx.userX, ctx.userY.address, amount);
        const warm = await runFeeSplitTransfer(ctx, ctx.userX, ctx.userY.address, amount);

        const table = {
            cold: cold.profile,
            warm: warm.profile,
        };

        // Stable anchors for IMP-JETTON-GAS-06 decision log.
        expect(table.cold.recipientLegNano).toBe(toNano('0.55'));
        expect(table.warm.recipientLegNano).toBe(toNano('0.55'));
        expect(table.cold.totalOutNano).toBe(table.warm.totalOutNano);

        if (process.env.LOG_GAS_PROFILE === '1') {
            console.log(JSON.stringify(table, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
        }
    });
});
