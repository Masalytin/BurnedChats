/**
 * fs-vesting-claim-linear — after cliff, claim ≤ vested_amount(now); beneficiary wallet ↑.
 */
import {
    checkLinearClaim,
    loadAllVaultStates,
    naWhenLinearClaim,
    nowUnix,
    pollReleasedAtLeast,
    readJettonWalletBalance,
    releasableAmountAt,
    sendVestRelease,
    vestedAmountAt,
    VESTING_RELEASE_TON,
} from '../lib/vesting';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenLinearClaim(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const t = nowUnix();
    const states = await loadAllVaultStates(ctx);
    const vault = states.find((s) => {
        if (!s.schedule.beneficiary.equals(sender)) {
            return false;
        }
        return (
            releasableAmountAt({
                totalAmount: s.schedule.totalAmount,
                startTime: s.schedule.startTime,
                cliffDuration: s.schedule.cliffDuration,
                vestingDuration: s.schedule.vestingDuration,
                releasedAmount: s.schedule.releasedAmount,
                currentTime: t,
            }) > 0n
        );
    });
    if (!vault) {
        throw new Error('no claimable vault for sender after naWhen');
    }

    const schedule = vault.schedule;
    const releasableBefore = releasableAmountAt({
        totalAmount: schedule.totalAmount,
        startTime: schedule.startTime,
        cliffDuration: schedule.cliffDuration,
        vestingDuration: schedule.vestingDuration,
        releasedAmount: schedule.releasedAmount,
        currentTime: t,
    });
    const vestedNow = vestedAmountAt({
        totalAmount: schedule.totalAmount,
        startTime: schedule.startTime,
        cliffDuration: schedule.cliffDuration,
        vestingDuration: schedule.vestingDuration,
        currentTime: t,
    });

    const walletBefore = await readJettonWalletBalance(
        provider,
        schedule.jettonMaster,
        schedule.beneficiary,
    );

    await sendVestRelease(ctx, vault.address, VESTING_RELEASE_TON);

    const releasedAfter = await pollReleasedAtLeast(
        provider,
        vault.address,
        schedule.releasedAmount + releasableBefore,
    );
    const walletAfter = await readJettonWalletBalance(
        provider,
        schedule.jettonMaster,
        schedule.beneficiary,
    );

    return checkLinearClaim({
        vestedNow,
        releasableBefore,
        releasedBefore: schedule.releasedAmount,
        releasedAfter,
        beneficiaryWalletBefore: walletBefore,
        beneficiaryWalletAfter: walletAfter,
    });
}

export const scenario: Scenario = {
    id: 'fs-vesting-claim-linear',
    title: 'Linear vesting claim',
    description:
        'After cliff, beneficiary VestRelease ≤ vested_amount(now); beneficiary jetton wallet increases. ' +
        'N/A when before cliff / fully claimed / sender ≠ beneficiary.',
    tags: ['vesting'],
    needsLiveTx: true,
    depends_on: ['fs-vesting-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
