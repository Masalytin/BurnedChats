/**
 * fs-gov-smoke — readonly governor + timelock + staking + treasury wiring vs manifest.
 */
import { Address } from '@ton/core';
import { checkGovSmoke, openGovernor } from '../lib/gov';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const governor = openGovernor(ctx);
    const manifestGovernor = Address.parse(ctx.manifest.addresses.governor);
    const manifestTimelock = Address.parse(ctx.manifest.addresses.timelock);
    const manifestStaking = Address.parse(ctx.manifest.addresses.stakingMaster);
    const manifestTreasury = Address.parse(ctx.manifest.addresses.treasury);

    const onChainTimelock = await governor.getGetTimelockAddr();
    const onChainStaking = await governor.getGetStakingMaster();
    const onChainTreasury = await governor.getGetTreasury();
    const timelockDelaySec = await governor.getGetTimelockDelay();
    const codeHash = ctx.manifest.codeHashes?.governor;

    const labDelayRaw = ctx.manifest.lab?.timelockDelaySec;
    const labTimelockDelaySec =
        ctx.manifestKind === 'lab' && typeof labDelayRaw === 'number' ? labDelayRaw : undefined;

    return checkGovSmoke({
        manifestGovernor,
        onChainTimelock,
        manifestTimelock,
        onChainStaking,
        manifestStaking,
        onChainTreasury,
        manifestTreasury,
        timelockDelaySec,
        labTimelockDelaySec,
        codeHash,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-smoke',
    title: 'Governance smoke',
    description:
        'Readonly: governor address; linked timelock + staking + treasury match manifest; delay readable.',
    tags: ['governance', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-ops-deployment-fingerprint'],
    run: runChecks,
};

export default scenario;
