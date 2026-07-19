/**
 * fs-vesting-claim-before-cliff-reject — VestRelease before cliff → 0 / reject.
 */
import {
    checkBeforeCliffRejected,
    loadAllVaultStates,
    naWhenBeforeCliff,
    nowUnix,
    releasableAmountAt,
    sendVestRelease,
    sleepMs,
} from '../lib/vesting';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenBeforeCliff(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const t = nowUnix();
    const states = await loadAllVaultStates(ctx);
    const vault = states.find((s) => t < s.schedule.startTime + s.schedule.cliffDuration);
    if (!vault) {
        throw new Error('no before-cliff vault after naWhen');
    }

    const releasableNow = releasableAmountAt({
        totalAmount: vault.schedule.totalAmount,
        startTime: vault.schedule.startTime,
        cliffDuration: vault.schedule.cliffDuration,
        vestingDuration: vault.schedule.vestingDuration,
        releasedAmount: vault.schedule.releasedAmount,
        currentTime: t,
    });
    const releasedBefore = vault.schedule.releasedAmount;

    await sendVestRelease(ctx, vault.address);
    await sleepMs(5_000);

    const after = await loadAllVaultStates(ctx);
    const updated = after.find((s) => s.address.equals(vault.address));
    if (!updated) {
        throw new Error('vault disappeared after VestRelease probe');
    }

    return checkBeforeCliffRejected({
        releasableNow,
        releasedBefore,
        releasedAfter: updated.schedule.releasedAmount,
        beforeCliff: t < vault.schedule.startTime + vault.schedule.cliffDuration,
    });
}

export const scenario: Scenario = {
    id: 'fs-vesting-claim-before-cliff-reject',
    title: 'VestRelease before cliff rejected',
    description:
        'VestRelease before cliff → releasable 0 / reject; released_amount unchanged. Prefers reserve (36mo cliff).',
    tags: ['vesting'],
    needsLiveTx: true,
    depends_on: ['fs-vesting-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
