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

    // Dedup by owner address: post-F01 `stakingPool` is both a MINT_ALLOCATIONS
    // receiver (emission reserve) and a fee sink — counting it twice falsely
    // reports silent inflation (live FAIL: 1300B holders vs ~1000B supply).
    const counted = new Set<string>();
    let knownBalancesSum = 0n;
    const ownerKeys = [
        ...MINT_ALLOCATIONS.map((a) => a.receiver),
        'stakingPool',
        'treasury',
    ] as const;
    for (const key of ownerKeys) {
        const raw = manifest.addresses[key];
        if (!raw) {
            continue;
        }
        const owner = Address.parse(raw);
        const id = owner.toRawString();
        if (counted.has(id)) {
            continue;
        }
        counted.add(id);
        knownBalancesSum += await readJettonWalletBalance(provider, jettonMaster, owner);
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
