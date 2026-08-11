/**
 * fs-jetton-dex-exclude-add-live — Timelock AddExcluded for a throwaway
 * DEX-like owner → SyncFeeConfig → transfer delivers 100% (IMP-TNFS-F23 / F04).
 *
 * Lab-only: never mutates shared tip excluded list. RemoveExcluded is F31.
 * Throwaway address is ephemeral (not a production DEX / user wallet).
 */
import { Address, toNano } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { check } from '../lib/checks';
import {
    MIN_SENDER_BALANCE,
    readJettonWalletBalance,
    TRANSFER_AMOUNT,
} from '../lib/balances';
import {
    buildAddExcludedBody,
    buildSyncFeeConfigBody,
    createEphemeralWalletSender,
    naWhenDexExcludeLive,
    OP_ADD_EXCLUDED,
    OP_SYNC_FEE_CONFIG,
    readJettonAdminState,
    resolveAdminActor,
    sendJettonAdminBody,
} from '../lib/jetton-admin';
import { resolveDeployerSender } from '../lib/gov';
import {
    checkExcludedTransferOkBalances,
    EXCLUDED_NEAR_FLOOR_ATTACH_NANO,
    requireFeeTestRecipient,
} from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** Seed throwaway with enough BURN for one excluded transfer + dust. */
const SEED_BURN = TRANSFER_AMOUNT + 100_000_000n; // 1.1 BURN
const SEED_TON = toNano('1.2');

export const naWhen = naWhenDexExcludeLive;

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const funder = provider.sender().address;
    if (!funder) {
        throw new Error('Blueprint mnemonic wallet address unavailable for BURN seed.');
    }

    const recipient = requireFeeTestRecipient();
    if (recipient.equals(funder)) {
        throw new Error('FEE_TEST_RECIPIENT must differ from Blueprint funder.');
    }

    const funderBurn = await readJettonWalletBalance(provider, jettonMaster, funder);
    if (funderBurn < SEED_BURN) {
        throw new Error(
            `Funder BURN ${funderBurn} < ${SEED_BURN} — need ≥1.1 BURN to seed throwaway DEX owner.`,
        );
    }

    const state = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, state);
    if (!actor) {
        throw new Error('admin actor unresolved after naWhen passed');
    }

    // 1) Ephemeral throwaway "DEX-like" owner (never logged / persisted).
    const pool = await createEphemeralWalletSender(ctx);
    console.log(
        `[fs-jetton-dex-exclude-add-live] throwaway pool=${pool.address.toString({
            urlSafe: true,
            bounceable: true,
        })}`,
    );

    // 2) Fund TON (deployer) + BURN (Blueprint Actor A).
    const deployer = await resolveDeployerSender(ctx);
    let seqno = await deployer.getSeqno();
    await deployer.sender.send({
        to: pool.address,
        value: SEED_TON,
        bounce: false,
    });
    await deployer.waitSeqnoIncrement(seqno);

    const funderJwAddr = await master.getGetWalletAddress(funder);
    const funderJw = provider.open(BurnJettonWallet.fromAddress(funderJwAddr));
    seqno = await getSenderSeqno(provider);
    await funderJw.sendTransfer(provider.sender(), {
        jettonAmount: SEED_BURN,
        destinationOwner: pool.address,
        responseDestination: funder,
        value: toNano('3.5'),
    });
    await waitForSenderSeqnoIncrement(provider, seqno);

    let poolBurn = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    for (let i = 0; i < 10 && poolBurn < TRANSFER_AMOUNT; i += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        poolBurn = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    }
    if (poolBurn < TRANSFER_AMOUNT) {
        throw new Error(
            `Throwaway pool BURN ${poolBurn} < ${TRANSFER_AMOUNT} after seed — abort before AddExcluded.`,
        );
    }

    // 3) Timelock AddExcluded + SyncFeeConfig (lab governor / multisig).
    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_ADD_EXCLUDED,
        body: buildAddExcludedBody(pool.address),
        label: 'fs-jetton-dex-exclude-add-live:AddExcluded',
    });

    let isExcluded = await master.getGetIsExcluded(pool.address);
    for (let i = 0; i < 12 && !isExcluded; i += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        isExcluded = await master.getGetIsExcluded(pool.address);
    }
    if (!isExcluded) {
        throw new Error('AddExcluded did not surface on master getIsExcluded within poll budget');
    }

    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_SYNC_FEE_CONFIG,
        body: buildSyncFeeConfigBody(pool.address),
        label: 'fs-jetton-dex-exclude-add-live:SyncFeeConfig',
    });
    // Allow JW feeConfig push to settle before excluded transfer.
    await new Promise((r) => setTimeout(r, 8_000));

    // 4) Transfer from excluded throwaway → recipient; assert 100%.
    if (poolBurn < MIN_SENDER_BALANCE && poolBurn < TRANSFER_AMOUNT) {
        throw new Error(`Excluded pool BURN ${poolBurn} too low for transfer`);
    }
    const senderBefore = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    const recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);

    const poolJwAddr = await master.getGetWalletAddress(pool.address);
    const poolJw = provider.open(BurnJettonWallet.fromAddress(poolJwAddr));
    const attachNano = EXCLUDED_NEAR_FLOOR_ATTACH_NANO;
    console.log(
        `[fs-jetton-dex-exclude-add-live] excluded transfer amount=${TRANSFER_AMOUNT} attach=${attachNano}…`,
    );

    seqno = await pool.getSeqno();
    await poolJw.sendTransfer(pool.sender, {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: pool.address,
        value: attachNano,
    });
    await pool.waitSeqnoIncrement(seqno);

    let recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
    let senderAfter = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    for (let attempt = 0; attempt < 8 && recipientAfter === recipientBefore; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        senderAfter = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    }

    const balanceChecks = checkExcludedTransferOkBalances({
        recipientDelta: recipientAfter - recipientBefore,
        senderDelta: senderAfter - senderBefore,
        amount: TRANSFER_AMOUNT,
    });

    return [
        check(
            'throwaway-excluded',
            isExcluded,
            `pool ${pool.address.toString({ urlSafe: true, bounceable: true })} on master excluded list`,
        ),
        ...balanceChecks,
        check(
            'cleanup-deferred-f31',
            true,
            'RemoveExcluded deferred to IMP-TNFS-F31 (throwaway left excluded on lab tip)',
        ),
    ];
}

export const scenario: Scenario = {
    id: 'fs-jetton-dex-exclude-add-live',
    title: 'AddExcluded DEX-path live (F04)',
    description:
        'Lab: Timelock AddExcluded throwaway DEX-like owner → SyncFeeConfig → transfer delivers 100%. ' +
        'Shared tip / revoked admin → N/A. RemoveExcluded is F31.',
    tags: ['jetton', 'admin', 'lab'],
    needsLiveTx: true,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
