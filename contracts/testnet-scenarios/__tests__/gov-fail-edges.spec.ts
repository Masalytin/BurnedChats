import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { Address } from '@ton/core';
import {
    NA_LAB_ONLY_PARAMS,
    NA_NEEDS_LAB_SHORT_TIMERS,
    PS_ACTIVE,
    PS_CANCELLED,
    checkAdminOnlyViaTimelock,
    checkCancelOutcome,
    checkDoubleVoteRejected,
    checkEarlyExecuteRejected,
    checkExpiredVoteRejected,
    checkGovRoleWiring,
    checkInsufficientOnchainVpRejected,
    checkInsufficientVpRejected,
    naWhenGovTimeDependent,
} from '../lib/gov';
import { defaultScenariosDir, discoverScenarios, isDestructive } from '../registry';
import { selectScenarios } from '../runner';
import { emptyState } from '../state';
import type { ScenarioContext } from '../types';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const GOV_FAIL_IDS = [
    'fs-gov-insufficient-vp-reject',
    'fs-gov-insufficient-onchain-vp-reject',
    'fs-gov-double-vote-reject',
    'fs-gov-expired-reject',
    'fs-gov-cancel',
    'fs-gov-timelock-early-execute-reject',
    'fs-gov-payload-staking-or-jetton-admin',
    'fs-gov-role-checks',
] as const;

const EXPECTED_TAGS: Record<(typeof GOV_FAIL_IDS)[number], string[]> = {
    'fs-gov-insufficient-vp-reject': ['governance', 'edge'],
    'fs-gov-insufficient-onchain-vp-reject': ['governance', 'edge'],
    'fs-gov-double-vote-reject': ['governance', 'edge'],
    'fs-gov-expired-reject': ['governance', 'edge'],
    'fs-gov-cancel': ['governance'],
    'fs-gov-timelock-early-execute-reject': ['governance', 'edge'],
    'fs-gov-payload-staking-or-jetton-admin': ['governance', 'admin'],
    'fs-gov-role-checks': ['governance', 'readonly'],
};

const LIVE_TX: Record<(typeof GOV_FAIL_IDS)[number], boolean> = {
    'fs-gov-insufficient-vp-reject': true,
    'fs-gov-insufficient-onchain-vp-reject': true,
    'fs-gov-double-vote-reject': true,
    'fs-gov-expired-reject': true,
    'fs-gov-cancel': true,
    'fs-gov-timelock-early-execute-reject': true,
    'fs-gov-payload-staking-or-jetton-admin': true,
    'fs-gov-role-checks': false,
};

/** Time-dependent fail paths share 09A `needs-lab-short-timers` on shared. */
const TIME_DEPENDENT = new Set<string>([
    'fs-gov-double-vote-reject',
    'fs-gov-expired-reject',
    'fs-gov-cancel',
    'fs-gov-timelock-early-execute-reject',
]);

describe('IMP-TNFS-09B governance fail/edge pack — discovery & tags', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers all fail/edge scenario ids (09B + F19 on-chain VP)', () => {
        for (const id of GOV_FAIL_IDS) {
            expect(byId.get(id)).toBeDefined();
        }
    });

    it('tags / needsLiveTx / destructive flags match DESIGN', () => {
        for (const id of GOV_FAIL_IDS) {
            const s = byId.get(id)!;
            expect(s.tags).toEqual(expect.arrayContaining(EXPECTED_TAGS[id]));
            expect(s.needsLiveTx).toBe(LIVE_TX[id]);
        }
        expect(byId.get('fs-gov-role-checks')!.tags).toContain('readonly');
        expect(byId.get('fs-gov-role-checks')!.needsLiveTx).toBe(false);
        // DESIGN: destructive? maybe — allow true or false; never force destructive on role-checks.
        expect(byId.get('fs-gov-role-checks')!.destructive).not.toBe(true);
        expect(isDestructive(byId.get('fs-gov-role-checks')!)).toBe(false);
        // payload admin may be tagged destructive/maybe — either ok, but if set must be boolean.
        const payload = byId.get('fs-gov-payload-staking-or-jetton-admin')!;
        expect(typeof payload.destructive === 'boolean' || payload.destructive === undefined).toBe(
            true,
        );
    });

    it('depends_on matches DESIGN soft graph', () => {
        expect(byId.get('fs-gov-insufficient-vp-reject')!.depends_on).toEqual(['fs-gov-smoke']);
        expect(byId.get('fs-gov-insufficient-onchain-vp-reject')!.depends_on).toEqual([
            'fs-gov-smoke',
        ]);
        expect(byId.get('fs-gov-double-vote-reject')!.depends_on).toEqual(['fs-gov-vote-happy']);
        expect(byId.get('fs-gov-expired-reject')!.depends_on).toEqual(['fs-gov-propose-happy']);
        expect(byId.get('fs-gov-cancel')!.depends_on).toEqual(['fs-gov-propose-happy']);
        expect(byId.get('fs-gov-timelock-early-execute-reject')!.depends_on).toEqual([
            'fs-gov-vote-happy',
        ]);
        expect(byId.get('fs-gov-payload-staking-or-jetton-admin')!.depends_on).toEqual([
            'fs-gov-smoke',
        ]);
        expect(byId.get('fs-gov-role-checks')!.depends_on).toEqual(['fs-gov-smoke']);
    });

    it('time-dependent ids wire naWhen; claimed-vp has none; on-chain-vp has naWhen', () => {
        expect(byId.get('fs-gov-role-checks')!.naWhen).toBeUndefined();
        expect(byId.get('fs-gov-insufficient-vp-reject')!.naWhen).toBeUndefined();
        expect(typeof byId.get('fs-gov-insufficient-onchain-vp-reject')!.naWhen).toBe('function');
        for (const id of TIME_DEPENDENT) {
            expect(typeof byId.get(id)!.naWhen).toBe('function');
        }
        expect(typeof byId.get('fs-gov-payload-staking-or-jetton-admin')!.naWhen).toBe('function');
    });

    it('appears under --tag governance and --all (non-destructive)', () => {
        const state = emptyState('fp');
        const byTag = selectScenarios(scenarios, { mode: 'tag', tag: 'governance' }, state).map(
            (s) => s.id,
        );
        const byAll = selectScenarios(scenarios, { mode: 'all' }, state).map((s) => s.id);

        for (const id of GOV_FAIL_IDS) {
            expect(byTag).toContain(id);
            const s = byId.get(id)!;
            if (!isDestructive(s)) {
                expect(byAll).toContain(id);
            }
        }
    });

    it('does not register TOKSIM / TNSCEN / pure-1%-burn ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids).not.toContain('transfer-burn-1pct');
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
        expect(ids.some((id) => id.includes('tnscen') || id.includes('tnscien'))).toBe(false);
    });
});

describe('IMP-TNFS-09B naWhen policy (shared with 09A)', () => {
    it('naWhenGovTimeDependent returns needs-lab-short-timers on shared', async () => {
        const sharedCtx = { manifestKind: 'shared' } as ScenarioContext;
        expect(await naWhenGovTimeDependent(sharedCtx)).toBe(NA_NEEDS_LAB_SHORT_TIMERS);
        expect(NA_NEEDS_LAB_SHORT_TIMERS).toBe('needs-lab-short-timers');
    });

    it('scenario naWhen on shared matches exact reason for time-dependent fail ids', async () => {
        const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
        const byId = new Map(scenarios.map((s) => [s.id, s]));
        const sharedCtx = { manifestKind: 'shared' } as ScenarioContext;

        for (const id of TIME_DEPENDENT) {
            const reason = await byId.get(id)!.naWhen!(sharedCtx);
            expect(reason).toBe(NA_NEEDS_LAB_SHORT_TIMERS);
        }
    });

    it('payload-staking-or-jetton-admin N/A on shared with lab-only params', async () => {
        const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
        const byId = new Map(scenarios.map((s) => [s.id, s]));
        const sharedCtx = { manifestKind: 'shared' } as ScenarioContext;
        const reason = await byId.get('fs-gov-payload-staking-or-jetton-admin')!.naWhen!(sharedCtx);
        expect(reason).toBe(NA_LAB_ONLY_PARAMS);
        expect(NA_LAB_ONLY_PARAMS).toBe('lab-only params');
    });
});

describe('IMP-TNFS-09B negative check helpers', () => {
    const addr = (n: number) => new Address(0, Buffer.alloc(32, n));

    it('checkInsufficientVpRejected: expected reject pass; wrong accept fail', () => {
        expect(
            checkInsufficientVpRejected({
                countBefore: 5n,
                countAfter: 5n,
                claimedVp: 0n,
                minProposalVp: 1n,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkInsufficientVpRejected({
                countBefore: 5n,
                countAfter: 6n,
                claimedVp: 0n,
                minProposalVp: 1n,
            }).some((c) => !c.ok),
        ).toBe(true);
    });

    it('checkInsufficientOnchainVpRejected: soft-cancel pass; deploy false-pass fail', () => {
        expect(
            checkInsufficientOnchainVpRejected({
                countBefore: 5n,
                countAfter: 6n,
                claimedVp: 10n,
                minProposalVp: 1n,
                proposerOnchainVp: 0n,
                totalVp: 100n,
                proposalAddr: null,
                stateAfter: PS_CANCELLED,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkInsufficientOnchainVpRejected({
                countBefore: 5n,
                countAfter: 6n,
                claimedVp: 10n,
                minProposalVp: 1n,
                proposerOnchainVp: 0n,
                totalVp: 100n,
                proposalAddr: addr(9),
                stateAfter: PS_ACTIVE,
            }).some((c) => !c.ok),
        ).toBe(true);
    });

    it('checkDoubleVoteRejected: expected reject pass; wrong accept fail', () => {
        expect(
            checkDoubleVoteRejected({
                forVotesBefore: 100n,
                forVotesAfter: 100n,
                hasVoted: true,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkDoubleVoteRejected({
                forVotesBefore: 100n,
                forVotesAfter: 200n,
                hasVoted: true,
            }).some((c) => !c.ok),
        ).toBe(true);
    });

    it('checkExpiredVoteRejected: expected reject pass; wrong accept fail', () => {
        expect(
            checkExpiredVoteRejected({
                hasVotedBefore: false,
                hasVotedAfter: false,
                forVotesBefore: 0n,
                forVotesAfter: 0n,
                nowUnix: 200,
                endTimeUnix: 100,
            }).every((c) => c.ok),
        ).toBe(true);

        // Prior in-window vote: post-expiry retry must not inflate forVotes.
        expect(
            checkExpiredVoteRejected({
                hasVotedBefore: true,
                hasVotedAfter: true,
                forVotesBefore: 10n,
                forVotesAfter: 10n,
                nowUnix: 200,
                endTimeUnix: 100,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkExpiredVoteRejected({
                hasVotedBefore: false,
                hasVotedAfter: true,
                forVotesBefore: 0n,
                forVotesAfter: 10n,
                nowUnix: 200,
                endTimeUnix: 100,
            }).some((c) => !c.ok),
        ).toBe(true);
    });

    it('checkCancelOutcome: in-window cancel + late cancel', () => {
        expect(
            checkCancelOutcome({
                mode: 'in-window',
                stateAfter: PS_CANCELLED,
                stateBefore: PS_ACTIVE,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkCancelOutcome({
                mode: 'late',
                stateAfter: PS_ACTIVE,
                stateBefore: PS_ACTIVE,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkCancelOutcome({
                mode: 'late',
                stateAfter: PS_CANCELLED,
                stateBefore: PS_ACTIVE,
            }).some((c) => !c.ok),
        ).toBe(true);
    });

    it('checkEarlyExecuteRejected: expected reject pass; wrong accept fail', () => {
        expect(
            checkEarlyExecuteRejected({
                pendingStillPresent: true,
                stateAfter: PS_ACTIVE,
                nowUnix: 50,
                scheduledUnix: 100,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkEarlyExecuteRejected({
                pendingStillPresent: false,
                stateAfter: 4n, // PS_EXECUTED
                nowUnix: 50,
                scheduledUnix: 100,
            }).some((c) => !c.ok),
        ).toBe(true);
    });

    it('checkAdminOnlyViaTimelock / checkGovRoleWiring', () => {
        const tl = addr(1);
        const jettonAdmin = tl;
        const sender = addr(2);
        expect(
            checkAdminOnlyViaTimelock({
                jettonAdmin,
                timelock: tl,
                stakingGovernor: tl,
                manifestGovernor: tl,
                sender,
                supplyBefore: 100n,
                supplyAfter: 100n,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkAdminOnlyViaTimelock({
                jettonAdmin: sender,
                timelock: tl,
                stakingGovernor: tl,
                manifestGovernor: tl,
                sender,
                supplyBefore: 100n,
                supplyAfter: 101n,
            }).some((c) => !c.ok),
        ).toBe(true);

        expect(
            checkGovRoleWiring({
                jettonAdmin: tl,
                timelock: tl,
                stakingGovernor: addr(3),
                manifestGovernor: addr(3),
                manifestTimelock: tl,
                onChainTimelock: tl,
                sender,
            }).every((c) => c.ok),
        ).toBe(true);
    });
});
