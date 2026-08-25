import { Address, toNano } from '@ton/core';
import { filterTransactions } from '@ton/test-utils';
import { expect } from '@jest/globals';
import { deployJetton, getWallet, MINT_TON, NANO_PER_BURN, TRANSFER_TON, type JettonDeployedContext } from './helpers';
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

    const totalOutNano = recipientLegNano + poolLegNano + treasuryLegNano + burnNotifyNano + propagateNano;
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

    // IMP-MNAUD-F17 (W1): pool/treasury legs are warm message() sends (~0.106 /
    // ~0.041 TON sandbox); only the recipient leg keeps deploy(perInternalDeployTon).
    it('fee split: recipient leg keeps 0.55 deploy; pool/treasury warm legs are < 0.55', async () => {
        const amount = 100n * NANO_PER_BURN;
        const { profile } = await runFeeSplitTransfer(ctx, ctx.userX, ctx.userY.address, amount);

        expect(profile.recipientLegNano).toBe(toNano('0.55'));
        expect(profile.poolLegNano).toBeGreaterThanOrEqual(toNano('0.07'));
        expect(profile.poolLegNano).toBeLessThan(toNano('0.15'));
        expect(profile.treasuryLegNano).toBeGreaterThan(0n);
        expect(profile.treasuryLegNano).toBeLessThan(toNano('0.06'));
        expect(profile.burnNotifyNano).toBe(toNano('0.06'));
        // recipient 0.55 + pool ~0.106 + treasury ~0.041 + burn 0.06 + propagate 0.05
        expect(profile.totalOutNano).toBeLessThan(toNano('0.95'));
        expect(profile.senderSurplusNano).toBeLessThan(TRANSFER_TON);
    });

    it('warm repeat: out_msg attach per leg identical to first transfer (value is state-independent)', async () => {
        const amount = 10n * NANO_PER_BURN;
        const cold = await runFeeSplitTransfer(ctx, ctx.userX, ctx.userY.address, amount);
        const warm = await runFeeSplitTransfer(ctx, ctx.userX, ctx.userY.address, amount);

        expect(warm.profile.recipientLegNano).toBe(cold.profile.recipientLegNano);
        expect(warm.profile.poolLegNano).toBe(cold.profile.poolLegNano);
        expect(warm.profile.treasuryLegNano).toBe(cold.profile.treasuryLegNano);
        const legTotalDelta =
            warm.profile.totalOutNano > cold.profile.totalOutNano
                ? warm.profile.totalOutNano - cold.profile.totalOutNano
                : cold.profile.totalOutNano - warm.profile.totalOutNano;
        expect(legTotalDelta).toBeLessThanOrEqual(toNano('0.0001'));
        const surplusDelta =
            warm.profile.senderSurplusNano > cold.profile.senderSurplusNano
                ? warm.profile.senderSurplusNano - cold.profile.senderSurplusNano
                : cold.profile.senderSurplusNano - warm.profile.senderSurplusNano;
        expect(surplusDelta).toBeLessThanOrEqual(toNano('0.0001'));
    });

    it('minimum attach: cold recipient succeeds at F17 floor; warm repeat succeeds with same floor', async () => {
        const amount = 10n * NANO_PER_BURN;
        const walletFrom = await getWallet(ctx, ctx.userX.address);
        // IMP-MNAUD-F17 sandbox first-credit 0.91–0.93; gate 1.0 (strict >) → 1.01 credits.
        const minAttach = toNano('1.01');

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

        // Stable anchors for IMP-JETTON-GAS-06 / IMP-MNAUD-F17 decision logs.
        expect(table.cold.recipientLegNano).toBe(toNano('0.55'));
        expect(table.warm.recipientLegNano).toBe(toNano('0.55'));
        expect(table.cold.poolLegNano).toBeLessThan(toNano('0.55'));
        expect(table.cold.treasuryLegNano).toBeLessThan(toNano('0.55'));
        const totalDelta =
            table.cold.totalOutNano > table.warm.totalOutNano
                ? table.cold.totalOutNano - table.warm.totalOutNano
                : table.warm.totalOutNano - table.cold.totalOutNano;
        expect(totalDelta).toBeLessThanOrEqual(toNano('0.0001'));

        if (process.env.LOG_GAS_PROFILE === '1') {
            console.log(JSON.stringify(table, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
        }
    });
});
