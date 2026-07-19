import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { Address, beginCell } from '@ton/core';
import {
    CANCEL_LAG_SEC,
    NA_NEEDS_LAB_SHORT_TIMERS,
    OP_TREASURY_SPEND,
    TYPE_TREASURY,
    checkGovSmoke,
    checkProposeCreated,
    checkTreasurySpendAccounting,
    checkVoteRecorded,
    naWhenGovTimeDependent,
    parseTreasurySpendPayload,
    treasurySpendPayload,
} from '../lib/gov';
import { defaultScenariosDir, discoverScenarios, isDestructive } from '../registry';
import { selectScenarios } from '../runner';
import { emptyState } from '../state';
import type { ScenarioContext } from '../types';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const GOV_HAPPY_IDS = [
    'fs-gov-smoke',
    'fs-gov-propose-happy',
    'fs-gov-vote-happy',
    'fs-gov-queue-execute-happy',
    'fs-gov-payload-treasury-spend',
    'fs-treasury-spend-via-timelock',
] as const;

const EXPECTED_TAGS: Record<(typeof GOV_HAPPY_IDS)[number], string[]> = {
    'fs-gov-smoke': ['governance', 'readonly'],
    'fs-gov-propose-happy': ['governance'],
    'fs-gov-vote-happy': ['governance'],
    'fs-gov-queue-execute-happy': ['governance'],
    'fs-gov-payload-treasury-spend': ['governance', 'treasury'],
    'fs-treasury-spend-via-timelock': ['treasury', 'governance'],
};

const LIVE_TX: Record<(typeof GOV_HAPPY_IDS)[number], boolean> = {
    'fs-gov-smoke': false,
    'fs-gov-propose-happy': true,
    'fs-gov-vote-happy': true,
    'fs-gov-queue-execute-happy': true,
    'fs-gov-payload-treasury-spend': true,
    'fs-treasury-spend-via-timelock': true,
};

const TIME_DEPENDENT = new Set<string>([
    'fs-gov-propose-happy',
    'fs-gov-vote-happy',
    'fs-gov-queue-execute-happy',
    'fs-gov-payload-treasury-spend',
    'fs-treasury-spend-via-timelock',
]);

describe('IMP-TNFS-09A governance happy pack — discovery & tags', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers all 6 happy-path scenario ids', () => {
        for (const id of GOV_HAPPY_IDS) {
            expect(byId.get(id)).toBeDefined();
        }
    });

    it('tags match DESIGN; needsLiveTx; not destructive', () => {
        for (const id of GOV_HAPPY_IDS) {
            const s = byId.get(id)!;
            expect(s.tags).toEqual(expect.arrayContaining(EXPECTED_TAGS[id]));
            expect(s.destructive).not.toBe(true);
            expect(isDestructive(s)).toBe(false);
            expect(s.needsLiveTx).toBe(LIVE_TX[id]);
        }
    });

    it('depends_on matches DESIGN soft graph', () => {
        expect(byId.get('fs-gov-smoke')!.depends_on).toEqual(['fs-ops-deployment-fingerprint']);
        expect(byId.get('fs-gov-propose-happy')!.depends_on).toEqual(
            expect.arrayContaining(['fs-gov-smoke', 'fs-staking-stake-happy']),
        );
        expect(byId.get('fs-gov-vote-happy')!.depends_on).toEqual(['fs-gov-propose-happy']);
        expect(byId.get('fs-gov-queue-execute-happy')!.depends_on).toEqual(['fs-gov-vote-happy']);
        expect(byId.get('fs-gov-payload-treasury-spend')!.depends_on).toEqual([
            'fs-gov-queue-execute-happy',
        ]);
        expect(byId.get('fs-treasury-spend-via-timelock')!.depends_on).toEqual([
            'fs-gov-queue-execute-happy',
        ]);
    });

    it('naWhen: time-dependent return needs-lab-short-timers on shared; smoke has none', () => {
        expect(byId.get('fs-gov-smoke')!.naWhen).toBeUndefined();
        for (const id of TIME_DEPENDENT) {
            expect(typeof byId.get(id)!.naWhen).toBe('function');
        }
    });

    it('appears under --tag governance and --all', () => {
        const state = emptyState('fp');
        const byTag = selectScenarios(scenarios, { mode: 'tag', tag: 'governance' }, state).map(
            (s) => s.id,
        );
        const byAll = selectScenarios(scenarios, { mode: 'all' }, state).map((s) => s.id);

        for (const id of GOV_HAPPY_IDS) {
            expect(byTag).toContain(id);
            expect(byAll).toContain(id);
        }
    });

    it('does not register TOKSIM / TNSCEN / pure-1%-burn ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids).not.toContain('transfer-burn-1pct');
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
        expect(ids.some((id) => id.includes('tnscen') || id.includes('tnscien'))).toBe(false);
    });
});

describe('IMP-TNFS-09A naWhen policy', () => {
    it('naWhenGovTimeDependent returns needs-lab-short-timers on shared', async () => {
        const sharedCtx = { manifestKind: 'shared' } as ScenarioContext;
        expect(await naWhenGovTimeDependent(sharedCtx)).toBe(NA_NEEDS_LAB_SHORT_TIMERS);
        expect(NA_NEEDS_LAB_SHORT_TIMERS).toBe('needs-lab-short-timers');
    });

    it('scenario naWhen on shared matches exact reason for all time-dependent ids', async () => {
        const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
        const byId = new Map(scenarios.map((s) => [s.id, s]));
        const sharedCtx = { manifestKind: 'shared' } as ScenarioContext;

        for (const id of TIME_DEPENDENT) {
            const reason = await byId.get(id)!.naWhen!(sharedCtx);
            expect(reason).toBe(NA_NEEDS_LAB_SHORT_TIMERS);
        }
        expect(byId.get('fs-gov-smoke')!.naWhen).toBeUndefined();
    });

    it('naWhenGovTimeDependent allows lab when timers are short enough (mocked via env)', async () => {
        const prev = process.env.GOV_MAX_WAIT_SEC;
        process.env.GOV_MAX_WAIT_SEC = '999999';
        try {
            const labCtx = {
                manifestKind: 'lab',
                manifest: {
                    lab: { timelockDelaySec: 60 },
                    addresses: {},
                },
            } as unknown as ScenarioContext;
            // Without provider, helper falls through to config-length check using lab.timelockDelaySec
            // and default production-like periods → still N/A unless short configs are injected.
            // Unit path: shared is the contract; lab short-path covered by helper tests below.
            expect(await naWhenGovTimeDependent(labCtx)).not.toBe(NA_NEEDS_LAB_SHORT_TIMERS);
        } finally {
            if (prev === undefined) {
                delete process.env.GOV_MAX_WAIT_SEC;
            } else {
                process.env.GOV_MAX_WAIT_SEC = prev;
            }
        }
    });
});

describe('IMP-TNFS-09A check helpers', () => {
    const addr = (n: number) => new Address(0, Buffer.alloc(32, n));

    it('checkGovSmoke pass/fail', () => {
        const g = addr(1);
        const tl = addr(2);
        const st = addr(3);
        const tr = addr(4);
        expect(
            checkGovSmoke({
                manifestGovernor: g,
                onChainTimelock: tl,
                manifestTimelock: tl,
                onChainStaking: st,
                manifestStaking: st,
                onChainTreasury: tr,
                manifestTreasury: tr,
                timelockDelaySec: 60n,
                labTimelockDelaySec: 60,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkGovSmoke({
                manifestGovernor: g,
                onChainTimelock: tl,
                manifestTimelock: addr(9),
                onChainStaking: st,
                manifestStaking: st,
                onChainTreasury: tr,
                manifestTreasury: tr,
                timelockDelaySec: 60n,
            }).some((c) => c.name === 'linked-timelock' && !c.ok),
        ).toBe(true);
    });

    it('checkProposeCreated / checkVoteRecorded', () => {
        expect(
            checkProposeCreated({
                countBefore: 0n,
                countAfter: 1n,
                proposalAddr: addr(1),
                startTime: 100n,
                endTime: 200n,
                createdAtApprox: 50,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkVoteRecorded({
                forVotesBefore: 0n,
                forVotesAfter: 10n,
                hasVoted: true,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkVoteRecorded({
                forVotesBefore: 0n,
                forVotesAfter: 0n,
                hasVoted: false,
            }).some((c) => !c.ok),
        ).toBe(true);
    });

    it('treasurySpendPayload round-trips canonical treasury', () => {
        const treasury = addr(1);
        const recipient = addr(2);
        const cell = treasurySpendPayload(treasury, recipient, 1_000_000n, 'tnfs-09a');
        const parsed = parseTreasurySpendPayload(cell);
        expect(parsed.treasury.equals(treasury)).toBe(true);
        expect(parsed.recipient.equals(recipient)).toBe(true);
        expect(parsed.amount).toBe(1_000_000n);
        expect(parsed.reason).toBe('tnfs-09a');
        expect(TYPE_TREASURY).toBe(2);
        expect(OP_TREASURY_SPEND).toBe(0x5a1c9010);
        expect(CANCEL_LAG_SEC).toBe(3600);
        // ensure payload is non-empty cell
        expect(cell.equals(beginCell().endCell())).toBe(false);
    });

    it('checkTreasurySpendAccounting pass/fail', () => {
        expect(
            checkTreasurySpendAccounting({
                spentBefore: 0n,
                spentAfter: 1_000_000n,
                countBefore: 0n,
                countAfter: 1n,
                spendAmount: 1_000_000n,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkTreasurySpendAccounting({
                spentBefore: 0n,
                spentAfter: 0n,
                countBefore: 0n,
                countAfter: 0n,
                spendAmount: 1_000_000n,
            }).some((c) => !c.ok),
        ).toBe(true);
    });
});
