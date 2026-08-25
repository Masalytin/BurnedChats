/**
 * IMP-TNFS-F13 — state-aware gov proposal selection (re-runnable pack).
 *
 * Live run 2026-07-25 on lab (report 2026-07-25T14-42-13-176Z-tag_governance):
 * fs-gov-cancel creates a FRESH proposal and cancels it, leaving the governor's
 * LATEST proposal Cancelled (state 5). fs-gov-vote-happy /
 * fs-gov-queue-execute-happy blindly took `resolveLatestProposalAddr` → voted /
 * queued against the cancelled proposal → on-chain reject. These tests pin the
 * replacement `resolveUsableProposal` (lib/gov.ts): scan from the latest
 * proposal downward with bounded depth, skipping terminal states
 * (Cancelled/Defeated, and Executed unless the caller wants it as idempotent
 * success), honouring the voting window for votable candidates.
 *
 * Stub NetworkProvider pattern mirrors gov-timelock-pending-tolerant-read.spec.ts.
 */
import { Address, beginCell, Contract, ContractProvider, openContract, TupleItem, TupleReader } from '@ton/core';
import { expect } from '@jest/globals';
import type { NetworkProvider } from '@ton/blueprint';
import {
    PROPOSAL_SCAN_DEPTH,
    PS_ACTIVE,
    PS_CANCELLED,
    PS_DEFEATED,
    PS_EXECUTED,
    PS_SUCCEEDED,
    isProposalUsable,
    resolveUsableProposal,
} from '../testnet-scenarios/lib/gov';
import type { ScenarioContext } from '../testnet-scenarios/types';
import '@ton/test-utils';

const GOVERNOR_ADDR = Address.parse('EQBmkM_xe-12_YjfTqUBeh3JnqR8PttyPALYHBwcr_0ryvMH');

const NOW = 1_784_900_000;
/** Active, voting window currently open. */
const IN_WINDOW = { startTime: BigInt(NOW - 60), endTime: BigInt(NOW + 600) };
/** Active, voting opens in the future (inside cancel lag). */
const PRE_WINDOW = { startTime: BigInt(NOW + 30), endTime: BigInt(NOW + 600) };
/** Active, voting window already over but never finalized. */
const EXPIRED = { startTime: BigInt(NOW - 600), endTime: BigInt(NOW - 60) };

type ProposalStub = {
    state: bigint;
    startTime?: bigint;
    endTime?: bigint;
};

/** Deterministic per-id proposal address (id 0 → 0x40, id 1 → 0x41, …). */
function proposalAddr(id: number): Address {
    return new Address(0, Buffer.alloc(32, 0x40 + id));
}

function intStack(value: bigint): TupleReader {
    return new TupleReader([{ type: 'int', value } as TupleItem]);
}

function addressStack(addr: Address): TupleReader {
    return new TupleReader([{ type: 'slice', cell: beginCell().storeAddress(addr).endCell() } as TupleItem]);
}

/**
 * ScenarioContext whose provider serves Governor getters (get_proposal_count /
 * get_proposal) for GOVERNOR_ADDR and Proposal getters (get_state /
 * get_start_time / get_end_time) for the per-id stub proposals.
 */
function makeCtx(proposals: ProposalStub[]): ScenarioContext {
    const providerFor = (target: Address): ContractProvider =>
        ({
            get: async (name: string, args: TupleItem[]) => {
                if (target.equals(GOVERNOR_ADDR)) {
                    if (name === 'get_proposal_count') {
                        return { stack: intStack(BigInt(proposals.length)) };
                    }
                    if (name === 'get_proposal') {
                        const id = Number((args[0] as { type: 'int'; value: bigint }).value);
                        return { stack: addressStack(proposalAddr(id)) };
                    }
                    throw new Error(`governor stub: unexpected getter ${name}`);
                }
                const id = proposals.findIndex((_, i) => proposalAddr(i).equals(target));
                if (id < 0) {
                    throw new Error(`proposal stub: unknown address ${target.toString()}`);
                }
                const p = proposals[id];
                if (name === 'get_state') {
                    return { stack: intStack(p.state) };
                }
                if (name === 'get_start_time') {
                    return { stack: intStack(p.startTime ?? 0n) };
                }
                if (name === 'get_end_time') {
                    return { stack: intStack(p.endTime ?? 0n) };
                }
                throw new Error(`proposal stub: unexpected getter ${name}`);
            },
        }) as unknown as ContractProvider;

    const provider = {
        provider: providerFor,
        open: <T extends Contract>(contract: T) => openContract(contract, (p) => providerFor(p.address)),
    } as unknown as NetworkProvider;

    return {
        network: 'testnet',
        contractsRoot: '.',
        manifestKind: 'lab',
        manifest: {
            network: 'testnet',
            addresses: {
                jettonMaster: GOVERNOR_ADDR.toString(),
                stakingMaster: GOVERNOR_ADDR.toString(),
                governor: GOVERNOR_ADDR.toString(),
                timelock: GOVERNOR_ADDR.toString(),
                treasury: GOVERNOR_ADDR.toString(),
            },
        },
        deploymentFingerprint: 'fp-f13',
        provider,
    } as ScenarioContext;
}

describe('IMP-TNFS-F13 — resolveUsableProposal (state-aware scan)', () => {
    it('regression (live report): latest Cancelled, id=0 Executed — votable=null, executable=id 0', async () => {
        // Exact tip shape from 2026-07-25 lab run: fs-gov-cancel created id=1
        // and cancelled it. Old resolveLatestProposalAddr returned id=1 → vote
        // rejected on-chain and queue-execute failed "state=5 expected 4".
        const ctx = makeCtx([{ state: PS_EXECUTED }, { state: PS_CANCELLED }]);

        const votable = await resolveUsableProposal(ctx, 'votable', { nowUnix: NOW });
        expect(votable).toBeNull(); // vote-happy must create a fresh proposal

        const executable = await resolveUsableProposal(ctx, 'executable', { nowUnix: NOW });
        expect(executable).not.toBeNull();
        expect(executable!.id).toBe(0n); // idempotent pass on the executed one
        expect(executable!.state).toBe(PS_EXECUTED);

        const reusable = await resolveUsableProposal(ctx, 'reusable', { nowUnix: NOW });
        expect(reusable).toBeNull(); // propose-happy must CreateProposal
    });

    it('skips a cancelled latest and returns the earlier in-window Active proposal', async () => {
        const ctx = makeCtx([{ state: PS_ACTIVE, ...IN_WINDOW }, { state: PS_CANCELLED }]);
        for (const want of ['votable', 'reusable', 'executable'] as const) {
            const found = await resolveUsableProposal(ctx, want, { nowUnix: NOW });
            expect(found).not.toBeNull();
            expect(found!.id).toBe(0n);
            expect(found!.addr.equals(proposalAddr(0))).toBe(true);
            expect(found!.state).toBe(PS_ACTIVE);
        }
    });

    it('prefers the newest usable proposal (scan order latest → earliest)', async () => {
        const ctx = makeCtx([
            { state: PS_ACTIVE, ...IN_WINDOW },
            { state: PS_ACTIVE, ...PRE_WINDOW },
            { state: PS_CANCELLED },
        ]);
        const found = await resolveUsableProposal(ctx, 'votable', { nowUnix: NOW });
        expect(found!.id).toBe(1n);
    });

    it('votable: skips an expired-but-unfinalized Active proposal', async () => {
        const ctx = makeCtx([{ state: PS_ACTIVE, ...EXPIRED }]);
        expect(await resolveUsableProposal(ctx, 'votable', { nowUnix: NOW })).toBeNull();
        // …but the queue/execute path may still finalize it.
        const executable = await resolveUsableProposal(ctx, 'executable', { nowUnix: NOW });
        expect(executable!.id).toBe(0n);
    });

    it('votable: accepts a pre-window Active proposal (caller waits for startTime)', async () => {
        const ctx = makeCtx([{ state: PS_ACTIVE, ...PRE_WINDOW }]);
        const found = await resolveUsableProposal(ctx, 'votable', { nowUnix: NOW });
        expect(found!.id).toBe(0n);
    });

    it('returns null when no proposal within scan depth is usable', async () => {
        const ctx = makeCtx([{ state: PS_CANCELLED }, { state: PS_DEFEATED }, { state: PS_CANCELLED }]);
        for (const want of ['votable', 'reusable', 'executable'] as const) {
            expect(await resolveUsableProposal(ctx, want, { nowUnix: NOW })).toBeNull();
        }
    });

    it('returns null on an empty governor (proposal_count = 0)', async () => {
        const ctx = makeCtx([]);
        expect(await resolveUsableProposal(ctx, 'votable', { nowUnix: NOW })).toBeNull();
    });

    it('bounded depth: a usable proposal below the scan window is not found', async () => {
        // id=0 is votable, ids 1..PROPOSAL_SCAN_DEPTH are cancelled → the scan
        // (latest downward, depth entries) never reaches id=0.
        const proposals: ProposalStub[] = [
            { state: PS_ACTIVE, ...IN_WINDOW },
            ...Array.from({ length: PROPOSAL_SCAN_DEPTH }, () => ({ state: PS_CANCELLED })),
        ];
        const ctx = makeCtx(proposals);
        expect(await resolveUsableProposal(ctx, 'votable', { nowUnix: NOW })).toBeNull();

        // Explicit deeper scan does find it.
        const deeper = await resolveUsableProposal(ctx, 'votable', {
            nowUnix: NOW,
            depth: PROPOSAL_SCAN_DEPTH + 1,
        });
        expect(deeper!.id).toBe(0n);
    });
});

describe('IMP-TNFS-F13 — isProposalUsable (propose-happy reuse predicate & co)', () => {
    const cases: Array<{
        title: string;
        state: bigint;
        endTimeUnix: bigint;
        expected: Record<'votable' | 'reusable' | 'executable', boolean>;
    }> = [
        {
            title: 'Active in-window',
            state: PS_ACTIVE,
            endTimeUnix: IN_WINDOW.endTime,
            expected: { votable: true, reusable: true, executable: true },
        },
        {
            title: 'Active expired (unfinalized)',
            state: PS_ACTIVE,
            endTimeUnix: EXPIRED.endTime,
            expected: { votable: false, reusable: false, executable: true },
        },
        {
            title: 'Succeeded',
            state: PS_SUCCEEDED,
            endTimeUnix: 0n,
            expected: { votable: false, reusable: true, executable: true },
        },
        {
            title: 'Executed',
            state: PS_EXECUTED,
            endTimeUnix: 0n,
            expected: { votable: false, reusable: false, executable: true },
        },
        {
            title: 'Cancelled',
            state: PS_CANCELLED,
            endTimeUnix: 0n,
            expected: { votable: false, reusable: false, executable: false },
        },
        {
            title: 'Defeated',
            state: PS_DEFEATED,
            endTimeUnix: 0n,
            expected: { votable: false, reusable: false, executable: false },
        },
    ];

    for (const c of cases) {
        it(`${c.title}: votable=${c.expected.votable} reusable=${c.expected.reusable} executable=${c.expected.executable}`, () => {
            for (const want of ['votable', 'reusable', 'executable'] as const) {
                expect(
                    isProposalUsable({
                        want,
                        state: c.state,
                        endTimeUnix: c.endTimeUnix,
                        nowUnix: NOW,
                    }),
                ).toBe(c.expected[want]);
            }
        });
    }
});
