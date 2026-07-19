/**
 * fs-vesting-emergency-revoke — VestEmergencyRevoke via Timelock (authorized path).
 * DESTRUCTIVE. Excluded from --all. Shared tip always N/A; N/A if revoke path disabled / no vesting.
 */
import {
    checkEmergencyRevoke,
    loadAllVaultStates,
    naWhenEmergencyRevoke,
    pollReleasedAtLeast,
    readJettonWalletBalance,
    sendEmergencyRevokeViaTimelock,
    sleepMs,
} from '../lib/vesting';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenEmergencyRevoke(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const states = await loadAllVaultStates(ctx);
    const vault = states.find((s) => s.schedule.totalAmount - s.schedule.releasedAmount > 0n);
    if (!vault) {
        throw new Error('no revocable vault after naWhen');
    }

    const { schedule } = vault;
    const releasedBefore = schedule.releasedAmount;
    const vaultWalletBefore = await readJettonWalletBalance(
        provider,
        schedule.jettonMaster,
        vault.address,
    );
    const treasuryWalletBefore = await readJettonWalletBalance(
        provider,
        schedule.jettonMaster,
        schedule.treasury,
    );

    await sendEmergencyRevokeViaTimelock(ctx, {
        vault: vault.address,
        timelock: schedule.timelock,
        label: 'fs-vesting-emergency-revoke',
    });
    await sleepMs(5_000);

    const releasedAfter = await pollReleasedAtLeast(provider, vault.address, schedule.totalAmount);
    const vaultWalletAfter = await readJettonWalletBalance(
        provider,
        schedule.jettonMaster,
        vault.address,
    );
    const treasuryWalletAfter = await readJettonWalletBalance(
        provider,
        schedule.jettonMaster,
        schedule.treasury,
    );

    return checkEmergencyRevoke({
        totalAmount: schedule.totalAmount,
        releasedBefore,
        releasedAfter,
        vaultWalletBefore,
        vaultWalletAfter,
        treasuryWalletBefore,
        treasuryWalletAfter,
    });
}

export const scenario: Scenario = {
    id: 'fs-vesting-emergency-revoke',
    title: 'Vesting emergency revoke (lab)',
    description:
        'DESTRUCTIVE (lab): VestEmergencyRevoke via Timelock authorized path; remaining locked moved to treasury. ' +
        'Excluded from --all. Shared tip N/A; N/A if revoke path disabled / no vesting.',
    tags: ['vesting', 'admin', 'destructive'],
    needsLiveTx: true,
    destructive: true,
    depends_on: ['fs-vesting-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
