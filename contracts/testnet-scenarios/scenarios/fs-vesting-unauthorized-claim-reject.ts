/**
 * fs-vesting-unauthorized-claim-reject — non-beneficiary VestRelease rejected.
 */
import {
    checkUnauthorizedClaimRejected,
    loadAllVaultStates,
    naWhenUnauthorizedClaim,
    sendVestRelease,
    sleepMs,
} from '../lib/vesting';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenUnauthorizedClaim(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const sender = ctx.provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const states = await loadAllVaultStates(ctx);
    const vault = states.find((s) => !s.schedule.beneficiary.equals(sender));
    if (!vault) {
        throw new Error('no non-beneficiary vault after naWhen');
    }

    const releasedBefore = vault.schedule.releasedAmount;
    await sendVestRelease(ctx, vault.address);
    await sleepMs(5_000);

    const after = await loadAllVaultStates(ctx);
    const updated = after.find((s) => s.address.equals(vault.address));
    if (!updated) {
        throw new Error('vault disappeared after unauthorized VestRelease probe');
    }

    return checkUnauthorizedClaimRejected({
        releasedBefore,
        releasedAfter: updated.schedule.releasedAmount,
        senderIsBeneficiary: sender.equals(vault.schedule.beneficiary),
    });
}

export const scenario: Scenario = {
    id: 'fs-vesting-unauthorized-claim-reject',
    title: 'Unauthorized VestRelease rejected',
    description: 'Non-beneficiary VestRelease rejected; released_amount unchanged.',
    tags: ['vesting'],
    needsLiveTx: true,
    depends_on: ['fs-vesting-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
