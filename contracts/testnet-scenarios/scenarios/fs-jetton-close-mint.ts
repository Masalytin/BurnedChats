/**
 * fs-jetton-close-mint — CloseMint → mintable=false; post-close mint fails (irreversible).
 * DESTRUCTIVE. Lab only in practice; shared tip always N/A.
 *
 * Lab order: close-mint → revoke-admin (see fs-jetton-revoke-admin depends_on).
 */
import {
    ADMIN_MINT_AMOUNT_NANO,
    buildCloseMintBody,
    buildMintBody,
    checkMintable,
    checkSupplyUnchanged,
    mintReceiverFromCtx,
    naWhenCloseMint,
    OP_CLOSE_MINT,
    OP_MINT,
    pollUntil,
    readJettonAdminState,
    resolveAdminActor,
    sendJettonAdminBody,
} from '../lib/jetton-admin';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export const naWhen = naWhenCloseMint;

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const before = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, before);
    if (!actor) {
        throw new Error('admin actor unresolved after naWhen passed');
    }

    await sendJettonAdminBody(ctx, {
        state: before,
        actor,
        method: OP_CLOSE_MINT,
        body: buildCloseMintBody(),
        label: 'fs-jetton-close-mint',
    });

    const closed = await pollUntil(ctx, (s) => s.mintable === false);
    const checks = [checkMintable(false, closed.mintable)];

    // Post-close mint must fail even with headroom (irreversible).
    const supplyBeforeMint = closed.totalSupply;
    const receiver = mintReceiverFromCtx(ctx);
    const mintBody = buildMintBody(closed.jettonMaster, receiver, ADMIN_MINT_AMOUNT_NANO);
    await sendJettonAdminBody(ctx, {
        state: closed,
        actor,
        method: OP_MINT,
        body: mintBody,
        label: 'fs-jetton-close-mint/post-close-mint',
    });

    const afterMint = await pollUntil(ctx, (s) => s.totalSupply === supplyBeforeMint, 8, 1_500);
    checks.push(checkMintable(false, afterMint.mintable));
    checks.push(
        checkSupplyUnchanged(supplyBeforeMint, afterMint.totalSupply, 'post-close-mint-rejected'),
    );
    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-close-mint',
    title: 'CloseMint irreversible (lab)',
    description:
        'DESTRUCTIVE (lab): CloseMint → mintable=false; subsequent mint fails. ' +
        'Never runs on shared tip (naWhen). Lab order: close-mint then revoke-admin.',
    tags: ['jetton', 'admin', 'destructive'],
    needsLiveTx: true,
    destructive: true,
    depends_on: ['fs-jetton-mint-admin-ok'],
    naWhen,
    run: runChecks,
};

export default scenario;
