/**
 * fs-jetton-mint-over-cap-reject — admin mint above MAX_SUPPLY rejected; supply unchanged.
 */
import {
    buildMintBody,
    checkSupplyUnchanged,
    mintReceiverFromCtx,
    naWhenMintOverCap,
    OP_MINT,
    OVER_CAP_MINT_AMOUNT_NANO,
    pollUntil,
    readJettonAdminState,
    resolveAdminActor,
    sendJettonAdminBody,
} from '../lib/jetton-admin';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export const naWhen = naWhenMintOverCap;

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const before = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, before);
    if (!actor) {
        throw new Error('admin actor unresolved after naWhen passed');
    }

    const receiver = mintReceiverFromCtx(ctx);
    const body = buildMintBody(before.jettonMaster, receiver, OVER_CAP_MINT_AMOUNT_NANO);
    await sendJettonAdminBody(ctx, {
        state: before,
        actor,
        method: OP_MINT,
        body,
        label: 'fs-jetton-mint-over-cap-reject',
    });

    const after = await pollUntil(ctx, (s) => s.totalSupply === before.totalSupply, 8, 1_500);
    return [checkSupplyUnchanged(before.totalSupply, after.totalSupply, 'over-cap-mint-rejected')];
}

export const scenario: Scenario = {
    id: 'fs-jetton-mint-over-cap-reject',
    title: 'Over-cap mint rejected',
    description:
        'Admin path attempts mint of MAX_SUPPLY+1; assert totalSupply unchanged (Mint cap exceeded). ' +
        'N/A when !mintable or admin revoked.',
    tags: ['jetton', 'admin'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-mint-admin-ok'],
    naWhen,
    run: runChecks,
};

export default scenario;
