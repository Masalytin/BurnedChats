/**
 * fs-jetton-fee-split-readonly — Q4=A: verify fee-split structure via FEE_SPLIT_TX_HASH (no send).
 */
import { FEE_SPLIT_EXPECTED } from '../lib/balances';
import { check } from '../lib/checks';
import { tonapiHost, tonscanTxUrl, verifyFeeSplitEventStructure } from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(_ctx: ScenarioContext): Promise<string | null> {
    const hash = process.env.FEE_SPLIT_TX_HASH?.trim();
    if (!hash) {
        return 'FEE_SPLIT_TX_HASH not set — provide a prior fee-split event/tx hash for readonly verify';
    }
    return null;
}

export async function runChecks(_ctx: ScenarioContext): Promise<CheckResult[]> {
    const host = tonapiHost('testnet');
    const feeSplitEventId = process.env.FEE_SPLIT_TX_HASH!.trim();
    const checks = await verifyFeeSplitEventStructure(host, feeSplitEventId, FEE_SPLIT_EXPECTED);
    checks.push(
        check(
            'tonscan-url',
            true,
            `fee-split readonly tx: ${tonscanTxUrl('testnet', feeSplitEventId)}`,
        ),
    );
    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-fee-split-readonly',
    title: 'Readonly jetton fee split (FEE_SPLIT_TX_HASH)',
    description:
        'Re-verify full-stack fee legs (0.99 / 0.005 / 0.003 / 0.002) from an existing tonapi event — no live send.',
    tags: ['jetton', 'fee', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
