/**
 * fs-treasury-smoke — readonly treasury address / getters / linked timelock+jetton.
 */
import { Address } from '@ton/core';
import { checkTreasurySmoke, openTreasury } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const treasury = openTreasury(ctx);
    const manifestTreasury = Address.parse(ctx.manifest.addresses.treasury);
    const manifestTimelock = Address.parse(ctx.manifest.addresses.timelock);
    const manifestJetton = Address.parse(ctx.manifest.addresses.jettonMaster);

    const totalReceived = await treasury.getGetTotalReceived();
    const onChainTimelock = await treasury.getGetTimelock();
    const onChainJetton = await treasury.getGetJettonMaster();
    const codeHash = ctx.manifest.codeHashes?.treasury;

    return checkTreasurySmoke({
        manifestTreasury,
        onChainTimelock,
        manifestTimelock,
        onChainJetton,
        manifestJetton,
        totalReceived,
        codeHash,
    });
}

export const scenario: Scenario = {
    id: 'fs-treasury-smoke',
    title: 'Treasury smoke',
    description:
        'Readonly: treasury address; get_total_received readable; linked timelock + jetton match shared manifest tip.',
    tags: ['treasury', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-ops-deployment-fingerprint'],
    run: runChecks,
};

export default scenario;
