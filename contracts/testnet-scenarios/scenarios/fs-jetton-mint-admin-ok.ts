/**
 * fs-jetton-mint-admin-ok — admin mint within cap; supply↑.
 * Lab preferred (admin=Timelock → queue delay=0). N/A when !mintable / revoked / no headroom.
 */
import {
    ADMIN_MINT_AMOUNT_NANO,
    buildMintBody,
    checkMintSupplyIncreased,
    mintReceiverFromCtx,
    naWhenMintAdminOk,
    OP_MINT,
    pollUntil,
    readJettonAdminState,
    resolveAdminActor,
    sendJettonAdminBody,
} from '../lib/jetton-admin';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export const naWhen = naWhenMintAdminOk;

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const before = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, before);
    if (!actor) {
        throw new Error('admin actor unresolved after naWhen passed');
    }

    const receiver = mintReceiverFromCtx(ctx);
    const body = buildMintBody(before.jettonMaster, receiver, ADMIN_MINT_AMOUNT_NANO);
    await sendJettonAdminBody(ctx, {
        state: before,
        actor,
        method: OP_MINT,
        body,
        label: 'fs-jetton-mint-admin-ok',
    });

    const after = await pollUntil(
        ctx,
        (s) => s.totalSupply === before.totalSupply + ADMIN_MINT_AMOUNT_NANO,
    );

    return [checkMintSupplyIncreased(before.totalSupply, after.totalSupply, ADMIN_MINT_AMOUNT_NANO)];
}

export const scenario: Scenario = {
    id: 'fs-jetton-mint-admin-ok',
    title: 'Admin mint within cap',
    description:
        'Admin (or Timelock governor on lab) mints a tiny amount under MAX_SUPPLY; assert totalSupply↑. ' +
        'N/A when !mintable, admin revoked, or no headroom. Lab preferred; not tagged destructive.',
    tags: ['jetton', 'admin'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-master-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
