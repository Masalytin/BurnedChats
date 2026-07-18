/**
 * fs-staking-pause-admin — pause/admin knobs; N/A when absent in ABI/tact.
 */
import { check } from '../lib/checks';
import {
    abiHasPauseKnob,
    loadStakingMasterAbi,
    loadStakingMasterTact,
    naWhenNoPauseKnob,
} from '../lib/staking';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export function naWhen(ctx: ScenarioContext): string | null {
    return naWhenNoPauseKnob(ctx);
}

/**
 * Only reached if a pause knob appears in a future deployment/code.
 * Current full-stack StakingMaster has no pause — naWhen returns N/A reason.
 */
export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const abi = loadStakingMasterAbi(ctx.contractsRoot);
    const tact = loadStakingMasterTact(ctx.contractsRoot);
    const hasKnob = abiHasPauseKnob(abi, tact);
    return [
        check(
            'pause-knob-present',
            hasKnob,
            hasKnob
                ? 'pause/admin receiver present — live gate assert not yet wired'
                : 'no pause knob (should have been N/A)',
        ),
    ];
}

export const scenario: Scenario = {
    id: 'fs-staking-pause-admin',
    title: 'Staking pause/admin knobs',
    description:
        'Pause/admin gates on stake/claim when coded. Current tree: N/A — no pause knob in deployment/ABI.',
    tags: ['staking', 'admin'],
    needsLiveTx: false,
    depends_on: ['fs-staking-master-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
