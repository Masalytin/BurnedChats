import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { Address } from '@ton/core';
import { defaultScenariosDir, discoverScenarios, isDestructive } from '../registry';
import {
    ESTIMATED_FORWARD_FEE_PER_HOP_NANO,
    MIN_TON_FEE_PATH_NANO,
} from '../../scripts/lib/estimateJettonTransferTon';
import { selectScenarios } from '../runner';
import { emptyState } from '../state';
import {
    abiHasPauseKnob,
    checkClaimNoDoublePay,
    checkEarlyExitRejected,
    checkExcludedWalletInOut,
    checkInsufficientStakeRejected,
    checkMasterSmoke,
    checkStakeMapUpdated,
    checkUnstakeReturned,
    FLEXIBLE_TIER,
    LOCKED_TIER,
    loadStakingMasterAbi,
    loadStakingMasterTact,
    MIN_STAKE_NANO,
    NA_INSUFFICIENT_BURN,
    NA_NO_OPEN_STAKE,
    NA_NO_PAUSE_KNOB,
    NA_TIER_NO_LOCK,
    NA_ZERO_PENDING,
    pauseNaReason,
    lockDurationNaReason,
    STAKE_AMOUNT_HAPPY,
    STAKE_ATTACHED_TON,
    STAKE_FORWARD_TON,
    SUB_MIN_STAKE_NANO,
    stakeForwardPayload,
} from '../lib/staking';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const STAKING_IDS = [
    'fs-staking-master-smoke',
    'fs-staking-stake-happy',
    'fs-staking-unstake-happy',
    'fs-staking-claim-rewards',
    'fs-staking-lock-early-exit',
    'fs-staking-insufficient-stake',
    'fs-staking-double-claim',
    'fs-staking-jetton-wallet-inout',
    'fs-staking-pause-admin',
] as const;

const EXPECTED_TAGS: Record<(typeof STAKING_IDS)[number], string[]> = {
    'fs-staking-master-smoke': ['staking', 'readonly'],
    'fs-staking-stake-happy': ['staking'],
    'fs-staking-unstake-happy': ['staking'],
    'fs-staking-claim-rewards': ['staking'],
    'fs-staking-lock-early-exit': ['staking', 'lock'],
    'fs-staking-insufficient-stake': ['staking', 'edge'],
    'fs-staking-double-claim': ['staking', 'edge'],
    'fs-staking-jetton-wallet-inout': ['staking'],
    'fs-staking-pause-admin': ['staking', 'admin'],
};

const LIVE_TX: Record<(typeof STAKING_IDS)[number], boolean> = {
    'fs-staking-master-smoke': false,
    'fs-staking-stake-happy': true,
    'fs-staking-unstake-happy': true,
    'fs-staking-claim-rewards': true,
    'fs-staking-lock-early-exit': true,
    'fs-staking-insufficient-stake': true,
    'fs-staking-double-claim': true,
    'fs-staking-jetton-wallet-inout': true,
    'fs-staking-pause-admin': false,
};

const HAS_NA_WHEN = new Set<string>([
    'fs-staking-stake-happy',
    'fs-staking-unstake-happy',
    'fs-staking-claim-rewards',
    'fs-staking-lock-early-exit',
    'fs-staking-insufficient-stake',
    'fs-staking-double-claim',
    'fs-staking-jetton-wallet-inout',
    'fs-staking-pause-admin',
]);

describe('IMP-TNFS-07 staking pack — discovery & tags', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers all 9 §B staking scenario ids', () => {
        for (const id of STAKING_IDS) {
            expect(byId.get(id)).toBeDefined();
        }
    });

    it('tags match DESIGN; needsLiveTx; not destructive (pause has no knob)', () => {
        for (const id of STAKING_IDS) {
            const s = byId.get(id)!;
            expect(s.tags).toEqual(expect.arrayContaining(EXPECTED_TAGS[id]));
            expect(s.tags).toContain('staking');
            expect(s.destructive).not.toBe(true);
            expect(isDestructive(s)).toBe(false);
            expect(s.needsLiveTx).toBe(LIVE_TX[id]);
        }
    });

    it('naWhen wired for DESIGN N/A rows; master-smoke has none', () => {
        expect(byId.get('fs-staking-master-smoke')!.naWhen).toBeUndefined();
        for (const id of HAS_NA_WHEN) {
            expect(typeof byId.get(id)!.naWhen).toBe('function');
        }
    });

    it('depends_on matches DESIGN soft graph', () => {
        expect(byId.get('fs-staking-master-smoke')!.depends_on).toEqual([
            'fs-ops-deployment-fingerprint',
        ]);
        expect(byId.get('fs-staking-stake-happy')!.depends_on).toEqual(
            expect.arrayContaining(['fs-staking-master-smoke', 'fs-jetton-fee-split']),
        );
        expect(byId.get('fs-staking-unstake-happy')!.depends_on).toEqual([
            'fs-staking-stake-happy',
        ]);
        expect(byId.get('fs-staking-claim-rewards')!.depends_on).toEqual([
            'fs-staking-stake-happy',
        ]);
        expect(byId.get('fs-staking-double-claim')!.depends_on).toEqual([
            'fs-staking-claim-rewards',
        ]);
        expect(byId.get('fs-staking-insufficient-stake')!.depends_on).toEqual([
            'fs-staking-master-smoke',
        ]);
    });

    it('appears under --tag staking and --all', () => {
        const state = emptyState('fp');
        const byTag = selectScenarios(scenarios, { mode: 'tag', tag: 'staking' }, state).map(
            (s) => s.id,
        );
        const byAll = selectScenarios(scenarios, { mode: 'all' }, state).map((s) => s.id);

        for (const id of STAKING_IDS) {
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

    it('does not touch jetton matrix/admin/tep scenario ids from 04–06', () => {
        for (const id of STAKING_IDS) {
            expect(id).not.toMatch(/^fs-jetton-/);
            expect(id).not.toMatch(/fee-split/);
            expect(id).not.toMatch(/mint-/);
            expect(id).not.toMatch(/tep/);
            expect(id).not.toMatch(/close-mint/);
            expect(id).not.toMatch(/revoke-admin/);
        }
    });
});

describe('IMP-TNFS-07 seed constants & Flexible tier choice', () => {
    it('stake attach clears the post-F11 wallet entry gate (IMP-MNAUD-F20)', () => {
        expect(STAKE_ATTACHED_TON).toBe(10_600_000_000n);
        expect(STAKE_FORWARD_TON).toBe(8_000_000_000n);
        expect(STAKE_AMOUNT_HAPPY).toBe(5_000_000_000n);
        expect(MIN_STAKE_NANO).toBe(10_000_000n);
        expect(SUB_MIN_STAKE_NANO).toBe(MIN_STAKE_NANO - 1n);
        expect(FLEXIBLE_TIER).toBe(0);
        expect(LOCKED_TIER).toBe(1);
        // Gate: value > forward + 2*fwd_fee + minTonFeePath (1.0 after F17).
        expect(STAKE_ATTACHED_TON).toBeGreaterThan(
            STAKE_FORWARD_TON +
                2n * ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
                MIN_TON_FEE_PATH_NANO,
        );
    });

    it('stakeForwardPayload encodes either-bit + StakeForward ref', () => {
        const slice = stakeForwardPayload(FLEXIBLE_TIER);
        expect(slice.loadUint(1)).toBe(1);
        const ref = slice.loadRef();
        expect(ref.bits.length).toBeGreaterThan(0);
    });
});

describe('IMP-TNFS-07 N/A reason semantics', () => {
    it('pause knob absent on current StakingMaster → explicit DESIGN reason', () => {
        const abi = loadStakingMasterAbi(CONTRACTS_ROOT);
        const tact = loadStakingMasterTact(CONTRACTS_ROOT);
        expect(abiHasPauseKnob(abi, tact)).toBe(false);
        expect(pauseNaReason(false)).toBe(NA_NO_PAUSE_KNOB);
        expect(pauseNaReason(false)).toBe('no pause knob in deployment');
        expect(pauseNaReason(true)).toBeNull();
    });

    it('lockDurationNaReason / static N/A strings match DESIGN', () => {
        expect(lockDurationNaReason(0n)).toBe(NA_TIER_NO_LOCK);
        expect(lockDurationNaReason(1n)).toBeNull();
        expect(NA_INSUFFICIENT_BURN).toBe('insufficient test wallet BURN');
        expect(NA_NO_OPEN_STAKE).toBe('no open stake');
        expect(NA_ZERO_PENDING).toBe('emission unfunded / zero pending');
    });

    it('pause-admin naWhen returns reason on current tree', () => {
        const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
        const byId = new Map(scenarios.map((s) => [s.id, s]));
        const ctx = {
            network: 'testnet' as const,
            contractsRoot: CONTRACTS_ROOT,
            manifestKind: 'shared' as const,
            manifest: {
                network: 'testnet' as const,
                addresses: {
                    jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    stakingMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    governor: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    timelock: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    treasury: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                },
            },
            deploymentFingerprint: 'test',
            provider: null as unknown as import('../types').ScenarioContext['provider'],
        };
        expect(byId.get('fs-staking-pause-admin')!.naWhen!(ctx)).toBe(NA_NO_PAUSE_KNOB);
    });
});

describe('IMP-TNFS-07 check helpers', () => {
    const addr = (n: number) => new Address(0, Buffer.alloc(32, n));

    it('checkStakeMapUpdated pass/fail', () => {
        const ok = checkStakeMapUpdated({
            stakeBefore: 0n,
            stakeAfter: STAKE_AMOUNT_HAPPY,
            poolBefore: 0n,
            poolAfter: STAKE_AMOUNT_HAPPY,
            amount: STAKE_AMOUNT_HAPPY,
            tier: FLEXIBLE_TIER,
        });
        expect(ok.every((c) => c.ok)).toBe(true);

        const bad = checkStakeMapUpdated({
            stakeBefore: 0n,
            stakeAfter: 0n,
            poolBefore: 0n,
            poolAfter: 0n,
            amount: STAKE_AMOUNT_HAPPY,
            tier: FLEXIBLE_TIER,
        });
        expect(bad.every((c) => c.ok)).toBe(false);
    });

    it('checkUnstakeReturned / claim no double-pay / insufficient / early-exit', () => {
        expect(
            checkUnstakeReturned({
                stakeBefore: MIN_STAKE_NANO * 2n,
                stakeAfter: MIN_STAKE_NANO,
                walletBefore: 0n,
                walletAfter: MIN_STAKE_NANO,
                amount: MIN_STAKE_NANO,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkClaimNoDoublePay({
                walletBefore: 100n,
                walletAfterFirst: 150n,
                walletAfterSecond: 150n,
                pendingBefore: 50n,
            }).every((c) => c.ok),
        ).toBe(true);
        expect(
            checkClaimNoDoublePay({
                walletBefore: 100n,
                walletAfterFirst: 150n,
                walletAfterSecond: 200n,
                pendingBefore: 50n,
            }).some((c) => c.name === 'no-double-pay' && !c.ok),
        ).toBe(true);

        expect(
            checkInsufficientStakeRejected({
                stakeBefore: 0n,
                stakeAfter: 0n,
                walletBefore: MIN_STAKE_NANO,
                walletAfter: MIN_STAKE_NANO,
                attempted: SUB_MIN_STAKE_NANO,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkEarlyExitRejected({
                stakeBefore: MIN_STAKE_NANO,
                stakeAfter: MIN_STAKE_NANO,
                lockDurationSeconds: 100n,
            }).every((c) => c.ok),
        ).toBe(true);
        expect(
            checkEarlyExitRejected({
                stakeBefore: MIN_STAKE_NANO,
                stakeAfter: 0n,
                lockDurationSeconds: 100n,
            }).some((c) => !c.ok),
        ).toBe(true);
    });

    it('checkExcludedWalletInOut + master smoke', () => {
        expect(
            checkExcludedWalletInOut({
                stakingMasterExcluded: true,
                stakingPoolExcluded: true,
                transferInAmount: MIN_STAKE_NANO,
                userDeltaOnStake: -MIN_STAKE_NANO,
                userDeltaOnUnstake: MIN_STAKE_NANO,
            }).every((c) => c.ok),
        ).toBe(true);

        // Top-up auto-claim: debit is amount minus pending reward credit.
        expect(
            checkExcludedWalletInOut({
                stakingMasterExcluded: true,
                stakingPoolExcluded: true,
                transferInAmount: 10_000_000n,
                userDeltaOnStake: -9_983_199n,
                userDeltaOnUnstake: 10_000_000n,
                pendingBefore: 16_801n,
            }).every((c) => c.ok),
        ).toBe(true);
        // Fee cut would push claimCredit negative.
        expect(
            checkExcludedWalletInOut({
                stakingMasterExcluded: true,
                stakingPoolExcluded: true,
                transferInAmount: 10_000_000n,
                userDeltaOnStake: -10_100_000n,
                userDeltaOnUnstake: 10_000_000n,
            }).some((c) => c.name === 'transfer-in-full' && !c.ok),
        ).toBe(true);
        // Large pending auto-claim can net-credit the JW on top-up.
        expect(
            checkExcludedWalletInOut({
                stakingMasterExcluded: true,
                stakingPoolExcluded: true,
                transferInAmount: 10_000_000n,
                userDeltaOnStake: 1_040_631n,
                userDeltaOnUnstake: 10_000_000n,
                pendingBefore: 1_200_000n,
            }).every((c) => c.ok),
        ).toBe(true);

        const m = addr(1);
        const j = addr(2);
        const p = addr(3);
        expect(
            checkMasterSmoke({
                manifestStaking: m,
                onChainJetton: j,
                manifestJetton: j,
                onChainPool: p,
                manifestPool: p,
            }).every((c) => c.ok),
        ).toBe(true);
        expect(
            checkMasterSmoke({
                manifestStaking: m,
                onChainJetton: j,
                manifestJetton: addr(9),
                onChainPool: p,
                manifestPool: p,
            }).some((c) => c.name === 'linked-jetton' && !c.ok),
        ).toBe(true);
    });
});
