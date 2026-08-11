/**
 * fs-jetton-remove-excluded-stale — RemoveExcluded without SyncFeeConfig →
 * next transfer still takes 1% fees (IMP-TNFS-F31 / IMP-MNAUD-F11).
 *
 * Lab-only: throwaway owner AddExcluded+Sync → 100% credit → RemoveExcluded
 * (no Sync) → fee-path attach → assert net 99%. Cleanup is RemoveExcluded itself.
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
    buildRemoveExcludedBody,
    buildSyncFeeConfigBody,
    createEphemeralWalletSender,
    naWhenDexExcludeLive,
    OP_ADD_EXCLUDED,
    OP_REMOVE_EXCLUDED,
    OP_SYNC_FEE_CONFIG,
    readJettonAdminState,
    resolveAdminActor,
    sendJettonAdminBody,
} from '../lib/jetton-admin';
import { resolveDeployerSender } from '../lib/gov';
import {
    checkExcludedTransferOkBalances,
    checkTransferOkBalances,
    FEE_NEAR_FLOOR_ATTACH_NANO,
    requireFeeTestRecipient,
    TRANSFER_TON,
} from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** Two transfers (excluded then fee) + dust. */
const SEED_BURN = TRANSFER_AMOUNT * 2n + 100_000_000n;
const SEED_TON = toNano('8');

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
            `Funder BURN ${funderBurn} < ${SEED_BURN} — need ≥${Number(SEED_BURN) / 1e9} BURN to seed throwaway.`,
        );
    }

    const state = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, state);
    if (!actor) {
        throw new Error('admin actor unresolved after naWhen passed');
    }

    const pool = await createEphemeralWalletSender(ctx);
    console.log(
        `[fs-jetton-remove-excluded-stale] throwaway=${pool.address.toString({
            urlSafe: true,
            bounceable: true,
        })}`,
    );

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
        value: TRANSFER_TON,
    });
    await waitForSenderSeqnoIncrement(provider, seqno);

    let poolBurn = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    for (let i = 0; i < 10 && poolBurn < TRANSFER_AMOUNT * 2n; i += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        poolBurn = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    }
    if (poolBurn < TRANSFER_AMOUNT * 2n) {
        throw new Error(
            `Throwaway BURN ${poolBurn} < ${TRANSFER_AMOUNT * 2n} after seed — abort.`,
        );
    }

    // 1) AddExcluded + Sync → excluded transfer 100%.
    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_ADD_EXCLUDED,
        body: buildAddExcludedBody(pool.address),
        label: 'fs-jetton-remove-excluded-stale:AddExcluded',
    });

    let isExcluded = await master.getGetIsExcluded(pool.address);
    for (let i = 0; i < 12 && !isExcluded; i += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        isExcluded = await master.getGetIsExcluded(pool.address);
    }
    if (!isExcluded) {
        throw new Error('AddExcluded did not surface on master getIsExcluded');
    }

    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_SYNC_FEE_CONFIG,
        body: buildSyncFeeConfigBody(pool.address),
        label: 'fs-jetton-remove-excluded-stale:SyncFeeConfig',
    });
    await new Promise((r) => setTimeout(r, 8_000));

    const poolJwAddr = await master.getGetWalletAddress(pool.address);
    const poolJw = provider.open(BurnJettonWallet.fromAddress(poolJwAddr));

    let senderBefore = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    let recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);

    seqno = await pool.getSeqno();
    await poolJw.sendTransfer(pool.sender, {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: pool.address,
        value: FEE_NEAR_FLOOR_ATTACH_NANO,
    });
    await pool.waitSeqnoIncrement(seqno);

    let recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
    let senderAfter = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    for (let attempt = 0; attempt < 8 && recipientAfter === recipientBefore; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        senderAfter = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    }

    const excludedOk = checkExcludedTransferOkBalances({
        recipientDelta: recipientAfter - recipientBefore,
        senderDelta: senderAfter - senderBefore,
        amount: TRANSFER_AMOUNT,
    });

    // 2) RemoveExcluded WITHOUT SyncFeeConfig — JW snapshot still claims excluded.
    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_REMOVE_EXCLUDED,
        body: buildRemoveExcludedBody(pool.address),
        label: 'fs-jetton-remove-excluded-stale:RemoveExcluded',
    });

    let stillExcluded = await master.getGetIsExcluded(pool.address);
    for (let i = 0; i < 12 && stillExcluded; i += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        stillExcluded = await master.getGetIsExcluded(pool.address);
    }
    if (stillExcluded) {
        throw new Error('RemoveExcluded did not clear master getIsExcluded');
    }

    // 3) Transfer with fee-path attach → must charge 1% (F11 live-resolve).
    if (senderAfter < MIN_SENDER_BALANCE && senderAfter < TRANSFER_AMOUNT) {
        throw new Error(`Throwaway BURN ${senderAfter} too low for post-remove transfer`);
    }

    senderBefore = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
    const supplyBefore = (await master.getGetJettonData()).totalSupply;

    console.log(
        `[fs-jetton-remove-excluded-stale] post-RemoveExcluded (no Sync) transfer attach=${TRANSFER_TON}…`,
    );
    seqno = await pool.getSeqno();
    await poolJw.sendTransfer(pool.sender, {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: pool.address,
        value: TRANSFER_TON,
    });
    await pool.waitSeqnoIncrement(seqno);

    recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
    senderAfter = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    for (let attempt = 0; attempt < 10 && recipientAfter === recipientBefore; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        senderAfter = await readJettonWalletBalance(provider, jettonMaster, pool.address);
    }
    const supplyAfter = (await master.getGetJettonData()).totalSupply;

    const feeOk = checkTransferOkBalances({
        recipientDelta: recipientAfter - recipientBefore,
        senderDelta: senderAfter - senderBefore,
        amount: TRANSFER_AMOUNT,
        supplyDelta: supplyAfter - supplyBefore,
    });

    return [
        check(
            'throwaway-was-excluded',
            isExcluded,
            `pool was on master excluded list before RemoveExcluded`,
        ),
        ...excludedOk,
        check(
            'removed-from-master',
            !stillExcluded,
            'getIsExcluded=false after RemoveExcluded (no Sync)',
        ),
        ...feeOk,
        check(
            'cleanup-remove-done',
            !stillExcluded,
            'throwaway not left on excluded list (RemoveExcluded is cleanup)',
        ),
    ];
}

export const scenario: Scenario = {
    id: 'fs-jetton-remove-excluded-stale',
    title: 'RemoveExcluded stale fee-bypass (F11)',
    description:
        'Lab: AddExcluded+Sync → 100% → RemoveExcluded without Sync → next transfer takes 1% fees (live resolve). Shared tip → N/A.',
    tags: ['jetton', 'admin', 'lab'],
    needsLiveTx: true,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
