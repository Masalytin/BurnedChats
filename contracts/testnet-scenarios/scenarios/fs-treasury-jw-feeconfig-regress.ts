/**
 * fs-treasury-jw-feeconfig-regress — treasury jetton wallet must have
 * feeConfig.active after F14 deploy-push (IMP-TNFS-F28). Hard FAIL if inactive
 * (21507 class on spend path).
 */
import { Address } from '@ton/core';
import { readFeeConfigActive } from '../lib/balances';
import { checkTreasuryJwFeeConfigActive } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const treasury = Address.parse(ctx.manifest.addresses.treasury);
    const active = await readFeeConfigActive(ctx.provider, jettonMaster, treasury);
    return checkTreasuryJwFeeConfigActive(active);
}

export const scenario: Scenario = {
    id: 'fs-treasury-jw-feeconfig-regress',
    title: 'Treasury JW feeConfig active (F14 regress)',
    description:
        'Readonly: treasury jetton wallet get_fee_config_active must be true after deploy feeConfig push (IMP-MNAUD-F14).',
    tags: ['treasury', 'fee', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-ops-deployment-fingerprint'],
    run: runChecks,
};

export default scenario;
