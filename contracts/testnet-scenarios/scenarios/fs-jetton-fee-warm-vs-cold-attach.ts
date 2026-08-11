/**
 * fs-jetton-fee-warm-vs-cold-attach — cold recipient @ 3.5 TON then warm @ 2.3
 * (IMP-TNFS-F30 / GAS-06). Uses an ephemeral cold owner so FEE_TEST_RECIPIENT
 * warm state does not force N/A.
 */
import { Address } from '@ton/core';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV5R1 } from '@ton/ton';
import {
    RECOMMENDED_FEE_PATH_NANO,
    RECOMMENDED_FEE_PATH_WARM_NANO,
} from '../../scripts/lib/estimateJettonTransferTon';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    assertSenderFeePreflight,
    readFeeConfigActive,
    readJettonWalletBalance,
    TRANSFER_AMOUNT,
} from '../lib/balances';
import {
    TRANSFER_TON,
    TRANSFER_TON_WARM,
    checkTransferOkBalances,
    checkWarmVsColdAttachCredits,
    resolveFeeTestSender,
} from '../lib/matrix-checks';
import { getLiveAccountState } from '../lib/provider';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const sender = resolveFeeTestSender(ctx);
    const active = await readFeeConfigActive(ctx.provider, jettonMaster, sender);
    if (!active) {
        return 'fee config inactive — run sync:fee:testnet or redeploy';
    }
    return null;
}

/** Fresh V5R1 address — never logs mnemonic; receive-only cold JW target. */
async function ephemeralColdOwner(): Promise<Address> {
    const words = await mnemonicNew(24);
    const keyPair = await mnemonicToPrivateKey(words);
    const networkGlobalId = Number(process.env.WALLET_NETWORK_ID ?? '-3');
    const subwalletNumber = Number(process.env.SUBWALLET_NUMBER ?? '0');
    const wallet = WalletContractV5R1.create({
        publicKey: keyPair.publicKey,
        walletId: {
            networkGlobalId,
            context: { workchain: 0, subwalletNumber, walletVersion: 'v5r1' },
        },
    });
    return wallet.address;
}

async function feePathTransfer(
    ctx: ScenarioContext,
    opts: {
        sender: Address;
        recipient: Address;
        attachNano: bigint;
        label: string;
    },
): Promise<{ recipientDelta: bigint; senderDelta: bigint; supplyDelta: bigint }> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const senderBefore = await readJettonWalletBalance(provider, jettonMaster, opts.sender);
    const recipientBefore = await readJettonWalletBalance(provider, jettonMaster, opts.recipient);
    const supplyBefore = (await master.getGetJettonData()).totalSupply;

    const senderWalletAddr = await master.getGetWalletAddress(opts.sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    console.log(`[fs-jetton-fee-warm-vs-cold-attach] ${opts.label} attach=${opts.attachNano}…`);

    const seqnoBefore = await getSenderSeqno(provider);
    await senderWallet.sendTransfer(provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: opts.recipient,
        responseDestination: opts.sender,
        value: opts.attachNano,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    let recipientAfter = await readJettonWalletBalance(provider, jettonMaster, opts.recipient);
    let senderAfter = await readJettonWalletBalance(provider, jettonMaster, opts.sender);
    let supplyAfter = (await master.getGetJettonData()).totalSupply;
    for (let attempt = 0; attempt < 8 && recipientAfter === recipientBefore; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter = await readJettonWalletBalance(provider, jettonMaster, opts.recipient);
        senderAfter = await readJettonWalletBalance(provider, jettonMaster, opts.sender);
        supplyAfter = (await master.getGetJettonData()).totalSupply;
    }

    return {
        recipientDelta: recipientAfter - recipientBefore,
        senderDelta: senderAfter - senderBefore,
        supplyDelta: supplyAfter - supplyBefore,
    };
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const sender = resolveFeeTestSender(ctx);
    const walletSender = provider.sender().address;
    if (!walletSender || !walletSender.equals(sender)) {
        throw new Error('Mnemonic wallet must equal fee-test sender (Actor A).');
    }

    const senderBurn = await readJettonWalletBalance(provider, jettonMaster, sender);
    await assertSenderFeePreflight(provider, jettonMaster, sender, senderBurn);
    // Need ≥ 2 BURN for two 1-BURN transfers.
    if (senderBurn < 2n * TRANSFER_AMOUNT) {
        throw new Error(`Sender BURN ${senderBurn} < ${2n * TRANSFER_AMOUNT} for cold+warm legs`);
    }

    const recipient = await ephemeralColdOwner();
    const recipientJw = await master.getGetWalletAddress(recipient);
    const coldState = await getLiveAccountState(provider, recipientJw);
    if (coldState.state.type === 'active') {
        throw new Error(
            `Ephemeral recipient JW unexpectedly active (${recipientJw.toString()}) — retry`,
        );
    }

    console.log(
        `[fs-jetton-fee-warm-vs-cold-attach] cold recipient=${recipient.toString({
            urlSafe: true,
            bounceable: true,
        })} coldAttach=${RECOMMENDED_FEE_PATH_NANO} warmAttach=${RECOMMENDED_FEE_PATH_WARM_NANO}`,
    );

    // Guard: constants stay aligned with estimateJettonTransferTon.
    if (TRANSFER_TON !== RECOMMENDED_FEE_PATH_NANO || TRANSFER_TON_WARM !== RECOMMENDED_FEE_PATH_WARM_NANO) {
        throw new Error('TRANSFER_TON / WARM drift vs estimateJettonTransferTon constants');
    }

    const cold = await feePathTransfer(ctx, {
        sender,
        recipient,
        attachNano: RECOMMENDED_FEE_PATH_NANO,
        label: 'cold',
    });
    const coldJetton = checkTransferOkBalances({
        ...cold,
        amount: TRANSFER_AMOUNT,
    });
    if (coldJetton.some((c) => !c.ok)) {
        return coldJetton.map((c) => ({ ...c, name: `cold-${c.name}` }));
    }

    // Warm: feeConfig propagated to recipient JW after first fee-path transfer.
    let warm = false;
    for (let i = 0; i < 8 && !warm; i += 1) {
        warm = await readFeeConfigActive(provider, jettonMaster, recipient);
        if (!warm) {
            await new Promise((r) => setTimeout(r, 2_000));
        }
    }
    if (!warm) {
        throw new Error('Recipient JW feeConfig not active after cold transfer — cannot assert warm leg');
    }

    const warmLeg = await feePathTransfer(ctx, {
        sender,
        recipient,
        attachNano: RECOMMENDED_FEE_PATH_WARM_NANO,
        label: 'warm',
    });
    const warmJetton = checkTransferOkBalances({
        ...warmLeg,
        amount: TRANSFER_AMOUNT,
    });
    if (warmJetton.some((c) => !c.ok)) {
        return warmJetton.map((c) => ({ ...c, name: `warm-${c.name}` }));
    }

    return checkWarmVsColdAttachCredits({
        coldRecipientDelta: cold.recipientDelta,
        warmRecipientDelta: warmLeg.recipientDelta,
        amount: TRANSFER_AMOUNT,
        coldAttachNano: RECOMMENDED_FEE_PATH_NANO,
        warmAttachNano: RECOMMENDED_FEE_PATH_WARM_NANO,
    });
}

export const scenario: Scenario = {
    id: 'fs-jetton-fee-warm-vs-cold-attach',
    title: 'Fee-path warm vs cold attach (GAS-06)',
    description:
        'Ephemeral cold recipient @ 3.5 TON then warm @ 2.3 TON — both credit fee-path net (GAS-06).',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-fee-near-floor-ok'],
    naWhen,
    run: runChecks,
    budget: { signer: 'actor', minTon: RECOMMENDED_FEE_PATH_NANO + RECOMMENDED_FEE_PATH_WARM_NANO },
};

export default scenario;
