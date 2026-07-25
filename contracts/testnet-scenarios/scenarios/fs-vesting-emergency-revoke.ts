/**
 * fs-vesting-emergency-revoke — VestEmergencyRevoke via Timelock (authorized path).
 * DESTRUCTIVE. Excluded from --all. Shared tip always N/A; N/A if no vesting / nothing to revoke.
 * Requires lab Timelock tip with VestEmergencyRevoke relay (IMP-TNFS-F03).
 */
import { toNano } from '@ton/core';
import {
    checkEmergencyRevoke,
    loadAllVaultStates,
    naWhenEmergencyRevoke,
    pollReleasedAtLeast,
    readJettonWalletBalance,
    sendEmergencyRevokeViaTimelock,
    sleepMs,
    VESTING_REVOKE_EXECUTE_TON,
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
        'Excluded from --all. Shared tip N/A; needs F03 Timelock relay tip on lab for live pass.',
    tags: ['vesting', 'admin', 'destructive'],
    needsLiveTx: true,
    destructive: true,
    // 3.8 TON execute attach + queue leg / fees margin. Live 2026-07-23: a
    // ~2.1 TON governor wallet SILENTLY SKIPPED the 3.8 attach (V5R1) — the
    // runner now preflights this budget (IMP-TNFS-F10).
    budget: { signer: 'deploy', minTon: VESTING_REVOKE_EXECUTE_TON + toNano('0.5') },
    depends_on: ['fs-vesting-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
