/**
 * IMP-CIP-11 — do not send pool/treasury/burn legs when computeFeeParts is 0.
 *
 * Live (2026-09-04): 10 nano transfer credited the recipient, but JW still
 * fanned out amount=0 legs. StakingPool JettonNotify(0) failed
 * (`require(msg.amount > 0)`).
 */
import { toNano } from '@ton/core';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import {
    deployJetton,
    getWallet,
    MINT_TON,
    NANO_PER_BURN,
    TRANSFER_TON,
    transferAndAssertFees,
} from './helpers';
import { mintAndSyncUser, setupStakingEnvironment } from './staking-helpers';
import '@ton/test-utils';

const JETTON_NOTIFY_OP = 0x7362d09c;

describe('IMP-CIP-11 — skip zero-amount BURN fee legs', () => {
    it('transfer 10 nano: recipient gets amount, pool notify does not fail', async () => {
        const env = await setupStakingEnvironment('https://example.com/cip11-dust-pool.json');
        const sender = await env.blockchain.treasury('cip11-dust-from');
        const recipient = await env.blockchain.treasury('cip11-dust-to');
        const dust = 10n;

        await mintAndSyncUser(env, sender, dust);
        await env.jettonMaster.sendSyncFeeConfigToWallet(env.deployer.getSender(), recipient.address);
        // F14: deploy pool JW so the 0-amount staking leg can notify (live had a warm JW).
        await env.jettonMaster.sendSyncFeeConfigToWallet(env.deployer.getSender(), env.poolAddress);

        const senderJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(sender.address)),
        );
        const recipientJw = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(recipient.address)),
        );

        const tx = await senderJw.sendTransfer(sender.getSender(), {
            jettonAmount: dust,
            destinationOwner: recipient.address,
            responseDestination: sender.address,
            value: TRANSFER_TON,
        });

        expect((await recipientJw.getGetWalletData()).balance).toBe(dust);

        // Desired: no JettonNotify(0) failure. Pre-fix this assertion is RED.
        expect(tx.transactions).not.toHaveTransaction({
            on: env.pool.address,
            op: JETTON_NOTIFY_OP,
            success: false,
        });
    });

    it('fanout ≥ 1 BURN still takes 1% (50/30/20)', async () => {
        const ctx = await deployJetton();
        await ctx.master.sendMint(
            ctx.deployer.getSender(),
            ctx.userX.address,
            200n * NANO_PER_BURN,
            1n,
            MINT_TON,
        );
        await ctx.master.sendMint(ctx.deployer.getSender(), ctx.staking.address, 1n, 1n, MINT_TON);
        await ctx.master.sendMint(ctx.deployer.getSender(), ctx.treasury.address, 1n, 1n, MINT_TON);
        await ctx.master.sendSyncFeeConfigToWallet(ctx.deployer.getSender(), ctx.userX.address);
        const wx = await getWallet(ctx, ctx.userX.address);
        expect((await wx.getGetWalletData()).balance).toBeGreaterThanOrEqual(NANO_PER_BURN);

        const one = 1n * NANO_PER_BURN;
        await transferAndAssertFees(
            ctx,
            ctx.userX,
            ctx.userY.address,
            one,
            (one * 50n) / 10000n,
            (one * 30n) / 10000n,
            (one * 20n) / 10000n,
        );
        expect(toNano('1')).toBe(one);
    });
});
