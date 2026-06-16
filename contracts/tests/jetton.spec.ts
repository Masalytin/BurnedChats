import { beginCell, toNano } from '@ton/core';
import { internal } from '@ton/sandbox';
import {
    BurnJettonMaster_errors_backward,
    JettonTransferInternal,
    type AddExcluded as AddExcludedMsg,
    type Mint as MintMsg,
    type ProvideWalletAddress as ProvideWalletAddressMsg,
    type SetAutoReduceParams as SetAutoReduceParamsMsg,
    type SetFeeParams as SetFeeParamsMsg,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { BurnJettonWallet_errors_backward, storeJettonBurnNotification } from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';
import {
    deployJetton,
    getWallet,
    MINT_TON,
    NANO_PER_BURN,
    setupExcluded,
    TRANSFER_TON,
    TRANSFER_TON_EXCLUDED,
    transferAndAssertFees,
    type JettonDeployedContext,
} from './helpers';
import { ACTIVITY_THRESHOLD_DEFAULT, LARGE_TX_THRESHOLD_10_BURN } from './fixtures/jetton-presets';
import '@ton/test-utils';

describe('BurnJetton', () => {
    let ctx: JettonDeployedContext;

    beforeEach(async () => {
        ctx = await deployJetton();
    });

    describe('TEP-74 base', () => {
        it('deploys master and exposes get_jetton_data / get_wallet_address', async () => {
            const data = await ctx.master.getGetJettonData();
            expect(data.totalSupply).toBe(0n);
            expect(data.mintable).toBe(true);
            expect(data.adminAddress.equals(ctx.deployer.address)).toBe(true);
            expect('timelockAddress' in data).toBe(false);

            const timelock = await ctx.master.getGetTimelockAddress();
            expect(timelock.equals(ctx.deployer.address)).toBe(true);

            const w1 = await ctx.master.getGetWalletAddress(ctx.userX.address);
            const w2 = await ctx.master.getGetWalletAddress(ctx.userX.address);
            expect(w1.equals(w2)).toBe(true);
        });

        it('get_jetton_data returns TEP-74 layout (5 fields, no timelock)', async () => {
            const data = await ctx.master.getGetJettonData();
            const keys = Object.keys(data)
                .filter((k) => k !== '$$type')
                .sort();
            expect(keys).toEqual([
                'adminAddress',
                'jettonContent',
                'jettonWalletCode',
                'mintable',
                'totalSupply',
            ]);
            expect(data.jettonContent).toBeDefined();
            expect(data.jettonWalletCode).toBeDefined();
        });

        it('ProvideWalletAddress returns TakeWalletAddress with predicted wallet', async () => {
            const msg: ProvideWalletAddressMsg = {
                $$type: 'ProvideWalletAddress',
                queryId: 0n,
                ownerAddress: ctx.userX.address,
                includeAddress: false,
            };
            const r = await ctx.master.send(ctx.userX.getSender(), { value: toNano('0.08') }, msg);
            expect(r.transactions).toHaveTransaction({
                from: ctx.master.address,
                to: ctx.userX.address,
                success: true,
            });
            const predicted = await ctx.master.getGetWalletAddress(ctx.userX.address);
            expect(predicted).toBeDefined();
        });

        it('mints, reads balance, transfers, updates supply', async () => {
            const amount = 100n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, amount, 1n, MINT_TON);

            const wx = await getWallet(ctx, ctx.userX.address);
            expect((await wx.getGetWalletData()).balance).toBe(amount);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(amount);

            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 10n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });

            expect((await wx.getGetWalletData()).balance).toBe(90n * NANO_PER_BURN);
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance > 0n).toBe(true);
        });
    });

    describe('Bootstrap mint fee sync', () => {
        it('non-excluded holder minted directly has fee config after SyncFeeConfigToWallet', async () => {
            const amount = 50n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userY.address, amount, 1n, MINT_TON);

            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(amount);
            expect(await wy.getGetFeeConfigActive()).toBe(false);

            const sync = await ctx.master.sendSyncFeeConfigToWallet(
                ctx.deployer.getSender(),
                ctx.userY.address,
            );
            expect(sync.transactions).toHaveTransaction({ success: true });
            expect(await wy.getGetFeeConfigActive()).toBe(true);
        });

        it('excluded mint receiver sync is idempotent and does not change exclusion', async () => {
            await setupExcluded(ctx, [ctx.staking.address]);
            const amount = 10n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, amount, 1n, MINT_TON);

            const ws = await getWallet(ctx, ctx.staking.address);
            expect(await ctx.master.getGetIsExcluded(ctx.staking.address)).toBe(true);
            expect(await ws.getGetFeeConfigActive()).toBe(false);

            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.staking.address);
            expect(await ws.getGetFeeConfigActive()).toBe(true);

            const resync = await ctx.master.sendSyncFeeConfigToWallet(
                ctx.deployer.getSender(),
                ctx.staking.address,
            );
            expect(resync.transactions).toHaveTransaction({ success: true });
            expect(await ws.getGetFeeConfigActive()).toBe(true);
        });
    });

    describe('Fee distribution', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 200n * NANO_PER_BURN, 1n, MINT_TON);
            // Deploy fee sink jetton wallets (required before balance getters in transferAndAssertFees).
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, 1n, 1n, MINT_TON);
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.treasury.address, 1n, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        });

        it('splits 1% across burn/staking/treasury for 100 BURN transfer', async () => {
            const amount = 100n * NANO_PER_BURN;
            const burn = (5n * NANO_PER_BURN) / 10n;
            const staking = (3n * NANO_PER_BURN) / 10n;
            const treasury = (2n * NANO_PER_BURN) / 10n;
            await transferAndAssertFees(ctx, ctx.userX, ctx.userY.address, amount, burn, staking, treasury);
        });

        it('propagates fee config to recipient so they can transfer without sync', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const wy = await getWallet(ctx, ctx.userY.address);
            const amount = 10n * NANO_PER_BURN;

            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });

            expect(await wy.getGetFeeConfigActive()).toBe(true);

            const net = amount - (amount * 50n) / 10000n - (amount * 30n) / 10000n - (amount * 20n) / 10000n;
            expect((await wy.getGetWalletData()).balance).toBe(net);

            await wy.sendTransfer(ctx.userY.getSender(), {
                jettonAmount: 1n * NANO_PER_BURN,
                destinationOwner: ctx.userX.address,
                responseDestination: ctx.userY.address,
                value: TRANSFER_TON,
            });
            expect((await wx.getGetWalletData()).balance).toBeGreaterThan(0n);
        });

        it('rounds fee parts so sum matches amount (odd nano)', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const amount = 10003n;
            const b = (amount * 50n) / 10000n;
            const s = (amount * 30n) / 10000n;
            const t = (amount * 20n) / 10000n;
            const n = amount - b - s - t;
            expect(b + s + t + n).toBe(amount);

            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(n);
        });
    });

    describe('Mint cap', () => {
        it('rejects single mint above 1000 BURN', async () => {
            const over = 1001n * NANO_PER_BURN;
            const mintResult = await ctx.master.sendMint(
                ctx.deployer.getSender(),
                ctx.userX.address,
                over,
                1n,
                toNano('0.5'),
            );
            expect(mintResult.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Mint cap exceeded'],
            });
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(0n);
        });

        it('rejects cumulative mint past hard cap', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 999n * NANO_PER_BURN, 1n, MINT_TON);
            const second = await ctx.master.sendMint(
                ctx.deployer.getSender(),
                ctx.userY.address,
                2n * NANO_PER_BURN,
                1n,
                MINT_TON,
            );
            expect(second.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Mint cap exceeded'],
            });
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(999n * NANO_PER_BURN);
        });
    });

    describe('Close mint (IMP-PREMNT-05)', () => {
        it('mint works before close', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(100n * NANO_PER_BURN);
            expect((await ctx.master.getGetJettonData()).mintable).toBe(true);
        });

        it('non-admin cannot close mint; mintable stays true', async () => {
            const rogue = await ctx.master.sendCloseMint(ctx.userY.getSender());
            expect(rogue.transactions).toHaveTransaction({
                on: ctx.master.address,
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Incorrect sender'],
            });
            expect((await ctx.master.getGetJettonData()).mintable).toBe(true);
        });

        it('admin closes mint irreversibly; mintable flips to false', async () => {
            const r = await ctx.master.sendCloseMint(ctx.deployer.getSender());
            expect(r.transactions).toHaveTransaction({ on: ctx.master.address, success: true });
            expect((await ctx.master.getGetJettonData()).mintable).toBe(false);
        });

        it('mint after close is rejected (even free space under cap after burn)', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendCloseMint(ctx.deployer.getSender());

            // Free up cap space via a burn, then prove mint is still refused.
            const wx = await getWallet(ctx, ctx.userX.address);
            await wx.sendBurn(ctx.userX.getSender(), { jettonAmount: 10n * NANO_PER_BURN, value: toNano('0.08') });
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(90n * NANO_PER_BURN);

            const minted = await ctx.master.sendMint(
                ctx.deployer.getSender(),
                ctx.userY.address,
                5n * NANO_PER_BURN,
                1n,
                MINT_TON,
            );
            expect(minted.transactions).toHaveTransaction({
                on: ctx.master.address,
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Mint is closed'],
            });
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(90n * NANO_PER_BURN);
        });

        it('burn keeps working after close (supply still deflates)', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 50n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendCloseMint(ctx.deployer.getSender());

            const wx = await getWallet(ctx, ctx.userX.address);
            const burnRes = await wx.sendBurn(ctx.userX.getSender(), {
                jettonAmount: 20n * NANO_PER_BURN,
                value: toNano('0.08'),
            });
            expect(burnRes.transactions).toHaveTransaction({ success: true });
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(30n * NANO_PER_BURN);
            expect((await ctx.master.getGetJettonData()).mintable).toBe(false);
        });
    });

    describe('Excluded addresses', () => {
        it('fee = 0 when receiver is excluded; remove restores fees', async () => {
            const minted = 100n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, minted, 1n, MINT_TON);
            await ctx.master.sendAddExcluded(ctx.deployer.getSender(), ctx.userY.address);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            const wx = await getWallet(ctx, ctx.userX.address);
            const ten = 10n * NANO_PER_BURN;
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: ten,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON_EXCLUDED,
            });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(ten);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(minted);

            await ctx.master.sendRemoveExcluded(ctx.deployer.getSender(), ctx.userY.address);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: ten,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            expect((await wy.getGetWalletData()).balance).toBe(
                ten + ten - (ten * 50n) / 10000n - (ten * 30n) / 10000n - (ten * 20n) / 10000n,
            );
        });

        it('fee = 0 when sender is excluded (e.g. staking pool)', async () => {
            await setupExcluded(ctx, [ctx.staking.address]);
            const minted = 50n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, minted, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.staking.address);

            const wSt = await getWallet(ctx, ctx.staking.address);
            const ten = 10n * NANO_PER_BURN;
            await wSt.sendTransfer(ctx.staking.getSender(), {
                jettonAmount: ten,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.staking.address,
                value: TRANSFER_TON_EXCLUDED,
            });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(ten);
        });

        it('excluded transfer passes with reduced attach (0.7 TON)', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 10n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendAddExcluded(ctx.deployer.getSender(), ctx.userY.address);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            const wx = await getWallet(ctx, ctx.userX.address);
            const amount = 1n * NANO_PER_BURN;
            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON_EXCLUDED,
            });
            expect(r.transactions).toHaveTransaction({ success: true });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(amount);
        });

        it('excluded transfer rejects insufficient attach (0.5 TON → exit 32113)', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 10n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendAddExcluded(ctx.deployer.getSender(), ctx.userY.address);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            const wx = await getWallet(ctx, ctx.userX.address);
            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 1n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: toNano('0.5'),
            });
            expect(r.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonWallet_errors_backward['Insufficient amount of TON attached'],
            });
            expect(BurnJettonWallet_errors_backward['Insufficient amount of TON attached']).toBe(32113);
        });
    });

    describe('Gas gates (IMP-JETTON-GAS-02)', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 10n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        });

        it('fee path rejects attach below 2.1 TON gate (2.0 TON)', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 1n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: toNano('2.0'),
            });
            expect(r.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonWallet_errors_backward['Insufficient amount of TON attached'],
            });
        });

        it('fee path passes with TRANSFER_TON (3.5 TON)', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 1n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            expect(r.transactions).toHaveTransaction({ success: true });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBeGreaterThan(0n);
        });
    });

    describe('Sender surplus return (IMP-JETTON-GAS-07)', () => {
        const MIN_TONS_FOR_STORAGE = toNano('0.01');
        const SURPLUS_EPSILON = toNano('0.02');

        beforeEach(async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, 1n, 1n, MINT_TON);
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.treasury.address, 1n, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        });

        it('fee path: sender JW keeps only storage minimum; owner receives bulk excess', async () => {
            const amount = 100n * NANO_PER_BURN;
            const burn = (5n * NANO_PER_BURN) / 10n;
            const staking = (3n * NANO_PER_BURN) / 10n;
            const treasury = (2n * NANO_PER_BURN) / 10n;
            const net = amount - burn - staking - treasury;

            const wx = await getWallet(ctx, ctx.userX.address);
            const wy = await getWallet(ctx, ctx.userY.address);
            const stakeW = await getWallet(ctx, ctx.staking.address);
            const treasW = await getWallet(ctx, ctx.treasury.address);
            const supplyBefore = (await ctx.master.getGetJettonData()).totalSupply;
            let recipientBefore = 0n;
            try {
                recipientBefore = (await wy.getGetWalletData()).balance;
            } catch {
                recipientBefore = 0n;
            }
            const stakeBefore = (await stakeW.getGetWalletData()).balance;
            const treasBefore = (await treasW.getGetWalletData()).balance;
            const ownerTonBefore = await ctx.userX.getBalance();

            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            expect(r.transactions).toHaveTransaction({ from: wx.address, success: true });

            expect((await wy.getGetWalletData()).balance).toBe(recipientBefore + net);
            expect((await stakeW.getGetWalletData()).balance).toBe(stakeBefore + staking);
            expect((await treasW.getGetWalletData()).balance).toBe(treasBefore + treasury);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(supplyBefore - burn);

            const jwTonAfter = (await ctx.blockchain.getContract(wx.address)).balance;
            expect(jwTonAfter).toBeLessThanOrEqual(MIN_TONS_FOR_STORAGE + SURPLUS_EPSILON);

            const ownerDelta = (await ctx.userX.getBalance()) - ownerTonBefore;
            const excessReturned = ownerDelta + TRANSFER_TON;
            expect(excessReturned).toBeGreaterThanOrEqual(toNano('1.5'));
        });

        it('excluded path: surplus returned to response destination', async () => {
            await ctx.master.sendAddExcluded(ctx.deployer.getSender(), ctx.userY.address);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            const wx = await getWallet(ctx, ctx.userX.address);
            const ownerTonBefore = await ctx.userX.getBalance();
            const amount = 10n * NANO_PER_BURN;

            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON_EXCLUDED,
            });
            expect(r.transactions).toHaveTransaction({ from: wx.address, success: true });

            const jwTonAfter = (await ctx.blockchain.getContract(wx.address)).balance;
            expect(jwTonAfter).toBeLessThanOrEqual(MIN_TONS_FOR_STORAGE + SURPLUS_EPSILON);

            const ownerTonAfter = await ctx.userX.getBalance();
            expect(ownerTonAfter - ownerTonBefore).toBeGreaterThan(0n);

            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(amount);
        });
    });

    describe('Warm wallet gas (IMP-JETTON-GAS-06)', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 50n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, 1n, 1n, MINT_TON);
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.treasury.address, 1n, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        });

        it('first transfer to new recipient succeeds (cold deploy path)', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 5n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            expect(r.transactions).toHaveTransaction({ from: wx.address, success: true });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBeGreaterThan(0n);
            expect(await wy.getGetFeeConfigActive()).toBe(true);
        });

        it('repeat transfer to same recipient succeeds with warm-path attach floor', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 5n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });

            const warmAttach = toNano('2.3');
            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 1n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: warmAttach,
            });
            expect(r.transactions).toHaveTransaction({ from: wx.address, success: true });
        });
    });

    describe('Dynamic burn', () => {
        beforeEach(async () => {
            await ctx.master.sendSetDynamicBurnEnabled(ctx.deployer.getSender(), true);
            await ctx.master.sendSetDynamicBurnThresholds(ctx.deployer.getSender(), {
                largeTxThreshold: LARGE_TX_THRESHOLD_10_BURN,
                activityThreshold: 100_000n,
            });
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 200n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        });

        it('amount > 10 BURN adds +25 BPS to burn leg', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const amount = 11n * NANO_PER_BURN;
            const burnBps = 75n;
            const net = amount - (amount * burnBps) / 10000n - (amount * 30n) / 10000n - (amount * 20n) / 10000n;
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(net);
        });
    });

    describe('Dynamic burn activity bonus (tx_count > threshold)', () => {
        it('applies +12 BPS after enough burn notifications on master', async () => {
            await ctx.master.sendSetDynamicBurnEnabled(ctx.deployer.getSender(), true);
            await ctx.master.sendSetDynamicBurnThresholds(ctx.deployer.getSender(), {
                largeTxThreshold: 1000n * NANO_PER_BURN,
                activityThreshold: ACTIVITY_THRESHOLD_DEFAULT,
            });

            const minted = 300n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, minted, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            const wx = await getWallet(ctx, ctx.userX.address);
            for (let i = 0; i < 101; i++) {
                await wx.sendTransfer(ctx.userX.getSender(), {
                    jettonAmount: 1n,
                    destinationOwner: ctx.userY.address,
                    responseDestination: ctx.userX.address,
                    value: TRANSFER_TON,
                });
            }

            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            const amount = 5n * NANO_PER_BURN;
            const burnBps = 62n;
            const net = amount - (amount * burnBps) / 10000n - (amount * 30n) / 10000n - (amount * 20n) / 10000n;
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });

            const wy = await getWallet(ctx, ctx.userY.address);
            const yBal = (await wy.getGetWalletData()).balance;
            const from101nano = 101n;
            expect(yBal).toBe(from101nano + net);
        });
    });

    describe('Auto-reduce (low supply)', () => {
        it('uses 10 / 6 / 4 BPS when totalSupply < 100 BURN', async () => {
            const minted = 200n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, minted, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            const wx = await getWallet(ctx, ctx.userX.address);
            await wx.sendBurn(ctx.userX.getSender(), { jettonAmount: 101n * NANO_PER_BURN, value: toNano('0.08') });

            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(99n * NANO_PER_BURN);
            const eff = await ctx.master.getGetEffectiveFeeParams();
            expect(eff.burnBps).toBe(10n);
            expect(eff.stakingBps).toBe(6n);
            expect(eff.treasuryBps).toBe(4n);

            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
            const ten = 10n * NANO_PER_BURN;
            const net = ten - (ten * 10n) / 10000n - (ten * 6n) / 10000n - (ten * 4n) / 10000n;
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: ten,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(net);
        });

        it('boundary: exactly 100 BURN supply keeps full fee', async () => {
            const minted = 200n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, minted, 1n, MINT_TON);
            const wx = await getWallet(ctx, ctx.userX.address);
            await wx.sendBurn(ctx.userX.getSender(), { jettonAmount: 100n * NANO_PER_BURN, value: toNano('0.08') });

            const eff = await ctx.master.getGetEffectiveFeeParams();
            expect(eff.burnBps).toBe(50n);
            expect(eff.stakingBps).toBe(30n);
            expect(eff.treasuryBps).toBe(20n);
        });
    });

    describe('Edge cases', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        });

        it('rejects transfer with zero amount', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 0n,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            expect(r.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonWallet_errors_backward['Amount must be positive'],
            });
        });

        it('transfer of 1 nano preserves conservation', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 1n,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(1n);
        });

        it('transfer to own address keeps conservation (fees routed out, net returns)', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const before = (await wx.getGetWalletData()).balance;
            const amount = 5n * NANO_PER_BURN;
            const net = amount - (amount * 50n) / 10000n - (amount * 30n) / 10000n - (amount * 20n) / 10000n;
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userX.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            const after = (await wx.getGetWalletData()).balance;
            expect(after).toBe(before - amount + net);
        });

        it('rejects second spend when balance insufficient', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const sixty = 60n * NANO_PER_BURN;
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: sixty,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            const second = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: sixty,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            expect(second.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonWallet_errors_backward['Incorrect balance after send'],
            });
        });
    });

    describe('Permissions', () => {
        it('non-admin cannot Mint, SetFeeParams, AddExcluded, SetAutoReduceParams', async () => {
            const mintMessage: JettonTransferInternal = {
                $$type: 'JettonTransferInternal',
                queryId: 0n,
                amount: 1n * NANO_PER_BURN,
                sender: ctx.master.address,
                responseDestination: ctx.master.address,
                forwardTonAmount: 1n,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            };
            const mint: MintMsg = {
                $$type: 'Mint',
                queryId: 0n,
                receiver: ctx.userX.address,
                mintMessage,
            };
            const mintRes = await ctx.master.send(ctx.userY.getSender(), { value: toNano('0.35') }, mint);
            expect(mintRes.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Incorrect sender'],
            });

            const fee: SetFeeParamsMsg = {
                $$type: 'SetFeeParams',
                queryId: 0n,
                burn_rate_bps: 40n,
                staking_rate_bps: 40n,
                treasury_rate_bps: 10n,
            };
            const feeRes = await ctx.master.send(ctx.userY.getSender(), { value: toNano('0.02') }, fee);
            expect(feeRes.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Only timelock'],
            });

            const add: AddExcludedMsg = {
                $$type: 'AddExcluded',
                queryId: 0n,
                address: ctx.userX.address,
            };
            const addRes = await ctx.master.send(ctx.userY.getSender(), { value: toNano('0.02') }, add);
            expect(addRes.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Only timelock'],
            });

            const ar: SetAutoReduceParamsMsg = {
                $$type: 'SetAutoReduceParams',
                queryId: 0n,
                threshold: 100n * NANO_PER_BURN,
                low_burn_bps: 10n,
                low_staking_bps: 6n,
                low_treasury_bps: 4n,
            };
            const arRes = await ctx.master.send(ctx.userY.getSender(), { value: toNano('0.02') }, ar);
            expect(arRes.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Only timelock'],
            });
        });

        it('SetTimelock: only the current timelock can hand over fee governance (IMP-PREMNT-03)', async () => {
            // Non-timelock caller is rejected and the field is unchanged.
            const rogue = await ctx.master.sendSetTimelock(ctx.userY.getSender(), ctx.userX.address);
            expect(rogue.transactions).toHaveTransaction({
                on: ctx.master.address,
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Only timelock'],
            });
            expect((await ctx.master.getGetTimelockAddress()).equals(ctx.deployer.address)).toBe(true);

            // Current timelock (deployer in this fixture) transfers authority to a new controller.
            const ok = await ctx.master.sendSetTimelock(ctx.deployer.getSender(), ctx.userX.address);
            expect(ok.transactions).toHaveTransaction({ on: ctx.master.address, success: true });
            expect((await ctx.master.getGetTimelockAddress()).equals(ctx.userX.address)).toBe(true);

            // The old timelock can no longer drive fee governance after the handover.
            const stale: SetFeeParamsMsg = {
                $$type: 'SetFeeParams',
                queryId: 0n,
                burn_rate_bps: 40n,
                staking_rate_bps: 40n,
                treasury_rate_bps: 10n,
            };
            const staleRes = await ctx.master.send(ctx.deployer.getSender(), { value: toNano('0.02') }, stale);
            expect(staleRes.transactions).toHaveTransaction({
                on: ctx.master.address,
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Only timelock'],
            });
        });
    });

    describe('bounce handlers (IMP-AUDIT-08)', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        });

        it('JettonBurnNotification bounce restores wallet balance without changing totalSupply', async () => {
            await ctx.master.sendAddExcluded(ctx.deployer.getSender(), ctx.userY.address);
            await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);

            const wx = await getWallet(ctx, ctx.userX.address);
            const burnLeg = 5n * NANO_PER_BURN;
            const supplyBefore = (await ctx.master.getGetJettonData()).totalSupply;

            const xfer = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: burnLeg,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON_EXCLUDED,
            });
            expect(xfer.transactions).toHaveTransaction({ from: wx.address, success: true });
            expect((await wx.getGetWalletData()).balance).toBe(95n * NANO_PER_BURN);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(supplyBefore);

            const notifyBody = beginCell()
                .storeUint(0xffffffff, 32)
                .store(
                    storeJettonBurnNotification({
                        $$type: 'JettonBurnNotification',
                        queryId: 99n,
                        amount: burnLeg,
                        sender: ctx.userX.address,
                        responseDestination: ctx.userX.address,
                    }),
                )
                .endCell();

            const bounceTx = await ctx.blockchain.sendMessage(
                internal({
                    from: ctx.master.address,
                    to: wx.address,
                    value: toNano('0.05'),
                    bounced: true,
                    body: notifyBody,
                }),
            );
            expect(bounceTx.transactions).toHaveTransaction({ on: wx.address, success: true });
            expect((await wx.getGetWalletData()).balance).toBe(100n * NANO_PER_BURN);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(supplyBefore);
        });
    });
});
