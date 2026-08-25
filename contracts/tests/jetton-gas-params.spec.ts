/**
 * IMP-MNAUD-F22 — governance-tunable TON gas gates (`SetGasParams`).
 *
 * Covers: timelock-gated happy path with wallet propagation, non-timelock and
 * cap-violation rejections (master AND wallet side), the fanout coherence
 * invariant (trap-down / cap-up), default identity, wallet address stability,
 * feeConfig bit budget at worst-case values with a full excluded list,
 * stale-snapshot self-consistency, and the transition-window commit guard
 * (no governance-openable F10 strand band).
 */
import { describe, expect, it } from '@jest/globals';
import { Address, beginCell, toNano } from '@ton/core';
import '@ton/test-utils';
import type { BlockchainTransaction } from '@ton/sandbox';
import { deployJetton, getWallet, MINT_TON, NANO_PER_BURN, TRANSFER_TON, type JettonDeployedContext } from './helpers';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import {
    BurnJettonWallet as BurnJettonWalletBase,
    type JettonUpdateFeeConfig,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';

const JETTON_TRANSFER_COMMIT_FAILED_OP = 0x6a3b2c22;

type GasParams = {
    minTonFeePath: bigint;
    perInternalDeployTon: bigint;
    poolForwardMin: bigint;
    treasuryForwardMin: bigint;
    burnNotifyTon: bigint;
    propagateTon: bigint;
};

/** Post-F17 W1 constants — the F22 defaults (behavior identity contract). */
const DEFAULTS: GasParams = {
    minTonFeePath: toNano('1.0'),
    perInternalDeployTon: toNano('0.55'),
    poolForwardMin: toNano('0.07'),
    treasuryForwardMin: toNano('0.01'),
    burnNotifyTon: toNano('0.06'),
    propagateTon: toNano('0.05'),
};

/** Coherent raised config (invariant worst-case ≈ 1.47 ≤ gate 2.0). */
const RAISED: GasParams = {
    minTonFeePath: toNano('2.0'),
    perInternalDeployTon: toNano('0.8'),
    poolForwardMin: toNano('0.2'),
    treasuryForwardMin: toNano('0.05'),
    burnNotifyTon: toNano('0.1'),
    propagateTon: toNano('0.08'),
};

/** Aggressive but coherent raise (worst-case ≈ 3.98 ≤ gate 4.0) — used to open
 *  a transition band between the old gate (1.0) and the new fanout requirement. */
const RAISED_HARD: GasParams = {
    minTonFeePath: toNano('4.0'),
    perInternalDeployTon: toNano('1.0'),
    poolForwardMin: toNano('1.0'),
    treasuryForwardMin: toNano('0.5'),
    burnNotifyTon: toNano('0.5'),
    propagateTon: toNano('0.3'),
};

/** Max-feasible values under caps + invariant (worst-case ≈ 4.98 ≤ gate 5.0). */
const MAX_FEASIBLE: GasParams = {
    minTonFeePath: toNano('5'),
    perInternalDeployTon: toNano('1'),
    poolForwardMin: toNano('1'),
    treasuryForwardMin: toNano('1'),
    burnNotifyTon: toNano('1'),
    propagateTon: toNano('0.3'),
};

function expectGasView(actual: GasParams, expected: GasParams): void {
    expect(actual.minTonFeePath).toBe(expected.minTonFeePath);
    expect(actual.perInternalDeployTon).toBe(expected.perInternalDeployTon);
    expect(actual.poolForwardMin).toBe(expected.poolForwardMin);
    expect(actual.treasuryForwardMin).toBe(expected.treasuryForwardMin);
    expect(actual.burnNotifyTon).toBe(expected.burnNotifyTon);
    expect(actual.propagateTon).toBe(expected.propagateTon);
}

/** Fee ctx with warm sinks (bootstrap invariant, IMP-MNAUD-F14). */
async function prepareFeeCtx(): Promise<JettonDeployedContext> {
    const ctx = await deployJetton();
    await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 200n * NANO_PER_BURN, 1n, MINT_TON);
    await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
    await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, 1n, 1n, MINT_TON);
    await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.staking.address);
    await ctx.master.sendMint(ctx.deployer.getSender(), ctx.treasury.address, 1n, 1n, MINT_TON);
    await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.treasury.address);
    return ctx;
}

/** Value of the internal message from `from` to `to` inside a tx batch (0n if absent). */
function legValue(transactions: BlockchainTransaction[], from: Address, to: Address): bigint {
    for (const t of transactions) {
        const im = t.inMessage;
        if (!im || im.info.type !== 'internal') {
            continue;
        }
        if (im.info.src?.equals(from) && im.info.dest?.equals(to)) {
            return im.info.value.coins;
        }
    }
    return 0n;
}

async function walletBalance(ctx: JettonDeployedContext, owner: Address): Promise<bigint> {
    try {
        return (await (await getWallet(ctx, owner)).getGetWalletData()).balance;
    } catch {
        return 0n;
    }
}

describe('IMP-MNAUD-F22 — SetGasParams governance surface', () => {
    it('defaults equal the post-F17 W1 constants on master and on a synced wallet', async () => {
        const ctx = await prepareFeeCtx();
        expectGasView(await ctx.master.getGetGasParams(), DEFAULTS);

        const wx = await getWallet(ctx, ctx.userX.address);
        expectGasView(await wx.getGetGasConfig(), DEFAULTS);

        // Wallet with an empty (pre-sync) snapshot falls back to the same defaults.
        await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userY.address, 1n * NANO_PER_BURN, 1n, MINT_TON);
        const wy = await getWallet(ctx, ctx.userY.address);
        expectGasView(await wy.getGetGasConfig(), DEFAULTS);
    });

    it('idempotent push of the defaults is accepted (floors and invariant are inclusive)', async () => {
        const ctx = await prepareFeeCtx();
        const r = await ctx.master.sendSetGasParams(ctx.deployer.getSender(), DEFAULTS);
        expect(r.transactions).toHaveTransaction({ to: ctx.master.address, success: true });
        expectGasView(await ctx.master.getGetGasParams(), DEFAULTS);
    });

    it('happy path: timelock raises params, wallets pick them up via sync, gate and legs change', async () => {
        const ctx = await prepareFeeCtx();
        const r = await ctx.master.sendSetGasParams(ctx.deployer.getSender(), RAISED);
        expect(r.transactions).toHaveTransaction({ to: ctx.master.address, success: true });
        expectGasView(await ctx.master.getGetGasParams(), RAISED);

        await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        const wx = await getWallet(ctx, ctx.userX.address);
        expectGasView(await wx.getGetGasConfig(), RAISED);

        // Attach above the old gate (1.0) but below the new one (2.0) → entry reject.
        const balBefore = await walletBalance(ctx, ctx.userX.address);
        const low = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: 10n * NANO_PER_BURN,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: toNano('1.5'),
        });
        expect(low.transactions).toHaveTransaction({ to: wx.address, success: false });
        expect(await walletBalance(ctx, ctx.userX.address)).toBe(balBefore);

        // High attach passes and the out-legs reflect the raised values.
        const recipientJw = await ctx.master.getGetWalletAddress(ctx.userY.address);
        const poolJw = await ctx.master.getGetWalletAddress(ctx.staking.address);
        const ok = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: 10n * NANO_PER_BURN,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: TRANSFER_TON,
        });
        expect(ok.transactions).toHaveTransaction({ from: wx.address, to: recipientJw, success: true });
        expect(legValue(ok.transactions, wx.address, recipientJw)).toBe(RAISED.perInternalDeployTon);
        expect(legValue(ok.transactions, wx.address, poolJw)).toBeGreaterThanOrEqual(RAISED.poolForwardMin);
        expect(legValue(ok.transactions, wx.address, ctx.master.address)).toBe(RAISED.burnNotifyTon);
    }, 180_000);

    it('non-timelock sender is rejected and params stay unchanged', async () => {
        const ctx = await prepareFeeCtx();
        const r = await ctx.master.sendSetGasParams(ctx.userX.getSender(), RAISED);
        expect(r.transactions).toHaveTransaction({ to: ctx.master.address, success: false });
        expectGasView(await ctx.master.getGetGasParams(), DEFAULTS);
    });

    it('cap violations are rejected on master (floors and ceilings per param)', async () => {
        const ctx = await prepareFeeCtx();
        const badConfigs: Partial<GasParams>[] = [
            { minTonFeePath: toNano('0.94') }, // below 0.95 floor (would re-open F10 band)
            { minTonFeePath: toNano('5') + 1n }, // above 5 TON ceiling
            { perInternalDeployTon: toNano('0.55') - 1n }, // below cold-safe W1 floor
            { perInternalDeployTon: toNano('1') + 1n }, // above deliver ceiling
            { poolForwardMin: toNano('0.07') - 1n },
            { treasuryForwardMin: toNano('0.01') - 1n },
            { burnNotifyTon: toNano('0.06') - 1n },
            { propagateTon: toNano('0.05') - 1n },
            { propagateTon: toNano('1') + 1n },
        ];
        for (const patch of badConfigs) {
            const r = await ctx.master.sendSetGasParams(ctx.deployer.getSender(), { ...DEFAULTS, ...patch });
            expect(r.transactions).toHaveTransaction({ to: ctx.master.address, success: false });
        }
        expectGasView(await ctx.master.getGetGasParams(), DEFAULTS);
    }, 180_000);

    it('coherence invariant: trap-down and cap-up configurations are rejected', async () => {
        const ctx = await prepareFeeCtx();

        // Trap-down: every value passes its own cap, but the lowered gate (0.95)
        // no longer covers the raised treasury leg → entry could admit an attach
        // that fails the fanout (F10 band) → reject.
        const trapDown = await ctx.master.sendSetGasParams(ctx.deployer.getSender(), {
            ...DEFAULTS,
            minTonFeePath: toNano('0.95'),
            treasuryForwardMin: toNano('0.05'),
        });
        expect(trapDown.transactions).toHaveTransaction({ to: ctx.master.address, success: false });

        // Cap-up: recipient deploy leg raised to its 1 TON ceiling while the gate
        // stays at the 1.0 default → worst-case fanout (~1.39) exceeds the gate → reject.
        const capUp = await ctx.master.sendSetGasParams(ctx.deployer.getSender(), {
            ...DEFAULTS,
            perInternalDeployTon: toNano('1'),
        });
        expect(capUp.transactions).toHaveTransaction({ to: ctx.master.address, success: false });

        expectGasView(await ctx.master.getGetGasParams(), DEFAULTS);
    });

    it('wallet re-validates gas params on JettonUpdateFeeConfig (bad master cannot bypass caps)', async () => {
        const ctx = await prepareFeeCtx();
        const fakeMaster = await ctx.blockchain.treasury('f22-fake-master');
        const holder = await ctx.blockchain.treasury('f22-holder');
        const base = await BurnJettonWalletBase.fromInit(holder.address, fakeMaster.address, 0n, beginCell().endCell());
        const wallet = ctx.blockchain.openContract(base);

        const cfgMsg = (gas: GasParams): JettonUpdateFeeConfig => ({
            $$type: 'JettonUpdateFeeConfig',
            queryId: 0n,
            burn_rate_bps: 50n,
            staking_rate_bps: 30n,
            treasury_rate_bps: 20n,
            staking_pool: ctx.staking.address,
            treasury: ctx.treasury.address,
            dynamic_burn_enabled: false,
            large_tx_threshold: 10n * NANO_PER_BURN,
            activity_threshold: 100n,
            max_burn_rate_bps: 100n,
            tx_count_snapshot: 0n,
            activity_hour_bucket: 0n,
            low_supply_mode: false,
            excluded_count: 0n,
            excluded_head: beginCell().endCell(),
            gas_min_ton_fee_path: gas.minTonFeePath,
            gas_per_internal_deploy_ton: gas.perInternalDeployTon,
            gas_pool_forward_min: gas.poolForwardMin,
            gas_treasury_forward_min: gas.treasuryForwardMin,
            gas_burn_notify_ton: gas.burnNotifyTon,
            gas_propagate_ton: gas.propagateTon,
        });

        // Cap violation pushed straight from the "master" → wallet rejects.
        const bad = await wallet.send(
            fakeMaster.getSender(),
            { value: toNano('0.1') },
            cfgMsg({ ...DEFAULTS, minTonFeePath: toNano('0.5') }),
        );
        expect(bad.transactions).toHaveTransaction({ to: wallet.address, success: false });

        // Incoherent config (caps fine, invariant violated) → wallet rejects too.
        const incoherent = await wallet.send(
            fakeMaster.getSender(),
            { value: toNano('0.1') },
            cfgMsg({ ...DEFAULTS, perInternalDeployTon: toNano('1') }),
        );
        expect(incoherent.transactions).toHaveTransaction({ to: wallet.address, success: false });

        // Valid raised config → accepted and readable back.
        const good = await wallet.send(fakeMaster.getSender(), { value: toNano('0.1') }, cfgMsg(RAISED));
        expect(good.transactions).toHaveTransaction({ to: wallet.address, success: true });
        expect(await wallet.getGetFeeConfigActive()).toBe(true);
        expectGasView(await wallet.getGetGasConfig(), RAISED);
    }, 180_000);

    it('bit budget: max-feasible gas values + full 64-address excluded list round-trip through the snapshot', async () => {
        const ctx = await prepareFeeCtx();
        // The wrapper's 0.02 attach OOGs on long excluded chains (recursive scan) —
        // attach more gas per add; list capacity itself is MAX_EXCLUDED_ADDRESSES = 64.
        const addExcluded = async (address: Address) =>
            ctx.master.send(
                ctx.deployer.getSender(),
                { value: toNano('0.5') },
                {
                    $$type: 'AddExcluded',
                    queryId: 0n,
                    address,
                },
            );
        for (let i = 0; i < 63; i++) {
            const holder = await ctx.blockchain.treasury(`f22-excl-${i}`);
            const r = await addExcluded(holder.address);
            expect(r.transactions).toHaveTransaction({ to: ctx.master.address, success: true });
        }
        // 64th entry fills MAX_EXCLUDED_ADDRESSES.
        const last = await ctx.blockchain.treasury('f22-excl-last');
        await addExcluded(last.address);
        expect(await ctx.master.getGetIsExcluded(last.address)).toBe(true);

        // Max coins-width dynamic threshold + max-feasible gas params.
        await ctx.master.sendSetDynamicBurnThresholds(ctx.deployer.getSender(), {
            largeTxThreshold: (1n << 120n) - 1n,
            activityThreshold: 100n,
        });
        const set = await ctx.master.sendSetGasParams(ctx.deployer.getSender(), MAX_FEASIBLE);
        expect(set.transactions).toHaveTransaction({ to: ctx.master.address, success: true });

        const sync = await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        const wx = await getWallet(ctx, ctx.userX.address);
        expect(sync.transactions).toHaveTransaction({ to: wx.address, success: true });
        expect(await wx.getGetFeeConfigActive()).toBe(true);
        expectGasView(await wx.getGetGasConfig(), MAX_FEASIBLE);
    }, 180_000);

    it('wallet addresses are identical before and after a SetGasParams push (emptyCfg derivation)', async () => {
        const ctx = await prepareFeeCtx();
        const before = await ctx.master.getGetWalletAddress(ctx.userY.address);
        const predictedBefore = await BurnJettonMaster.predictWalletAddress(ctx.master.address, ctx.userY.address);

        await ctx.master.sendSetGasParams(ctx.deployer.getSender(), RAISED);
        await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userY.address);

        const after = await ctx.master.getGetWalletAddress(ctx.userY.address);
        const predictedAfter = await BurnJettonMaster.predictWalletAddress(ctx.master.address, ctx.userY.address);
        expect(after.equals(before)).toBe(true);
        expect(predictedAfter.equals(predictedBefore)).toBe(true);

        // The already-synced recipient wallet still receives at the same address.
        const wx = await getWallet(ctx, ctx.userX.address);
        const tx = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: 5n * NANO_PER_BURN,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: TRANSFER_TON,
        });
        expect(tx.transactions).toHaveTransaction({ from: wx.address, to: before, success: true });
    }, 180_000);

    it('stale snapshot executes self-consistently with OLD values until the push arrives', async () => {
        const ctx = await prepareFeeCtx();
        // Governance raises params, but userX wallet keeps the default snapshot.
        await ctx.master.sendSetGasParams(ctx.deployer.getSender(), RAISED);

        const wx = await getWallet(ctx, ctx.userX.address);
        expectGasView(await wx.getGetGasConfig(), DEFAULTS);

        // Old gate (1.0) + old legs: 1.2 TON attach still executes the direct fee path.
        const recipientJw = await ctx.master.getGetWalletAddress(ctx.userY.address);
        const stale = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: 10n * NANO_PER_BURN,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: toNano('1.2'),
        });
        expect(stale.transactions).toHaveTransaction({ from: wx.address, to: recipientJw, success: true });
        expect(legValue(stale.transactions, wx.address, recipientJw)).toBe(DEFAULTS.perInternalDeployTon);
        expect(legValue(stale.transactions, wx.address, ctx.master.address)).toBe(DEFAULTS.burnNotifyTon);

        // Outbound transfers only propagate config to the recipient/sinks — the
        // sender snapshot stays stale until an explicit sync (push channels only).
        expectGasView(await wx.getGetGasConfig(), DEFAULTS);
        await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        expectGasView(await wx.getGetGasConfig(), RAISED);
        const nowLow = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: 10n * NANO_PER_BURN,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            value: toNano('1.2'),
        });
        expect(nowLow.transactions).toHaveTransaction({ to: wx.address, success: false });
    }, 180_000);

    it('transition window: resolve entering via the old gate refunds instead of stranding TON on master (commit guard)', async () => {
        const ctx = await prepareFeeCtx();
        await ctx.master.sendSetGasParams(ctx.deployer.getSender(), RAISED_HARD);

        const wx = await getWallet(ctx, ctx.userX.address);
        expectGasView(await wx.getGetGasConfig(), DEFAULTS); // stale (old gate 1.0)

        const jettonsBefore = await walletBalance(ctx, ctx.userX.address);
        const recipientBefore = await walletBalance(ctx, ctx.userY.address);
        const masterTonBefore = (await ctx.blockchain.getContract(ctx.master.address)).balance;

        // forward ≥ 1 TON forces the resolve hop; 2.3 TON passes the OLD entry gate
        // (1 + 2×fwd + 1.0) but is far below the RAISED_HARD fanout requirement (~4.0)
        // that the freshly pushed snapshot enforces at commit.
        const tx = await wx.sendTransfer(ctx.userX.getSender(), {
            jettonAmount: 10n * NANO_PER_BURN,
            destinationOwner: ctx.userY.address,
            responseDestination: ctx.userX.address,
            forwardTonAmount: toNano('1'),
            value: toNano('2.3'),
        });

        // Commit guard fires: owner gets the F18 failure signal with the TON refund.
        expect(tx.transactions).toHaveTransaction({
            from: wx.address,
            to: ctx.userX.address,
            op: JETTON_TRANSFER_COMMIT_FAILED_OP,
        });
        // No debit, no credit, nothing stranded on master.
        expect(await walletBalance(ctx, ctx.userX.address)).toBe(jettonsBefore);
        expect(await walletBalance(ctx, ctx.userY.address)).toBe(recipientBefore);
        const masterTonAfter = (await ctx.blockchain.getContract(ctx.master.address)).balance;
        expect(masterTonAfter - masterTonBefore).toBeLessThan(toNano('0.06'));
    }, 180_000);
});
