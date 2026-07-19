import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { Address } from '@ton/core';
import {
    DESTRUCTIVE_VESTING_IDS,
    NA_NO_VESTING,
    NA_REVOKE_DISABLED,
    NA_REVOKE_NEEDS_REDEPLOY,
    NA_SHARED_DESTRUCTIVE,
    TIMELOCK_TARGET_GAS,
    VESTING_RELEASE_TON,
    VESTING_REVOKE_EXECUTE_TON,
    VESTING_SCENARIO_IDS,
    checkBeforeCliffRejected,
    checkLinearClaim,
    checkUnauthorizedClaimRejected,
    checkVestingSmoke,
    isRevokePathDisabled,
    naWhenNoVesting,
    naWhenSharedDestructive,
    releasableAmountAt,
    vestedAmountAt,
} from '../lib/vesting';
import { defaultScenariosDir, discoverScenarios, isDestructive } from '../registry';
import { selectScenarios } from '../runner';
import { emptyState } from '../state';
import type { ScenarioContext } from '../types';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const EXPECTED_TAGS: Record<(typeof VESTING_SCENARIO_IDS)[number], string[]> = {
    'fs-vesting-smoke': ['vesting', 'readonly'],
    'fs-vesting-claim-before-cliff-reject': ['vesting'],
    'fs-vesting-claim-linear': ['vesting'],
    'fs-vesting-unauthorized-claim-reject': ['vesting'],
    'fs-vesting-emergency-revoke': ['vesting', 'admin', 'destructive'],
};

const LIVE_TX: Record<(typeof VESTING_SCENARIO_IDS)[number], boolean> = {
    'fs-vesting-smoke': false,
    'fs-vesting-claim-before-cliff-reject': true,
    'fs-vesting-claim-linear': true,
    'fs-vesting-unauthorized-claim-reject': true,
    'fs-vesting-emergency-revoke': true,
};

const DESTRUCTIVE_FLAG: Record<(typeof VESTING_SCENARIO_IDS)[number], boolean> = {
    'fs-vesting-smoke': false,
    'fs-vesting-claim-before-cliff-reject': false,
    'fs-vesting-claim-linear': false,
    'fs-vesting-unauthorized-claim-reject': false,
    'fs-vesting-emergency-revoke': true,
};

const DEPENDS: Record<(typeof VESTING_SCENARIO_IDS)[number], string[]> = {
    'fs-vesting-smoke': ['fs-ops-deployment-fingerprint'],
    'fs-vesting-claim-before-cliff-reject': ['fs-vesting-smoke'],
    'fs-vesting-claim-linear': ['fs-vesting-smoke'],
    'fs-vesting-unauthorized-claim-reject': ['fs-vesting-smoke'],
    'fs-vesting-emergency-revoke': ['fs-vesting-smoke'],
};

describe('IMP-TNFS-10 vesting pack — discovery & tags', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers all 5 §E vesting scenario ids', () => {
        for (const id of VESTING_SCENARIO_IDS) {
            expect(byId.get(id)).toBeDefined();
        }
    });

    it('tags / destructive / needsLiveTx match DESIGN', () => {
        for (const id of VESTING_SCENARIO_IDS) {
            const s = byId.get(id)!;
            expect(s.tags).toEqual(expect.arrayContaining(EXPECTED_TAGS[id]));
            expect(s.tags).toContain('vesting');
            expect(s.needsLiveTx).toBe(LIVE_TX[id]);
            expect(!!s.destructive).toBe(DESTRUCTIVE_FLAG[id]);
            expect(isDestructive(s)).toBe(DESTRUCTIVE_FLAG[id]);
        }
        expect(byId.get('fs-vesting-emergency-revoke')!.tags).toContain('destructive');
        expect(byId.get('fs-vesting-emergency-revoke')!.tags).toContain('admin');
    });

    it('depends_on matches DESIGN soft graph', () => {
        for (const id of VESTING_SCENARIO_IDS) {
            expect(byId.get(id)!.depends_on).toEqual(DEPENDS[id]);
        }
    });

    it('--all never selects destructive emergency-revoke', () => {
        const state = emptyState('fp');
        const byAll = selectScenarios(scenarios, { mode: 'all' }, state).map((s) => s.id);
        for (const id of DESTRUCTIVE_VESTING_IDS) {
            expect(byAll).not.toContain(id);
        }
        expect(byAll).toContain('fs-vesting-smoke');
        expect(byAll).toContain('fs-vesting-claim-before-cliff-reject');
        expect(byAll).toContain('fs-vesting-claim-linear');
        expect(byAll).toContain('fs-vesting-unauthorized-claim-reject');
    });

    it('--tag vesting selects all five; --tag destructive selects emergency-revoke', () => {
        const state = emptyState('fp');
        const byVesting = selectScenarios(scenarios, { mode: 'tag', tag: 'vesting' }, state).map(
            (s) => s.id,
        );
        for (const id of VESTING_SCENARIO_IDS) {
            expect(byVesting).toContain(id);
        }
        const byDestructive = selectScenarios(
            scenarios,
            { mode: 'tag', tag: 'destructive' },
            state,
        ).map((s) => s.id);
        expect(byDestructive).toEqual(expect.arrayContaining([...DESTRUCTIVE_VESTING_IDS]));
        expect(byDestructive).not.toContain('fs-vesting-smoke');
    });

    it('naWhen wired for smoke / claims / emergency-revoke', () => {
        expect(typeof byId.get('fs-vesting-smoke')!.naWhen).toBe('function');
        expect(typeof byId.get('fs-vesting-claim-before-cliff-reject')!.naWhen).toBe('function');
        expect(typeof byId.get('fs-vesting-claim-linear')!.naWhen).toBe('function');
        expect(typeof byId.get('fs-vesting-unauthorized-claim-reject')!.naWhen).toBe('function');
        expect(typeof byId.get('fs-vesting-emergency-revoke')!.naWhen).toBe('function');
    });

    it('does not register TOKSIM / TNSCEN / pure-1%-burn ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids).not.toContain('transfer-burn-1pct');
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
        expect(ids.some((id) => id.includes('tnscen') || id.includes('tnscien'))).toBe(false);
    });
});

describe('IMP-TNFS-10 vesting helpers — vested_amount / N/A policy', () => {
    it('vestedAmountAt: 0 before cliff, linear after, full at end', () => {
        const base = {
            totalAmount: 800n,
            startTime: 1_000n,
            cliffDuration: 100n,
            vestingDuration: 500n,
        };
        expect(vestedAmountAt({ ...base, currentTime: 1_099n })).toBe(0n);
        expect(vestedAmountAt({ ...base, currentTime: 1_100n })).toBe(0n);
        // elapsed after cliff = 200; linear window = 400 → 800 * 200 / 400 = 400
        expect(vestedAmountAt({ ...base, currentTime: 1_300n })).toBe(400n);
        expect(vestedAmountAt({ ...base, currentTime: 1_500n })).toBe(800n);
        expect(vestedAmountAt({ ...base, currentTime: 9_999n })).toBe(800n);
    });

    it('vestedAmountAt: cliff-only schedule (cliff == vesting)', () => {
        const base = {
            totalAmount: 43n,
            startTime: 10n,
            cliffDuration: 500n,
            vestingDuration: 500n,
        };
        expect(vestedAmountAt({ ...base, currentTime: 509n })).toBe(0n);
        expect(vestedAmountAt({ ...base, currentTime: 510n })).toBe(43n);
    });

    it('releasableAmountAt subtracts released and floors at 0', () => {
        expect(
            releasableAmountAt({
                totalAmount: 100n,
                startTime: 0n,
                cliffDuration: 0n,
                vestingDuration: 100n,
                releasedAmount: 30n,
                currentTime: 50n,
            }),
        ).toBe(20n); // vested 50 - released 30
        expect(
            releasableAmountAt({
                totalAmount: 100n,
                startTime: 0n,
                cliffDuration: 0n,
                vestingDuration: 100n,
                releasedAmount: 80n,
                currentTime: 50n,
            }),
        ).toBe(0n);
    });

    it('shared destructive always N/A; lab allows', () => {
        const sharedCtx = { manifestKind: 'shared' } as ScenarioContext;
        expect(naWhenSharedDestructive(sharedCtx)).toBe(NA_SHARED_DESTRUCTIVE);
        const labCtx = { manifestKind: 'lab' } as ScenarioContext;
        expect(naWhenSharedDestructive(labCtx)).toBeNull();
    });

    it('naWhenNoVesting when manifest has no vesting addresses', () => {
        const emptyCtx = {
            manifest: { addresses: { jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c' } },
        } as unknown as ScenarioContext;
        expect(naWhenNoVesting(emptyCtx)).toBe(NA_NO_VESTING);

        const vd = new Address(0, Buffer.alloc(32, 7)).toString({ urlSafe: true, bounceable: true });
        const withVesting = {
            manifest: {
                addresses: {
                    jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    vestingDeveloper: vd,
                },
            },
        } as unknown as ScenarioContext;
        expect(naWhenNoVesting(withVesting)).toBeNull();
    });

    it('NA reason strings are non-empty (report-friendly)', () => {
        expect(NA_SHARED_DESTRUCTIVE.length).toBeGreaterThan(10);
        expect(NA_NO_VESTING.length).toBeGreaterThan(10);
        expect(NA_REVOKE_DISABLED.length).toBeGreaterThan(10);
        expect(NA_REVOKE_NEEDS_REDEPLOY.length).toBeGreaterThan(10);
    });

    it('IMP-TNFS-F03: revoke path enabled via Timelock relay (not fixed TIMELOCK_TARGET_GAS)', () => {
        // Ordinary execute budget is still below ReleaseTon — product path uses relay.
        expect(TIMELOCK_TARGET_GAS).toBeLessThan(VESTING_RELEASE_TON);
        expect(VESTING_REVOKE_EXECUTE_TON).toBeGreaterThanOrEqual(VESTING_RELEASE_TON);
        expect(isRevokePathDisabled()).toBe(false);
    });

    it('lab tip artifact exists with vesting addresses (destructive pack prerequisite)', () => {
        const labPath = resolve(CONTRACTS_ROOT, 'deployments/testnet-lab.json');
        expect(existsSync(labPath)).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const lab = require(labPath) as {
            role?: string;
            addresses?: Record<string, string>;
        };
        expect(lab.role).toBe('lab');
        expect(lab.addresses?.vestingDeveloper).toBeTruthy();
        expect(lab.addresses?.vestingEcosystem).toBeTruthy();
        expect(lab.addresses?.vestingReserve).toBeTruthy();
        expect(lab.addresses?.vestingStakingAllocation).toBeTruthy();
    });
});

describe('IMP-TNFS-10 check helpers', () => {
    const addr = (n: number) => new Address(0, Buffer.alloc(32, n));

    it('checkVestingSmoke pass/fail', () => {
        const vault = addr(1);
        const jetton = addr(2);
        const jw = addr(3);
        expect(
            checkVestingSmoke({
                vault,
                onChainJetton: jetton,
                manifestJetton: jetton,
                vaultJettonWallet: jw,
                schedule: {
                    totalAmount: 100n,
                    releasedAmount: 0n,
                    startTime: 1n,
                    cliffDuration: 0n,
                    vestingDuration: 10n,
                    beneficiary: addr(4),
                    treasury: addr(5),
                    timelock: addr(6),
                    jettonMaster: jetton,
                },
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkVestingSmoke({
                vault,
                onChainJetton: jetton,
                manifestJetton: addr(9),
                vaultJettonWallet: jw,
                schedule: {
                    totalAmount: 100n,
                    releasedAmount: 0n,
                    startTime: 1n,
                    cliffDuration: 0n,
                    vestingDuration: 10n,
                    beneficiary: addr(4),
                    treasury: addr(5),
                    timelock: addr(6),
                    jettonMaster: jetton,
                },
            }).some((c) => c.name === 'linked-jetton' && !c.ok),
        ).toBe(true);
    });

    it('checkBeforeCliffRejected pass/fail', () => {
        expect(
            checkBeforeCliffRejected({
                releasableNow: 0n,
                releasedBefore: 0n,
                releasedAfter: 0n,
                beforeCliff: true,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkBeforeCliffRejected({
                releasableNow: 10n,
                releasedBefore: 0n,
                releasedAfter: 0n,
                beforeCliff: false,
            }).some((c) => !c.ok),
        ).toBe(true);

        expect(
            checkBeforeCliffRejected({
                releasableNow: 0n,
                releasedBefore: 0n,
                releasedAfter: 5n,
                beforeCliff: true,
            }).some((c) => c.name === 'released-unchanged' && !c.ok),
        ).toBe(true);
    });

    it('checkLinearClaim: claim ≤ vested_amount(now); wallet ↑', () => {
        expect(
            checkLinearClaim({
                vestedNow: 100n,
                releasableBefore: 40n,
                releasedBefore: 60n,
                releasedAfter: 100n,
                beneficiaryWalletBefore: 10n,
                beneficiaryWalletAfter: 50n,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkLinearClaim({
                vestedNow: 100n,
                releasableBefore: 40n,
                releasedBefore: 60n,
                releasedAfter: 101n, // over-vested
                beneficiaryWalletBefore: 10n,
                beneficiaryWalletAfter: 51n,
            }).some((c) => c.name === 'claim-le-vested' && !c.ok),
        ).toBe(true);

        expect(
            checkLinearClaim({
                vestedNow: 100n,
                releasableBefore: 40n,
                releasedBefore: 60n,
                releasedAfter: 100n,
                beneficiaryWalletBefore: 10n,
                beneficiaryWalletAfter: 10n,
            }).some((c) => c.name === 'beneficiary-wallet-increased' && !c.ok),
        ).toBe(true);
    });

    it('checkUnauthorizedClaimRejected pass/fail', () => {
        expect(
            checkUnauthorizedClaimRejected({
                releasedBefore: 1n,
                releasedAfter: 1n,
                senderIsBeneficiary: false,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkUnauthorizedClaimRejected({
                releasedBefore: 1n,
                releasedAfter: 2n,
                senderIsBeneficiary: false,
            }).some((c) => !c.ok),
        ).toBe(true);

        expect(
            checkUnauthorizedClaimRejected({
                releasedBefore: 0n,
                releasedAfter: 0n,
                senderIsBeneficiary: true,
            }).some((c) => c.name === 'sender-not-beneficiary' && !c.ok),
        ).toBe(true);
    });
});
