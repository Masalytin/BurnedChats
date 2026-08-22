/**
 * fs-gov-set-gas-params — live governance SetGasParams cycle (IMP-TNFS-F33 / IMP-MNAUD-F22).
 *
 * Lab-only: mutates the master's TON gas gates. Full cycle:
 *   1. direct non-Timelock SetGasParams → rejected (get_gas_params unchanged);
 *   2. Timelock queue(delay=0)+execute SetGasParams (gate 1.0 → 1.2) → applied;
 *   3. SyncFeeConfigToWallet(actor) → wallet get_gas_config reflects 1.2;
 *   4. behavioral gate: transfer attach 1.05 (over old default, under new gate)
 *      rejected; attach 1.45 credited — the raise is effective, not just readable;
 *   5. out-of-cap SetGasParams (gate 5.1 > GAS_MIN_TON_FEE_PATH_CEIL 5) via
 *      Timelock → master bounces "Invalid gas params", get_gas_params unchanged;
 *   6. restore W1 defaults + re-sync wallet — lab tip stays usable for the rest
 *      of the suite (attach constants assume gate 1.0).
 *
 * Uses the direct Timelock-executor path (sendJettonAdminBody, delay=0) per the
 * card's note — the proposal→vote→finalize pipeline is already covered by
 * fs-gov-queue-execute-happy; this scenario targets the SetGasParams surface.
 */
import { beginCell, Cell, toNano } from '@ton/core';
import { Address } from '@ton/core';
import { storeSetGasParams } from '../../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { readJettonWalletBalance, TRANSFER_AMOUNT } from '../lib/balances';
import { check } from '../lib/checks';
import { NA_NEEDS_LAB_SHORT_TIMERS } from '../lib/gov';
import {
    buildSyncFeeConfigBody,
    NA_CANNOT_ACT_AS_ADMIN,
    OP_SYNC_FEE_CONFIG,
    readJettonAdminState,
    resolveAdminActor,
    sendJettonAdminBody,
} from '../lib/jetton-admin';
import { requireFeeTestRecipient } from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** message(0x5a1c8f07) SetGasParams — Timelock-gated master handler (F22). */
export const OP_SET_GAS_PARAMS = 0x5a1c8f07n;

export type GasParams = {
    minTonFeePath: bigint;
    perInternalDeployTon: bigint;
    poolForwardMin: bigint;
    treasuryForwardMin: bigint;
    burnNotifyTon: bigint;
    propagateTon: bigint;
};

/** Post-F17 W1 deploy defaults — must match burn-jetton-wallet.tact consts. */
export const W1_DEFAULT_GAS: GasParams = {
    minTonFeePath: toNano('1.0'),
    perInternalDeployTon: toNano('0.55'),
    poolForwardMin: toNano('0.07'),
    treasuryForwardMin: toNano('0.01'),
    burnNotifyTon: toNano('0.06'),
    propagateTon: toNano('0.05'),
};

/** Valid in-cap tuned set: gate raised 1.0 → 1.2, deliver legs unchanged. */
export const TUNED_GAS: GasParams = { ...W1_DEFAULT_GAS, minTonFeePath: toNano('1.2') };

/** Out-of-cap probe: gate above GAS_MIN_TON_FEE_PATH_CEIL (5 TON). */
export const OVER_CEIL_GAS: GasParams = { ...W1_DEFAULT_GAS, minTonFeePath: toNano('5.1') };

/** Attach that clears the default gate (1.0) but not the tuned gate (1.2). */
export const BELOW_TUNED_GATE_ATTACH = toNano('1.05');
/** Attach that clears the tuned gate with forward-fee headroom. */
export const ABOVE_TUNED_GATE_ATTACH = toNano('1.45');

export function buildSetGasParamsBody(p: GasParams, queryId: bigint = 0n): Cell {
    return beginCell()
        .store(
            storeSetGasParams({
                $$type: 'SetGasParams',
                queryId,
                min_ton_fee_path: p.minTonFeePath,
                per_internal_deploy_ton: p.perInternalDeployTon,
                gas_pool_forward_min: p.poolForwardMin,
                gas_treasury_forward_min: p.treasuryForwardMin,
                gas_burn_notify_ton: p.burnNotifyTon,
                gas_propagate_ton: p.propagateTon,
            }),
        )
        .endCell();
}

export function gasEquals(a: GasParams, b: GasParams): boolean {
    return (
        a.minTonFeePath === b.minTonFeePath &&
        a.perInternalDeployTon === b.perInternalDeployTon &&
        a.poolForwardMin === b.poolForwardMin &&
        a.treasuryForwardMin === b.treasuryForwardMin &&
        a.burnNotifyTon === b.burnNotifyTon &&
        a.propagateTon === b.propagateTon
    );
}

export function gasLabel(g: GasParams): string {
    return `${g.minTonFeePath}/${g.perInternalDeployTon}/${g.poolForwardMin}/${g.treasuryForwardMin}/${g.burnNotifyTon}/${g.propagateTon}`;
}

function viewToGasParams(v: {
    minTonFeePath: bigint;
    perInternalDeployTon: bigint;
    poolForwardMin: bigint;
    treasuryForwardMin: bigint;
    burnNotifyTon: bigint;
    propagateTon: bigint;
}): GasParams {
    return {
        minTonFeePath: v.minTonFeePath,
        perInternalDeployTon: v.perInternalDeployTon,
        poolForwardMin: v.poolForwardMin,
        treasuryForwardMin: v.treasuryForwardMin,
        burnNotifyTon: v.burnNotifyTon,
        propagateTon: v.propagateTon,
    };
}

async function readMasterGas(ctx: ScenarioContext): Promise<GasParams> {
    const master = ctx.provider.open(
        BurnJettonMaster.fromAddress(Address.parse(ctx.manifest.addresses.jettonMaster)),
    );
    return viewToGasParams(await master.getGetGasParams());
}

async function readWalletGas(ctx: ScenarioContext, owner: Address): Promise<GasParams> {
    const master = ctx.provider.open(
        BurnJettonMaster.fromAddress(Address.parse(ctx.manifest.addresses.jettonMaster)),
    );
    const jwAddr = await master.getGetWalletAddress(owner);
    const jw = ctx.provider.open(BurnJettonWallet.fromAddress(jwAddr));
    return viewToGasParams(await jw.getGetGasConfig());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollUntilGas(
    read: () => Promise<GasParams>,
    expected: GasParams,
    attempts = 15,
    sleepMs = 4_000,
): Promise<GasParams> {
    let last = await read();
    for (let i = 0; i < attempts && !gasEquals(last, expected); i += 1) {
        await sleep(sleepMs);
        last = await read();
    }
    return last;
}

async function pollJettonBalance(
    ctx: ScenarioContext,
    owner: Address,
    predicate: (bal: bigint) => boolean,
    attempts = 12,
    sleepMs = 5_000,
): Promise<bigint> {
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    let last = await readJettonWalletBalance(ctx.provider, jettonMaster, owner);
    for (let i = 0; i < attempts && !predicate(last); i += 1) {
        await sleep(sleepMs);
        last = await readJettonWalletBalance(ctx.provider, jettonMaster, owner);
    }
    return last;
}

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    // Mutating master gas gates on the shared tip would break the Mini App canon.
    if (ctx.manifestKind === 'shared') {
        return NA_NEEDS_LAB_SHORT_TIMERS;
    }
    const state = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, state);
    if (!actor) {
        return NA_CANNOT_ACT_AS_ADMIN;
    }
    return null;
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const checks: CheckResult[] = [];
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const actorAddr = provider.sender().address;
    if (!actorAddr) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const state = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, state);
    if (!actor || actor.mode !== 'timelock') {
        throw new Error(
            'SetGasParams requires the Timelock relay path (admin==Timelock, reachable governor).',
        );
    }

    const gasBefore = await readMasterGas(ctx);
    console.log(`[fs-gov-set-gas-params] gas before: ${gasLabel(gasBefore)}`);

    // 1. Direct negative — Blueprint actor is not the Timelock contract.
    const seqnoDirect = await getSenderSeqno(provider);
    await provider.provider(jettonMaster).internal(provider.sender(), {
        value: toNano('0.05'),
        bounce: true,
        body: buildSetGasParamsBody(TUNED_GAS),
    });
    await waitForSenderSeqnoIncrement(provider, seqnoDirect);
    await sleep(10_000);
    const gasAfterDirect = await readMasterGas(ctx);
    checks.push(
        check(
            'direct-non-timelock-rejected',
            gasEquals(gasAfterDirect, gasBefore),
            `get_gas_params unchanged after direct non-Timelock SetGasParams (${gasLabel(gasAfterDirect)})`,
        ),
    );

    // 2. Happy path — Timelock queue(delay=0) + execute, gate 1.0 → 1.2.
    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_SET_GAS_PARAMS,
        body: buildSetGasParamsBody(TUNED_GAS),
        label: 'fs-gov-set-gas-params:set-tuned',
    });
    const gasTuned = await pollUntilGas(() => readMasterGas(ctx), TUNED_GAS);
    checks.push(
        check(
            'setgas-applied-via-timelock',
            gasEquals(gasTuned, TUNED_GAS),
            `get_gas_params after Timelock SetGasParams: ${gasLabel(gasTuned)} (expected gate ${TUNED_GAS.minTonFeePath})`,
        ),
    );

    // 3. Propagation — push the new snapshot to the actor's jetton wallet.
    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_SYNC_FEE_CONFIG,
        body: buildSyncFeeConfigBody(actorAddr),
        label: 'fs-gov-set-gas-params:sync-actor',
    });
    const walletTuned = await pollUntilGas(() => readWalletGas(ctx, actorAddr), TUNED_GAS);
    checks.push(
        check(
            'wallet-snapshot-updated',
            gasEquals(walletTuned, TUNED_GAS),
            `actor wallet get_gas_config: ${gasLabel(walletTuned)} (expected gate ${TUNED_GAS.minTonFeePath})`,
        ),
    );

    // 4a. Behavioral gate — attach above the old default but under the new gate.
    const recipient = requireFeeTestRecipient();
    const senderBalBefore = await readJettonWalletBalance(provider, jettonMaster, actorAddr);
    const recipientBalBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
    const actorJwAddr = await master.getGetWalletAddress(actorAddr);
    const actorJw = provider.open(BurnJettonWallet.fromAddress(actorJwAddr));

    console.log(
        `[fs-gov-set-gas-params] below-gate probe attach=${BELOW_TUNED_GATE_ATTACH} (old gate 1.0 would admit it)…`,
    );
    const seqnoBelow = await getSenderSeqno(provider);
    await actorJw.sendTransfer(provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: actorAddr,
        value: BELOW_TUNED_GATE_ATTACH,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBelow);
    await sleep(20_000);
    const senderBalAfterBelow = await readJettonWalletBalance(provider, jettonMaster, actorAddr);
    const recipientBalAfterBelow = await readJettonWalletBalance(provider, jettonMaster, recipient);
    checks.push(
        check(
            'below-new-gate-rejected',
            senderBalAfterBelow === senderBalBefore && recipientBalAfterBelow === recipientBalBefore,
            `attach ${BELOW_TUNED_GATE_ATTACH} rejected under tuned gate: sender ${senderBalBefore} → ${senderBalAfterBelow}, recipient ${recipientBalBefore} → ${recipientBalAfterBelow}`,
        ),
    );

    // 4b. Behavioral gate — attach above the new gate must credit (fee split net 0.99).
    console.log(
        `[fs-gov-set-gas-params] above-gate probe attach=${ABOVE_TUNED_GATE_ATTACH}…`,
    );
    const seqnoAbove = await getSenderSeqno(provider);
    await actorJw.sendTransfer(provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: actorAddr,
        value: ABOVE_TUNED_GATE_ATTACH,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoAbove);
    const expectedNet = (TRANSFER_AMOUNT * 99n) / 100n;
    const recipientBalAfterAbove = await pollJettonBalance(
        ctx,
        recipient,
        (bal) => bal >= recipientBalAfterBelow + expectedNet,
    );
    checks.push(
        check(
            'above-new-gate-accepted',
            recipientBalAfterAbove >= recipientBalAfterBelow + expectedNet,
            `attach ${ABOVE_TUNED_GATE_ATTACH} credited under tuned gate: recipient ${recipientBalAfterBelow} → ${recipientBalAfterAbove} (expected +${expectedNet})`,
        ),
    );

    // 5. Out-of-cap negative — gate 5.1 > GAS_MIN_TON_FEE_PATH_CEIL (5 TON):
    //    Timelock relays, master bounces "Invalid gas params", state unchanged.
    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_SET_GAS_PARAMS,
        body: buildSetGasParamsBody(OVER_CEIL_GAS),
        label: 'fs-gov-set-gas-params:over-ceil',
    });
    await sleep(15_000);
    const gasAfterOverCeil = await readMasterGas(ctx);
    checks.push(
        check(
            'out-of-cap-rejected',
            gasEquals(gasAfterOverCeil, TUNED_GAS),
            `get_gas_params unchanged after over-ceil probe (${gasLabel(gasAfterOverCeil)})`,
        ),
    );

    // 6. Restore W1 defaults — the rest of the suite assumes gate 1.0.
    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_SET_GAS_PARAMS,
        body: buildSetGasParamsBody(W1_DEFAULT_GAS),
        label: 'fs-gov-set-gas-params:restore-defaults',
    });
    const gasRestored = await pollUntilGas(() => readMasterGas(ctx), W1_DEFAULT_GAS);
    checks.push(
        check(
            'defaults-restored',
            gasEquals(gasRestored, W1_DEFAULT_GAS),
            `get_gas_params restored to W1 defaults: ${gasLabel(gasRestored)}`,
        ),
    );

    await sendJettonAdminBody(ctx, {
        state,
        actor,
        method: OP_SYNC_FEE_CONFIG,
        body: buildSyncFeeConfigBody(actorAddr),
        label: 'fs-gov-set-gas-params:resync-actor',
    });
    const walletRestored = await pollUntilGas(() => readWalletGas(ctx, actorAddr), W1_DEFAULT_GAS);
    checks.push(
        check(
            'wallet-snapshot-restored',
            gasEquals(walletRestored, W1_DEFAULT_GAS),
            `actor wallet get_gas_config restored: ${gasLabel(walletRestored)}`,
        ),
    );

    return checks;
}

export const scenario: Scenario = {
    id: 'fs-gov-set-gas-params',
    title: 'Gov SetGasParams live cycle',
    description:
        'Timelock SetGasParams (gate 1.0→1.2): direct non-Timelock reject, apply, wallet propagation, behavioral gate probes, out-of-cap reject, defaults restore (IMP-TNFS-F33 / IMP-MNAUD-F22).',
    tags: ['governance', 'gas'],
    needsLiveTx: true,
    // Attach budget: direct probe 0.02 + below-gate 1.05 (bounced/refunded) +
    // above-gate 1.45 + margin; Timelock orders are funded by the governor
    // multisig, not Actor A (IMP-TNFS-F16).
    budget: { signer: 'actor', minTon: toNano('3') },
    naWhen,
    run: runChecks,
};

export default scenario;
