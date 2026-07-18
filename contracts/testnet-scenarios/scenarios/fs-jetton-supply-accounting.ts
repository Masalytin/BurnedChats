/**
 * fs-jetton-supply-accounting — readonly: supply bounds + fee rates; no silent inflation.
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { MINT_ALLOCATIONS } from '../../scripts/deploy/bootstrap';
import { readJettonWalletBalance } from '../lib/balances';
import { checkSupplyAccounting } from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));

    const data = await master.getGetJettonData();
    const fee = await master.getGetFeeParams();

    let knownBalancesSum = 0n;
    for (const alloc of MINT_ALLOCATIONS) {
        const raw = manifest.addresses[alloc.receiver];
        if (!raw) {
            continue;
        }
        const bal = await readJettonWalletBalance(provider, jettonMaster, Address.parse(raw));
        knownBalancesSum += bal;
    }

    // Fee sink wallets also hold jettons from fee legs — include when present.
    for (const key of ['stakingPool', 'treasury'] as const) {
        const raw = manifest.addresses[key];
        if (!raw) {
            continue;
        }
        knownBalancesSum += await readJettonWalletBalance(
            provider,
            jettonMaster,
            Address.parse(raw),
        );
    }

    return checkSupplyAccounting({
        totalSupply: data.totalSupply,
        knownBalancesSum,
        burnRateBps: fee.burnRateBps,
        stakingRateBps: fee.stakingRateBps,
        treasuryRateBps: fee.treasuryRateBps,
    });
}

export const scenario: Scenario = {
    id: 'fs-jetton-supply-accounting',
    title: 'Supply accounting (no silent inflation)',
    description:
        'Readonly: fee rates 0.5/0.3/0.2, totalSupply ≤ max, known holder balances ≤ supply (burns reflected as supply ≤ mint).',
    tags: ['jetton', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-jetton-fee-split'],
    run: runChecks,
};

export default scenario;
