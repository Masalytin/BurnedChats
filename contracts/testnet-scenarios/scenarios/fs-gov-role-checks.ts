/**
 * fs-gov-role-checks — readonly: unknown sender cannot drive privileged gov paths.
 * Asserts on-chain role wiring (jetton admin = timelock, staking governor = governor).
 */
import { Address } from '@ton/core';
import { checkGovRoleWiring, openGovernor } from '../lib/gov';
import { readJettonAdminState } from '../lib/jetton-admin';
import { openStakingMaster } from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { manifest } = ctx;
    const manifestTimelock = Address.parse(manifest.addresses.timelock);
    const manifestGovernor = Address.parse(manifest.addresses.governor);

    const governor = openGovernor(ctx);
    const onChainTimelock = await governor.getGetTimelockAddr();
    const jetton = await readJettonAdminState(ctx);
    const stakingGovernor = await openStakingMaster(ctx).getGetGovernorAddr();
    const sender = ctx.provider.sender().address ?? null;

    return checkGovRoleWiring({
        jettonAdmin: jetton.admin,
        timelock: manifestTimelock,
        stakingGovernor,
        manifestGovernor,
        manifestTimelock,
        onChainTimelock,
        sender,
    });
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
