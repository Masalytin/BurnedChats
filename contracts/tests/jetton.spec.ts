import { Address, beginCell, toNano } from '@ton/core';
import { internal } from '@ton/sandbox';
import {
    BurnJettonMaster_errors_backward,
    JettonTransferInternal,
    type ChangeOwner as ChangeOwnerMsg,
    type JettonUpdateContent as JettonUpdateContentMsg,
    type Mint as MintMsg,
    type ProvideWalletAddress as ProvideWalletAddressMsg,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import {
    BurnJettonWallet_errors_backward,
    storeJettonBurnNotification,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';
import {
    burnOf,
    deployJetton,
    getWallet,
    MINT_TON,
    NANO_PER_BURN,
    netOf,
    TRANSFER_TON,
    transferAndAssertBurn,
    type JettonDeployedContext,
} from './helpers';
import { assertRelayFlowClean } from './helpers/cashbackLoopAssert';
import {
    DUST_TRANSFER_BELOW_BURN_UNIT,
    ODD_TRANSFER_NANO,
    TRANSFER_100_BURN,
} from './fixtures/jetton-presets';
import '@ton/test-utils';

/** addr_std in basechain with an all-zero hash — nobody controls the private key. */
const INACCESSIBLE_ADDRESS = new Address(0, Buffer.alloc(32, 0));

describe('BurnJetton (pure 1% burn, IMP-TOKSIM-01)', () => {
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

            const w1 = await ctx.master.getGetWalletAddress(ctx.userX.address);
            const w2 = await ctx.master.getGetWalletAddress(ctx.userX.address);
            expect(w1.equals(w2)).toBe(true);
        });

        it('get_jetton_data returns TEP-74 layout (5 fields, nothing extra)', async () => {
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

        it('mints, reads balance, transfers with 1% burn, updates supply', async () => {
            const amount = 100n * NANO_PER_BURN;
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, amount, 1n, MINT_TON);

            const wx = await getWallet(ctx, ctx.userX.address);
            expect((await wx.getGetWalletData()).balance).toBe(amount);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(amount);

            const ten = 10n * NANO_PER_BURN;
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: ten,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });

            expect((await wx.getGetWalletData()).balance).toBe(90n * NANO_PER_BURN);
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(netOf(ten));
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(amount - burnOf(ten));
        });

        it('get_wallet_data exposes balance/owner/master/code', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, NANO_PER_BURN, 1n, MINT_TON);
            const wx = await getWallet(ctx, ctx.userX.address);
            const wd = await wx.getGetWalletData();
            expect(wd.balance).toBe(NANO_PER_BURN);
            expect(wd.owner.equals(ctx.userX.address)).toBe(true);
            expect(wd.minter.equals(ctx.master.address)).toBe(true);
            expect(wd.code).toBeDefined();
        });
    });

    describe('Burn semantics (hardcoded 1%)', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(
                ctx.deployer.getSender(),
                ctx.userX.address,
                200n * NANO_PER_BURN,
                1n,
                MINT_TON,
            );
        });

        it('transfer of 100 BURN burns exactly 1 BURN and delivers 99 BURN', async () => {
            expect(burnOf(TRANSFER_100_BURN)).toBe(1n * NANO_PER_BURN);
            await transferAndAssertBurn(ctx, ctx.userX, ctx.userY.address, TRANSFER_100_BURN);
        });

        it('wallet works immediately after deploy — no master push required', async () => {
            // First hop: cold recipient wallet is deployed by the transfer itself.
            await transferAndAssertBurn(ctx, ctx.userX, ctx.userY.address, 10n * NANO_PER_BURN);
            // Second hop: fresh recipient can transfer right away, burn applies too.
            await transferAndAssertBurn(ctx, ctx.userY, ctx.deployer.address, 1n * NANO_PER_BURN);
        });

        it('odd nano amount: burn truncates, burn + net === amount', async () => {
            expect(burnOf(ODD_TRANSFER_NANO)).toBe(100n);
            expect(netOf(ODD_TRANSFER_NANO)).toBe(9_903n);
            await transferAndAssertBurn(ctx, ctx.userX, ctx.userY.address, ODD_TRANSFER_NANO);
        });

        it('amount < 100 nano: burn = 0 (integer truncation), transfer succeeds in full', async () => {
            expect(burnOf(DUST_TRANSFER_BELOW_BURN_UNIT)).toBe(0n);
            const supplyBefore = (await ctx.master.getGetJettonData()).totalSupply;

            await transferAndAssertBurn(ctx, ctx.userX, ctx.userY.address, DUST_TRANSFER_BELOW_BURN_UNIT);

            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(DUST_TRANSFER_BELOW_BURN_UNIT);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(supplyBefore);
        });

        it('transfer of 1 nano delivers 1 nano, burns nothing', async () => {
            await transferAndAssertBurn(ctx, ctx.userX, ctx.userY.address, 1n);
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(1n);
        });

        it('explicit JettonBurn still deflates supply', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const supplyBefore = (await ctx.master.getGetJettonData()).totalSupply;
            const r = await wx.sendBurn(ctx.userX.getSender(), {
                jettonAmount: 20n * NANO_PER_BURN,
                value: toNano('0.08'),
            });
            expect(r.transactions).toHaveTransaction({ success: true });
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(supplyBefore - 20n * NANO_PER_BURN);
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

    describe('Close mint (irreversible)', () => {
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

        it('admin closes mint; mintable flips to false', async () => {
            const r = await ctx.master.sendCloseMint(ctx.deployer.getSender());
            expect(r.transactions).toHaveTransaction({ on: ctx.master.address, success: true });
            expect((await ctx.master.getGetJettonData()).mintable).toBe(false);
        });

        it('mint after close is rejected even when burn freed cap space', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendCloseMint(ctx.deployer.getSender());

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

        it('transfers (and their burn leg) keep working after close', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 50n * NANO_PER_BURN, 1n, MINT_TON);
            await ctx.master.sendCloseMint(ctx.deployer.getSender());
            await transferAndAssertBurn(ctx, ctx.userX, ctx.userY.address, 10n * NANO_PER_BURN);
            expect((await ctx.master.getGetJettonData()).mintable).toBe(false);
        });
    });

    describe('Admin revocation (ChangeOwner to inaccessible address)', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(
                ctx.deployer.getSender(),
                ctx.userX.address,
                100n * NANO_PER_BURN,
                1n,
                MINT_TON,
            );
            const r = await ctx.master.sendChangeOwner(ctx.deployer.getSender(), INACCESSIBLE_ADDRESS);
            expect(r.transactions).toHaveTransaction({ on: ctx.master.address, success: true });
        });

        it('admin field points to the inaccessible address', async () => {
            const data = await ctx.master.getGetJettonData();
            expect(data.adminAddress.equals(INACCESSIBLE_ADDRESS)).toBe(true);
        });

        it('transfer path keeps working after revocation (burn applies)', async () => {
            await transferAndAssertBurn(ctx, ctx.userX, ctx.userY.address, TRANSFER_100_BURN / 10n);
        });

        it('all admin ops from the former admin are rejected', async () => {
            const mint = await ctx.master.sendMint(
                ctx.deployer.getSender(),
                ctx.userY.address,
                NANO_PER_BURN,
                1n,
                MINT_TON,
            );
            expect(mint.transactions).toHaveTransaction({
                on: ctx.master.address,
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Incorrect sender'],
            });

            const close = await ctx.master.sendCloseMint(ctx.deployer.getSender());
            expect(close.transactions).toHaveTransaction({
                on: ctx.master.address,
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Incorrect sender'],
            });

            const content: JettonUpdateContentMsg = {
                $$type: 'JettonUpdateContent',
                queryId: 0n,
                content: beginCell().endCell(),
            };
            const upd = await ctx.master.send(ctx.deployer.getSender(), { value: toNano('0.02') }, content);
            expect(upd.transactions).toHaveTransaction({
                on: ctx.master.address,
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Incorrect sender'],
            });

            const takeBack = await ctx.master.sendChangeOwner(ctx.deployer.getSender(), ctx.deployer.address);
            expect(takeBack.transactions).toHaveTransaction({
                on: ctx.master.address,
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Incorrect sender'],
            });
            expect((await ctx.master.getGetJettonData()).adminAddress.equals(INACCESSIBLE_ADDRESS)).toBe(true);
        });
    });

    describe('Immutability of the fee', () => {
        it('ABI has no fee/excluded/timelock/dynamic-burn error strings left', async () => {
            const masterErrors = Object.keys(BurnJettonMaster_errors_backward).join('|');
            expect(masterErrors).not.toContain('Only timelock');
            expect(masterErrors).not.toContain('excluded');
            const walletErrors = Object.keys(BurnJettonWallet_errors_backward).join('|');
            expect(walletErrors).not.toContain('Fee config');
        });
    });

    describe('Gas gates (burn-only path)', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 10n * NANO_PER_BURN, 1n, MINT_TON);
        });

        it('rejects attach below the burn-path gate (0.5 TON)', async () => {
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
        });

        it('passes with TRANSFER_TON (0.8 TON) — cold recipient deploy included', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 1n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            expect(r.transactions).toHaveTransaction({ success: true });
            const wy = await getWallet(ctx, ctx.userY.address);
            expect((await wy.getGetWalletData()).balance).toBe(netOf(1n * NANO_PER_BURN));
        });

        it('sender JW keeps only storage minimum; owner receives surplus', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const ownerTonBefore = await ctx.userX.getBalance();

            const r = await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: 1n * NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            expect(r.transactions).toHaveTransaction({ from: wx.address, success: true });

            const jwTonAfter = (await ctx.blockchain.getContract(wx.address)).balance;
            expect(jwTonAfter).toBeLessThanOrEqual(toNano('0.01') + toNano('0.02'));

            const ownerTonAfter = await ctx.userX.getBalance();
            // Owner paid TRANSFER_TON but got the surplus back — net spend well below the attach.
            expect(ownerTonBefore - ownerTonAfter).toBeLessThan(TRANSFER_TON);
        });
    });

    describe('Edge cases', () => {
        beforeEach(async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
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

        it('transfer to own address keeps conservation (burn leg routed out, net returns)', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const before = (await wx.getGetWalletData()).balance;
            const amount = 5n * NANO_PER_BURN;
            await wx.sendTransfer(ctx.userX.getSender(), {
                jettonAmount: amount,
                destinationOwner: ctx.userX.address,
                responseDestination: ctx.userX.address,
                value: TRANSFER_TON,
            });
            const after = (await wx.getGetWalletData()).balance;
            expect(after).toBe(before - amount + netOf(amount));
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

        it('non-owner cannot spend from someone else’s wallet', async () => {
            const wx = await getWallet(ctx, ctx.userX.address);
            const r = await wx.sendTransfer(ctx.userY.getSender(), {
                jettonAmount: NANO_PER_BURN,
                destinationOwner: ctx.userY.address,
                responseDestination: ctx.userY.address,
                value: TRANSFER_TON,
            });
            expect(r.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonWallet_errors_backward['Incorrect sender'],
            });
        });
    });

    describe('Permissions', () => {
        it('non-admin cannot Mint', async () => {
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
        });

        it('non-admin cannot ChangeOwner or JettonUpdateContent', async () => {
            const co: ChangeOwnerMsg = {
                $$type: 'ChangeOwner',
                queryId: 0n,
                newOwner: ctx.userY.address,
            };
            const coRes = await ctx.master.send(ctx.userY.getSender(), { value: toNano('0.02') }, co);
            expect(coRes.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Incorrect sender'],
            });

            const upd: JettonUpdateContentMsg = {
                $$type: 'JettonUpdateContent',
                queryId: 0n,
                content: beginCell().endCell(),
            };
            const updRes = await ctx.master.send(ctx.userY.getSender(), { value: toNano('0.02') }, upd);
            expect(updRes.transactions).toHaveTransaction({
                success: false,
                exitCode: BurnJettonMaster_errors_backward['Incorrect sender'],
            });
        });
    });

    describe('bounce handlers', () => {
        it('JettonBurnNotification bounce restores wallet balance without changing totalSupply', async () => {
            await ctx.master.sendMint(ctx.deployer.getSender(), ctx.userX.address, 100n * NANO_PER_BURN, 1n, MINT_TON);
            const wx = await getWallet(ctx, ctx.userX.address);
            const supplyBefore = (await ctx.master.getGetJettonData()).totalSupply;
            const burnLeg = 5n * NANO_PER_BURN;

            // Synthetic bounced burn notification from master → wallet re-credits the leg.
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
            expect((await wx.getGetWalletData()).balance).toBe(105n * NANO_PER_BURN);
            expect((await ctx.master.getGetJettonData()).totalSupply).toBe(supplyBefore);
        });
    });
});

describe('IMP-RELAY-04 — BurnJettonMaster plain-TON relay', () => {
    let ctx: JettonDeployedContext;

    beforeEach(async () => {
        ctx = await deployJetton();
    });

    it('Mint bootstrap has zero empty-body hops Master↔wallet', async () => {
        const walletAddr = await ctx.master.getGetWalletAddress(ctx.userY.address);
        const mintTx = await ctx.master.sendMint(
            ctx.deployer.getSender(),
            ctx.userY.address,
            10n * NANO_PER_BURN,
            1n,
            MINT_TON,
        );
        expect(mintTx.transactions).toHaveTransaction({ success: true });

        assertRelayFlowClean(mintTx.transactions, {
            partnerPairs: [[ctx.master.address, walletAddr]],
        });
    });

    it('external plain TON to Master cashbacks without relay loop', async () => {
        const plainTx = await ctx.master.send(ctx.userX.getSender(), { value: toNano('0.05') }, null);
        assertRelayFlowClean(plainTx.transactions, { maxTx: 5 });
    });
});
