/**
 * fs-gov-role-checks — readonly: unknown sender cannot drive privileged gov paths.
 * Asserts on-chain role wiring (jetton admin = timelock, staking governor = governor).
 *
 * Used-lab-tip semantics (IMP-TNFS-F14): the lab tip's jetton admin was
 * irreversibly revoked to the zero address by the destructive
 * `fs-jetton-revoke-admin` run (2026-07-23). On the lab manifest a revoked
 * admin turns `jetton-admin-is-timelock` into a soft check-level N/A
 * (`lab-tip-admin-revoked`) instead of a FAIL — same `ok:true + "N/A: …"`
 * pattern as `tonapi-index-lag` (IMP-TNFS-F05). Shared manifest stays strict.
 */
import { Address } from '@ton/core';
import { check } from '../lib/checks';
import { checkGovRoleWiring, openGovernor } from '../lib/gov';
import { readJettonAdminState } from '../lib/jetton-admin';
import { openStakingMaster } from '../lib/staking';
import type { CheckResult, ManifestKind, Scenario, ScenarioContext } from '../types';

/** Exact N/A reason string — catalogued in RUNBOOK.md «N/A reasons catalog». */
export const NA_LAB_TIP_ADMIN_REVOKED = 'lab-tip-admin-revoked';

/** addr_std workchain 0, 256 zero bits — RevokeAdmin target (irreversible). */
export const ZERO_ADDRESS = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');

export function isJettonAdminRevoked(admin: Address): boolean {
    return admin.equals(ZERO_ADDRESS);
}

/**
 * Soften a failing `jetton-admin-is-timelock` check into an explicit soft N/A
 * when the LAB tip's admin is revoked to the zero address. Expected used-tip
 * state, not a defect (live report 2026-07-25). Shared manifest is returned
 * unchanged — a zero admin there would be a real defect and must stay FAIL.
 */
export function applyAdminRevokedNa(
    checks: CheckResult[],
    jettonAdmin: Address,
    manifestKind: ManifestKind,
): CheckResult[] {
    if (manifestKind !== 'lab' || !isJettonAdminRevoked(jettonAdmin)) {
        return checks;
    }
    return checks.map((c) =>
        c.name === 'jetton-admin-is-timelock' && !c.ok
            ? check(
                  c.name,
                  true,
                  `N/A: ${NA_LAB_TIP_ADMIN_REVOKED} — jetton admin irreversibly revoked to ` +
                      'zero address (destructive fs-jetton-revoke-admin, 2026-07-23); ' +
                      'admin-is-timelock assertion not applicable on this used lab tip',
              )
            : c,
    );
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { manifest } = ctx;
    const manifestTimelock = Address.parse(manifest.addresses.timelock);
    const manifestGovernor = Address.parse(manifest.addresses.governor);

    const governor = openGovernor(ctx);
    const onChainTimelock = await governor.getGetTimelockAddr();
    const jetton = await readJettonAdminState(ctx);
    const stakingGovernor = await openStakingMaster(ctx).getGetGovernorAddr();
    const sender = ctx.provider.sender().address ?? null;

    return applyAdminRevokedNa(
        checkGovRoleWiring({
            jettonAdmin: jetton.admin,
            timelock: manifestTimelock,
            stakingGovernor,
            manifestGovernor,
            manifestTimelock,
            onChainTimelock,
            sender,
        }),
        jetton.admin,
        ctx.manifestKind,
    );
}

export const scenario: Scenario = {
    id: 'fs-gov-role-checks',
    title: 'Gov role checks (readonly)',
    description:
        'Readonly: jetton admin is timelock; staking governor is governor; mnemonic ≠ timelock.',
    tags: ['governance', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-gov-smoke'],
    run: runChecks,
};

export default scenario;
