/**
 * fs-staking-master-smoke — readonly staking master address / linked jetton+pool.
 */
import { Address } from '@ton/core';
import {
    checkMasterSmoke,
    openStakingMaster,
    requireStakingPoolAddr,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const master = openStakingMaster(ctx);
    const manifestStaking = Address.parse(ctx.manifest.addresses.stakingMaster);
    const manifestJetton = Address.parse(ctx.manifest.addresses.jettonMaster);
    const manifestPool = requireStakingPoolAddr(ctx);

    const onChainJetton = await master.getGetJettonMaster();
    const onChainPool = await master.getGetPool();
    const codeHash = ctx.manifest.codeHashes?.staking;

    return checkMasterSmoke({
        manifestStaking,
        onChainJetton,
        manifestJetton,
        onChainPool,
        manifestPool,
        codeHash,
    });
}

export const scenario: Scenario = {
    id: 'fs-staking-master-smoke',
    title: 'Staking master smoke',
    description:
        'Readonly: staking master address; linked jetton master + pool match shared manifest tip.',
    tags: ['staking', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-ops-deployment-fingerprint'],
    run: runChecks,
};

export default scenario;
