/**
 * IMP-TNFS-F15 — locked-beyond VP helper for gov vote scenarios.
 *
 * Live runs (lab 2026-07-25, tip 01bb596f): fs-gov-vote-happy voted with a
 * Flexible-tier (tier 0) stake only. The flash-stake protection
 * (IMP-FAUDIT-F01 / F-2, staking-master.tact `GovernorVoteRelay` →
 * `computeOwnerVotingPowerLockedBeyond`) counts ONLY stakes with
 * `unlockTime > voteEndTime` (STRICTLY greater); Flexible has
 * `unlockTime == startTime` → effective VP = 0 → "Zero effective vp" bounce →
 * vote never recorded. These tests pin the harness mirror
 * `computeLockedBeyondVp` (lib/gov.ts) against the contract formula and the
 * idempotent no-send decision of `ensureLockedVotingPower`.
 *
 * Stub NetworkProvider pattern mirrors gov-proposal-selection.spec.ts.
 */
import { Address, beginCell, Contract, ContractProvider, openContract, TupleItem, TupleReader } from '@ton/core';
import { expect } from '@jest/globals';
import type { NetworkProvider } from '@ton/blueprint';
import { computeLockedBeyondVp, ensureLockedVotingPower, resolveStakingLockAddr } from '../testnet-scenarios/lib/gov';
import { NANO_PER_BURN } from '../testnet-scenarios/lib/balances';
import { STAKE_AMOUNT_HAPPY, type StakeRecordView } from '../testnet-scenarios/lib/staking';
import type { ScenarioContext } from '../testnet-scenarios/types';
import '@ton/test-utils';

const GOVERNOR_ADDR = Address.parse('EQBmkM_xe-12_YjfTqUBeh3JnqR8PttyPALYHBwcr_0ryvMH');
const STAKING_MASTER_ADDR = new Address(0, Buffer.alloc(32, 0x20));
const STAKING_LOCK_ADDR = new Address(0, Buffer.alloc(32, 0x30));
const ACTOR_ADDR = new Address(0, Buffer.alloc(32, 0xaa));

const NOW = 1_784_900_000n;
/** Estimated voting-window end used across the tests. */
const VOTE_END = NOW + 720n;

/** On-chain tier table shape (multiplier ×100): live lab tier 1 (Silver) = 150. */
const MULTIPLIERS = new Map<bigint, bigint>([
    [0n, 100n],
    [1n, 150n],
    [2n, 200n],
    [3n, 300n],
]);

function stakeRecord(input: { amount: bigint; tier: bigint; unlockTime: bigint; startTime?: bigint }): StakeRecordView {
    return {
        amount: input.amount,
        tier: input.tier,
        startTime: input.startTime ?? NOW - 3_600n,
        lastClaimTime: input.startTime ?? NOW - 3_600n,
        unlockTime: input.unlockTime,
    };
}

/** Flexible tier: unlockTime == startTime (never beyond an open window). */
function flexibleRecord(amount: bigint): StakeRecordView {
    const start = NOW - 3_600n;
    return stakeRecord({ amount, tier: 0n, unlockTime: start, startTime: start });
}

describe('IMP-TNFS-F15 — computeLockedBeyondVp (contract formula mirror)', () => {
    it('flexible-only stake → 0 (live regression: Actor A 4 BURN flexible, vote bounced)', () => {
        const records = [flexibleRecord(4n * NANO_PER_BURN)];
        expect(computeLockedBeyondVp(records, MULTIPLIERS, VOTE_END)).toBe(0n);
    });

    it('tier-1 stake locked beyond the window → 1.5x multiplier applied', () => {
        // Live fix shape: 5 BURN into Silver (150) → VP 7.5 BURN-units.
        const records = [
            stakeRecord({
                amount: 5n * NANO_PER_BURN,
                tier: 1n,
                unlockTime: NOW + 15_552_000n, // 180 d lock
            }),
        ];
        expect(computeLockedBeyondVp(records, MULTIPLIERS, VOTE_END)).toBe((5n * NANO_PER_BURN * 150n) / 100n);
    });

    it('mixed tiers: only stakes with unlockTime beyond the window count', () => {
        const records = [
            flexibleRecord(4n * NANO_PER_BURN), // never counts
            stakeRecord({ amount: 5n * NANO_PER_BURN, tier: 1n, unlockTime: VOTE_END + 1n }),
            stakeRecord({ amount: 2n * NANO_PER_BURN, tier: 2n, unlockTime: VOTE_END - 60n }),
            stakeRecord({ amount: 1n * NANO_PER_BURN, tier: 3n, unlockTime: VOTE_END + 999n }),
        ];
        const expected = (5n * NANO_PER_BURN * 150n) / 100n + (1n * NANO_PER_BURN * 300n) / 100n;
        expect(computeLockedBeyondVp(records, MULTIPLIERS, VOTE_END)).toBe(expected);
    });

    it('boundary: unlockTime == voteEndTime does NOT count (contract uses strict >)', () => {
        const records = [stakeRecord({ amount: 5n * NANO_PER_BURN, tier: 1n, unlockTime: VOTE_END })];
        expect(computeLockedBeyondVp(records, MULTIPLIERS, VOTE_END)).toBe(0n);
        // One second later it counts.
        const beyond = [stakeRecord({ amount: 5n * NANO_PER_BURN, tier: 1n, unlockTime: VOTE_END + 1n })];
        expect(computeLockedBeyondVp(beyond, MULTIPLIERS, VOTE_END)).toBeGreaterThan(0n);
    });

    it('zero-amount record is ignored even when locked beyond (contract: amount > 0)', () => {
        const records = [stakeRecord({ amount: 0n, tier: 1n, unlockTime: VOTE_END + 999n })];
        expect(computeLockedBeyondVp(records, MULTIPLIERS, VOTE_END)).toBe(0n);
    });

    it('per-stake floor division mirrors the contract (amount × mult / 100 per stake)', () => {
        // 3 nano at 150 → 4 (floor 4.5), summed per stake, not on the total.
        const records = [
            stakeRecord({ amount: 3n, tier: 1n, unlockTime: VOTE_END + 1n }),
            stakeRecord({ amount: 3n, tier: 1n, unlockTime: VOTE_END + 1n }),
        ];
        expect(computeLockedBeyondVp(records, MULTIPLIERS, VOTE_END)).toBe(8n);
    });

    it('throws on a missing tier multiplier instead of silently dropping VP', () => {
        const records = [stakeRecord({ amount: 5n * NANO_PER_BURN, tier: 1n, unlockTime: VOTE_END + 1n })];
        expect(() => computeLockedBeyondVp(records, new Map(), VOTE_END)).toThrow(/missing multiplier/);
    });
});

// ─── ensureLockedVotingPower — idempotent no-send decision ──────────────────

type StubOptions = {
    /** Stake records served by stakingMaster get_stake, keyed by tier. */
    stakes: Partial<Record<number, StakeRecordView>>;
    /** When true, governor get_staking_lock throws → manifest fallback path. */
    breakGovernorLockGetter?: boolean;
};

function intItem(value: bigint): TupleItem {
    return { type: 'int', value };
}

function stakeTupleItem(r: StakeRecordView): TupleItem {
    return {
        type: 'tuple',
        items: [
            intItem(r.amount),
            intItem(r.tier),
            intItem(r.startTime),
            intItem(r.lastClaimTime),
            intItem(r.unlockTime),
        ],
    };
}

/**
 * ScenarioContext whose provider serves governor `get_staking_lock`,
 * StakingLock `get_tier_multiplier` and StakingMaster `get_stake`.
 * `provider.sender()` throws — proving the sufficient-VP path sends nothing.
 */
function makeEnsureCtx(opts: StubOptions): ScenarioContext {
    const providerFor = (target: Address): ContractProvider =>
        ({
            get: async (name: string, args: TupleItem[]) => {
                if (target.equals(GOVERNOR_ADDR)) {
                    if (name === 'get_staking_lock') {
                        if (opts.breakGovernorLockGetter) {
                            throw new Error('exit_code: -13 (stub: getter unavailable)');
                        }
                        return {
                            stack: new TupleReader([
                                {
                                    type: 'slice',
                                    cell: beginCell().storeAddress(STAKING_LOCK_ADDR).endCell(),
                                } as TupleItem,
                            ]),
                        };
                    }
                    throw new Error(`governor stub: unexpected getter ${name}`);
                }
                if (target.equals(STAKING_LOCK_ADDR)) {
                    if (name === 'get_tier_multiplier') {
                        const tier = Number((args[0] as { type: 'int'; value: bigint }).value);
                        const mult = MULTIPLIERS.get(BigInt(tier));
                        if (mult == null) {
                            throw new Error(`lock stub: no multiplier for tier ${tier}`);
                        }
                        // Tier 0 served RAW (bare bigint) — pins the toncenter-v2
                        // tolerant read path (IMP-TNFS-F09 client shape family).
                        const item = tier === 0 ? (mult as unknown as TupleItem) : intItem(mult);
                        return { stack: new TupleReader([item]) };
                    }
                    throw new Error(`lock stub: unexpected getter ${name}`);
                }
                if (target.equals(STAKING_MASTER_ADDR)) {
                    if (name === 'get_stake') {
                        const tier = Number((args[1] as { type: 'int'; value: bigint }).value);
                        const record = opts.stakes[tier];
                        const item: TupleItem = record ? stakeTupleItem(record) : ({ type: 'null' } as TupleItem);
                        return { stack: new TupleReader([item]) };
                    }
                    throw new Error(`master stub: unexpected getter ${name}`);
                }
                throw new Error(`stub: unknown target ${target.toString()}`);
            },
        }) as unknown as ContractProvider;

    const provider = {
        provider: providerFor,
        open: <T extends Contract>(contract: T) => openContract(contract, (p) => providerFor(p.address)),
        sender: () => {
            throw new Error('ensureLockedVotingPower must not send when locked VP is sufficient');
        },
    } as unknown as NetworkProvider;

    return {
        network: 'testnet',
        contractsRoot: '.',
        manifestKind: 'lab',
        manifest: {
            network: 'testnet',
            addresses: {
                jettonMaster: new Address(0, Buffer.alloc(32, 0x40)).toString(),
                stakingMaster: STAKING_MASTER_ADDR.toString(),
                stakingLock: STAKING_LOCK_ADDR.toString(),
                governor: GOVERNOR_ADDR.toString(),
                timelock: GOVERNOR_ADDR.toString(),
                treasury: GOVERNOR_ADDR.toString(),
                airdropHolder: ACTOR_ADDR.toString(),
            },
        },
        deploymentFingerprint: 'fp-f15',
        provider,
    } as ScenarioContext;
}

const ACTOR_ENV_KEYS = ['STAKE_TEST_SENDER', 'FEE_TEST_SENDER', 'TEST_ACTOR', 'BURN_SMOKE_TEST_OWNER'] as const;
const savedEnv: Record<string, string | undefined> = {};

describe('IMP-TNFS-F15 — ensureLockedVotingPower (idempotent decision)', () => {
    beforeAll(() => {
        // Actor resolution must come from manifest airdropHolder in these tests.
        for (const key of ACTOR_ENV_KEYS) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterAll(() => {
        for (const key of ACTOR_ENV_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    });

    it('existing tier-1 stake locked beyond the window → returns VP, sends nothing', async () => {
        const ctx = makeEnsureCtx({
            stakes: {
                0: flexibleRecord(4n * NANO_PER_BURN),
                1: stakeRecord({
                    amount: STAKE_AMOUNT_HAPPY,
                    tier: 1n,
                    unlockTime: VOTE_END + 15_552_000n,
                }),
            },
        });
        // Stubbed sender() throws on any send — resolving proves the no-send path.
        const vp = await ensureLockedVotingPower(ctx, { minVoteEndTime: VOTE_END });
        expect(vp).toBe((STAKE_AMOUNT_HAPPY * 150n) / 100n);
    });

    it('flexible-only actor is NOT treated as covered (proceeds to funding gate)', async () => {
        const ctx = makeEnsureCtx({
            stakes: { 0: flexibleRecord(4n * NANO_PER_BURN) },
        });
        // Zero locked VP → ensure moves past the idempotent return to the BURN
        // funding gate (stubbed jetton wallet reads as 0 balance) — the honest
        // insufficient-BURN error, never a silent "sufficient" return.
        await expect(ensureLockedVotingPower(ctx, { minVoteEndTime: VOTE_END })).rejects.toThrow(
            /insufficient test wallet BURN/,
        );
    });

    it('tier-1 stake unlocking exactly at voteEndTime is NOT sufficient (strict >)', async () => {
        const ctx = makeEnsureCtx({
            stakes: {
                1: stakeRecord({ amount: STAKE_AMOUNT_HAPPY, tier: 1n, unlockTime: VOTE_END }),
            },
        });
        await expect(ensureLockedVotingPower(ctx, { minVoteEndTime: VOTE_END })).rejects.toThrow(
            /insufficient test wallet BURN/,
        );
    });

    it('resolveStakingLockAddr: governor getter first, manifest fallback on failure', async () => {
        const viaGetter = makeEnsureCtx({ stakes: {} });
        expect((await resolveStakingLockAddr(viaGetter)).equals(STAKING_LOCK_ADDR)).toBe(true);

        const viaManifest = makeEnsureCtx({ stakes: {}, breakGovernorLockGetter: true });
        expect((await resolveStakingLockAddr(viaManifest)).equals(STAKING_LOCK_ADDR)).toBe(true);
    });

    it('manifest-fallback path still detects a sufficient locked stake (no send)', async () => {
        const ctx = makeEnsureCtx({
            stakes: {
                1: stakeRecord({
                    amount: STAKE_AMOUNT_HAPPY,
                    tier: 1n,
                    unlockTime: VOTE_END + 1n,
                }),
            },
            breakGovernorLockGetter: true,
        });
        const vp = await ensureLockedVotingPower(ctx, { minVoteEndTime: VOTE_END });
        expect(vp).toBe((STAKE_AMOUNT_HAPPY * 150n) / 100n);
    });
});
