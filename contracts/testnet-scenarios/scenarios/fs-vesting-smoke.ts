/**
 * fs-vesting-smoke — readonly schedule params + linked jetton wallet.
 * N/A when no vesting addresses in manifest.
 */
import { Address } from '@ton/core';
import {
    checkVestingSmoke,
    loadAllVaultStates,
    naWhenSmoke,
} from '../lib/vesting';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenSmoke(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const manifestJetton = Address.parse(ctx.manifest.addresses.jettonMaster);
    const states = await loadAllVaultStates(ctx);
    if (states.length === 0) {
        throw new Error('no vesting vaults after naWhen');
    }

    const checks: CheckResult[] = [];
    for (const state of states) {
        const prefix = state.key;
        const smoke = checkVestingSmoke({
            vault: state.address,
            onChainJetton: state.schedule.jettonMaster,
            manifestJetton,
            vaultJettonWallet: state.vaultJettonWallet,
            schedule: state.schedule,
        });
        for (const c of smoke) {
            checks.push({
                ...c,
                name: `${prefix}:${c.name}`,
                message: `[${prefix}] ${c.message}`,
            });
        }
    }
    return checks;
}

export const scenario: Scenario = {
    id: 'fs-vesting-smoke',
    title: 'Vesting smoke',
    description:
        'Readonly: vesting schedule params readable; linked jetton wallet. N/A if no vesting in manifest.',
    tags: ['vesting', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
