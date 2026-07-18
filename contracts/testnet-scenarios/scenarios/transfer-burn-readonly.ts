import { assertCheck } from '../lib/checks';
import { verifyBurnEvent } from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/**
 * Readonly burn structure check — never sends a transaction.
 * Requires `BURN_TX_HASH` (tonapi event id / tx hash used by former verify-burn readonly path).
 */
async function run(_ctx: ScenarioContext): Promise<CheckResult[]> {
    const burnEventId = process.env.BURN_TX_HASH?.trim();
    if (!burnEventId) {
        return [
            assertCheck(
                false,
                'transfer-burn-readonly requires BURN_TX_HASH (tonapi event id of an existing transfer)',
            ),
        ];
    }
    return verifyBurnEvent(burnEventId);
}

const scenario: Scenario = {
    id: 'transfer-burn-readonly',
    title: 'Readonly burn event structure',
    description:
        'Verifies burn-only legs for an existing transfer via BURN_TX_HASH / tonapi — no send (former verify-burn readonly path).',
    tags: ['readonly', 'burn'],
    needsLiveTx: false,
    run,
};

export default scenario;
