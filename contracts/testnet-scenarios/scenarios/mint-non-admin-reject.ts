import { beginCell, toNano, type Address, type Cell, type Sender } from '@ton/core';
import { getSecureRandomBytes, keyPairFromSeed } from '@ton/crypto';
import { internal, WalletContractV4 } from '@ton/ton';
import type { NetworkProvider } from '@ton/blueprint';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    DESTRUCTIVE_ORDER_NOTE,
    MINT_FORWARD_TON,
    MINT_PROBE_NANO,
    MINT_TON,
    checkSupplyDelta,
    prepareDestructive,
} from '../lib/destructive-preflight';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

function ephemeralSender(provider: NetworkProvider, rogue: WalletContractV4, secretKey: Buffer): Sender {
    return {
        address: rogue.address,
        send: async (args: { to: Address; value: bigint; body?: Cell; bounce?: boolean }) => {
            const openedWallet = provider.open(rogue);
            const seqno = await openedWallet.getSeqno();
            await openedWallet.sendTransfer({
                seqno,
                secretKey,
                messages: [
                    internal({
                        to: args.to,
                        value: args.value,
                        bounce: args.bounce ?? true,
                        body: args.body ?? beginCell().endCell(),
                    }),
                ],
            });
        },
    };
}

async function waitForWalletSeqno(
    provider: NetworkProvider,
    wallet: WalletContractV4,
    fromSeqno: number,
    attempts = 20,
    sleepMs = 2_000,
): Promise<void> {
    const opened = provider.open(wallet);
    for (let i = 0; i < attempts; i += 1) {
        const seqno = await opened.getSeqno();
        if (seqno > fromSeqno) {
            return;
        }
        await new Promise((r) => setTimeout(r, sleepMs));
    }
    throw new Error(`ephemeral wallet seqno did not advance past ${fromSeqno}`);
}

async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { opened, snap } = await prepareDestructive(ctx, 'mint-ops');
    const supplyBefore = snap.totalSupply;

    // Ephemeral v4 wallet — no second mnemonic required (decision: IMP-TNSCEN-04-non-admin-ephemeral).
    const keyPair = keyPairFromSeed(await getSecureRandomBytes(32));
    const rogue = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    console.log(`[mint-non-admin-reject] funding ephemeral non-admin ${rogue.address.toString()}…`);

    const fundSeqno = await getSenderSeqno(ctx.provider);
    await ctx.provider.sender().send({
        to: rogue.address,
        value: toNano('0.35'),
        bounce: false,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, fundSeqno);

    // First getSeqno may be 0 on undeployed wallet; wait until contract is funded/visible.
    const rogueOpened = ctx.provider.open(rogue);
    let funded = false;
    for (let i = 0; i < 20; i += 1) {
        try {
            await rogueOpened.getSeqno();
            funded = true;
            break;
        } catch {
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    if (!funded) {
        throw new Error('ephemeral non-admin wallet not visible on-chain after funding');
    }

    const seqnoBefore = await rogueOpened.getSeqno();
    console.log('[mint-non-admin-reject] non-admin mint attempt (expect reject)…');
    await opened.sendMint(
        ephemeralSender(ctx.provider, rogue, keyPair.secretKey),
        rogue.address,
        MINT_PROBE_NANO,
        MINT_FORWARD_TON,
        MINT_TON,
    );
    await waitForWalletSeqno(ctx.provider, rogue, seqnoBefore);

    const supplyAfter = (await opened.getGetJettonData()).totalSupply;
    return [
        checkSupplyDelta(
            supplyBefore,
            supplyAfter,
            0n,
            'non-admin mint rejected (supply unchanged)',
        ),
    ];
}

const scenario: Scenario = {
    id: 'mint-non-admin-reject',
    title: 'Non-admin mint is rejected',
    description:
        `Ephemeral non-admin wallet attempts Mint; supply must stay unchanged (sandbox non-admin Mint). ${DESTRUCTIVE_ORDER_NOTE}`,
    tags: ['destructive', 'admin'],
    needsLiveTx: true,
    run,
};

export default scenario;
