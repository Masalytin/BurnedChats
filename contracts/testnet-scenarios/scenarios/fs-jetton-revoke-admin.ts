/**
 * fs-jetton-revoke-admin — ChangeOwner → revoked sentinel; post-revoke admin ops fail.
 * DESTRUCTIVE. Lab only; depends_on close-mint (lab order: close → revoke).
 */
import { check } from '../lib/checks';
import {
    buildChangeOwnerBody,
    buildCloseMintBody,
    checkAdminIs,
    naWhenRevokeAdmin,
    OP_CHANGE_OWNER,
    OP_CLOSE_MINT,
    pollUntil,
    readJettonAdminState,
    resolveAdminActor,
    REVOKED_ADMIN_ADDRESS,
    sendJettonAdminBody,
} from '../lib/jetton-admin';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export const naWhen = naWhenRevokeAdmin;

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const before = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, before);
    if (!actor) {
        throw new Error('admin actor unresolved after naWhen passed');
    }

    // Soft hint — hard order is depends_on: fs-jetton-close-mint (documented for lab pack).
    const checks: CheckResult[] = [
        check(
            'lab-order-close-before-revoke',
            true,
            before.mintable
                ? 'note: mintable still true — preferred lab order is close-mint then revoke-admin'
                : 'mintable=false (close-mint already applied) — lab order OK',
        ),
    ];

    await sendJettonAdminBody(ctx, {
        state: before,
        actor,
        method: OP_CHANGE_OWNER,
        body: buildChangeOwnerBody(REVOKED_ADMIN_ADDRESS),
        label: 'fs-jetton-revoke-admin',
    });

    const revoked = await pollUntil(ctx, (s) => s.admin.equals(REVOKED_ADMIN_ADDRESS));
    checks.push(checkAdminIs(REVOKED_ADMIN_ADDRESS, revoked.admin));

    // Post-revoke: former admin path (direct or Timelock) cannot mutate mintable/admin.
    const mintableBefore = revoked.mintable;
    await sendJettonAdminBody(ctx, {
        state: revoked,
        actor,
        method: OP_CLOSE_MINT,
        body: buildCloseMintBody(),
        label: 'fs-jetton-revoke-admin/post-revoke-close',
    });

    const after = await pollUntil(
        ctx,
        (s) => s.admin.equals(REVOKED_ADMIN_ADDRESS) && s.mintable === mintableBefore,
        8,
        1_500,
    );
    checks.push(checkAdminIs(REVOKED_ADMIN_ADDRESS, after.admin));
    checks.push(
        check(
            'post-revoke-admin-ops-ineffective',
            after.admin.equals(REVOKED_ADMIN_ADDRESS) && after.mintable === mintableBefore,
            `admin remains revoked; mintable unchanged (${mintableBefore} → ${after.mintable})`,
        ),
    );
    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-revoke-admin',
    title: 'Revoke jetton admin (lab)',
    description:
        'DESTRUCTIVE (lab): ChangeOwner → revoked sentinel; post-revoke admin ops fail. ' +
        'depends_on fs-jetton-close-mint — lab order close-mint → revoke-admin. Shared tip N/A.',
    tags: ['jetton', 'admin', 'destructive'],
    needsLiveTx: true,
    destructive: true,
    depends_on: ['fs-jetton-close-mint'],
    naWhen,
    run: runChecks,
};

export default scenario;
