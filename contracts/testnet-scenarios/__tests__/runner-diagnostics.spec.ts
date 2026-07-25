/**
 * IMP-TNFS-F10 — runner diagnostics: balance preflight (insufficient-sender-ton),
 * uninit → N/A (account-not-initialized), toncenter live-read helpers,
 * single-runner lock (--force-lock).
 */
import { describe, expect, it } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Address, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { insufficientSenderTonReason, NA_INSUFFICIENT_SENDER_TON } from '../lib/balances';
import {
    isUninitAccountError,
    NA_ACCOUNT_NOT_INITIALIZED,
    readLiveTonBalance,
    readOrNaOnUninit,
} from '../lib/provider';
import { acquireRunnerLock, executeRun, parseCliArgs, runnerLockPath, runOne } from '../runner';
import { emptyState } from '../state';
import type { Scenario, ScenarioContext } from '../types';

const ZERO_ADDR = new Address(0, Buffer.alloc(32));

function stubProvider(balanceNano: bigint, senderAddr: Address | null = ZERO_ADDR): NetworkProvider {
    return {
        sender: () => ({ address: senderAddr ?? undefined }),
        provider: (_addr: Address) => ({
            getState: async () => ({ balance: balanceNano, last: null, state: { type: 'active' } }),
        }),
    } as unknown as NetworkProvider;
}

function stubCtx(provider: NetworkProvider): ScenarioContext {
    return {
        network: 'testnet',
        contractsRoot: '.',
        manifestKind: 'shared',
        manifest: { network: 'testnet', addresses: {} },
        deploymentFingerprint: 'fp',
        provider,
    } as unknown as ScenarioContext;
}

function stubScenario(partial: Partial<Scenario> & Pick<Scenario, 'id'>): Scenario {
    return {
        title: partial.id,
        description: '',
        tags: [],
        needsLiveTx: true,
        run: async () => [{ ok: true, name: 'ok', message: 'ok' }],
        ...partial,
    };
}

describe('parseCliArgs --force-lock', () => {
    it('defaults forceLock to false and does not confuse it with --force', () => {
        const opts = parseCliArgs(['--all']);
        expect(opts.forceLock).toBe(false);
        expect(opts.force).toBe(false);
    });

    it('parses --force-lock independently of --force', () => {
        const opts = parseCliArgs(['--all', '--force-lock']);
        expect(opts.forceLock).toBe(true);
        expect(opts.force).toBe(false);
    });
});

describe('insufficientSenderTonReason (balance preflight)', () => {
    const budget = { signer: 'deploy' as const, minTon: toNano('3.8') };

    it('returns null when the signer balance covers the budget', () => {
        expect(insufficientSenderTonReason({ budget, balance: toNano('4') })).toBeNull();
        expect(insufficientSenderTonReason({ budget, balance: toNano('3.8') })).toBeNull();
    });

    it('returns the N/A reason with the required amount on shortfall', () => {
        const reason = insufficientSenderTonReason({
            budget,
            balance: toNano('2.1'),
            address: ZERO_ADDR.toString({ urlSafe: true, bounceable: true }),
        });
        expect(reason).toContain(NA_INSUFFICIENT_SENDER_TON);
        expect(reason).toContain('3.8');
        expect(reason).toContain('2.1');
        expect(reason).toContain('deploy');
    });
});

describe('isUninitAccountError', () => {
    it('matches uninit signals (exit -13 / account_uninit / non-active)', () => {
        expect(isUninitAccountError(new Error('Unable to execute get method. Got exit_code: -13'))).toBe(true);
        expect(isUninitAccountError(new Error('exit_code=-13'))).toBe(true);
        expect(isUninitAccountError(new Error('got -13'))).toBe(true);
        expect(isUninitAccountError(new Error('account_uninit'))).toBe(true);
        expect(isUninitAccountError(new Error('Trying to run get method on non-active contract'))).toBe(true);
    });

    it('does not match other exit codes or generic failures', () => {
        expect(isUninitAccountError(new Error('Got exit_code: 11'))).toBe(false);
        expect(isUninitAccountError(new Error('Got exit_code: 21507'))).toBe(false);
        expect(isUninitAccountError(new Error('network timeout'))).toBe(false);
        expect(isUninitAccountError(new Error('HTTP 500'))).toBe(false);
    });
});

describe('readOrNaOnUninit', () => {
    it('passes values through', async () => {
        const res = await readOrNaOnUninit('actor seqno', async () => 42n);
        expect(res.value).toBe(42n);
        expect(res.na).toBeUndefined();
    });

    it('converts uninit failures into account-not-initialized N/A', async () => {
        const res = await readOrNaOnUninit('fresh actor wallet', async () => {
            throw new Error('Unable to execute get method. Got exit_code: -13');
        });
        expect(res.na).toContain(NA_ACCOUNT_NOT_INITIALIZED);
        expect(res.na).toContain('fresh actor wallet');
    });

    it('rethrows non-uninit failures', async () => {
        await expect(
            readOrNaOnUninit('label', async () => {
                throw new Error('network timeout');
            }),
        ).rejects.toThrow('network timeout');
    });
});

describe('readLiveTonBalance (toncenter live-read helper)', () => {
    it('reads balance via ContractProvider.getState (toncenter path)', async () => {
        const provider = stubProvider(toNano('2.1'));
        expect(await readLiveTonBalance(provider, ZERO_ADDR)).toBe(toNano('2.1'));
    });
});

describe('runOne budget preflight', () => {
    const state = emptyState('fp');

    it('yields N/A insufficient-sender-ton when balance < budget', async () => {
        const scenario = stubScenario({
            id: 'fs-budget-probe',
            budget: { signer: 'deploy', minTon: toNano('3.8') },
        });
        const ctx = stubCtx(stubProvider(toNano('2.1')));
        const { result } = await runOne(scenario, ctx, state, false);
        expect(result.status).toBe('na');
        expect(result.naReason).toContain(NA_INSUFFICIENT_SENDER_TON);
        expect(result.naReason).toContain('3.8');
    });

    it('runs the scenario when balance covers the budget', async () => {
        const scenario = stubScenario({
            id: 'fs-budget-ok',
            budget: { signer: 'actor', minTon: toNano('3.8') },
        });
        const ctx = stubCtx(stubProvider(toNano('10')));
        const { result } = await runOne(scenario, ctx, state, false);
        expect(result.status).toBe('pass');
    });

    it('skips the preflight when the signer address is unavailable', async () => {
        const scenario = stubScenario({
            id: 'fs-budget-no-signer',
            budget: { signer: 'actor', minTon: toNano('3.8') },
        });
        const ctx = stubCtx(stubProvider(toNano('0'), null));
        const { result } = await runOne(scenario, ctx, state, false);
        expect(result.status).toBe('pass');
    });
});

describe('runOne naWhen uninit handling', () => {
    const state = emptyState('fp');

    it('converts an uninit crash in naWhen into N/A account-not-initialized', async () => {
        const scenario = stubScenario({
            id: 'fs-uninit-probe',
            naWhen: async () => {
                throw new Error('Unable to execute get method. Got exit_code: -13');
            },
        });
        const { result } = await runOne(scenario, stubCtx(stubProvider(toNano('10'))), state, false);
        expect(result.status).toBe('na');
        expect(result.naReason).toContain(NA_ACCOUNT_NOT_INITIALIZED);
    });

    it('fails (not crashes) the scenario on other naWhen errors', async () => {
        const scenario = stubScenario({
            id: 'fs-preflight-error',
            naWhen: async () => {
                throw new Error('HTTP 500 from node');
            },
        });
        const { result, state: next } = await runOne(
            scenario,
            stubCtx(stubProvider(toNano('10'))),
            state,
            false,
        );
        expect(result.status).toBe('fail');
        expect(result.error).toContain('preflight failed');
        expect(result.error).toContain('HTTP 500');
        expect(next.scenarios['fs-preflight-error']?.status).toBe('fail');
    });
});

describe('single-runner lock', () => {
    function freshDir(): string {
        return mkdtempSync(join(tmpdir(), 'tnfs-f10-lock-'));
    }

    it('acquires and releases the lock', () => {
        const dir = freshDir();
        const lock = acquireRunnerLock(dir, { forceLock: false });
        expect(existsSync(runnerLockPath(dir))).toBe(true);
        const info = JSON.parse(readFileSync(runnerLockPath(dir), 'utf8')) as { pid: number };
        expect(info.pid).toBe(process.pid);
        lock.release();
        expect(existsSync(runnerLockPath(dir))).toBe(false);
    });

    it('refuses a second runner while the lock pid is alive', () => {
        const dir = freshDir();
        writeFileSync(
            runnerLockPath(dir),
            JSON.stringify({ pid: 999_999, startedAt: '2026-07-23T00:00:00.000Z' }),
            'utf8',
        );
        expect(() =>
            acquireRunnerLock(dir, { forceLock: false, isPidAlive: () => true }),
        ).toThrow(/already live.*pid=999999.*--force-lock/s);
    });

    it('takes over a stale lock (dead pid)', () => {
        const dir = freshDir();
        writeFileSync(
            runnerLockPath(dir),
            JSON.stringify({ pid: 999_999, startedAt: '2026-07-23T00:00:00.000Z' }),
            'utf8',
        );
        const lock = acquireRunnerLock(dir, { forceLock: false, isPidAlive: () => false });
        const info = JSON.parse(readFileSync(runnerLockPath(dir), 'utf8')) as { pid: number };
        expect(info.pid).toBe(process.pid);
        lock.release();
    });

    it('takes over a live lock with --force-lock', () => {
        const dir = freshDir();
        writeFileSync(
            runnerLockPath(dir),
            JSON.stringify({ pid: 999_999, startedAt: '2026-07-23T00:00:00.000Z' }),
            'utf8',
        );
        const lock = acquireRunnerLock(dir, { forceLock: true, isPidAlive: () => true });
        const info = JSON.parse(readFileSync(runnerLockPath(dir), 'utf8')) as { pid: number };
        expect(info.pid).toBe(process.pid);
        lock.release();
    });

    it('takes over a corrupt lock file', () => {
        const dir = freshDir();
        writeFileSync(runnerLockPath(dir), 'not json', 'utf8');
        const lock = acquireRunnerLock(dir, { forceLock: false });
        expect(JSON.parse(readFileSync(runnerLockPath(dir), 'utf8'))).toHaveProperty('pid', process.pid);
        lock.release();
    });
});

/** A pid that is alive but not this process: the jest worker's parent. */
function findForeignAlivePid(): number {
    return process.ppid || process.pid;
}

describe('executeRun lock integration', () => {
    function tmpContractsRoot(): { root: string; reportsDir: string; statePath: string } {
        const root = mkdtempSync(join(tmpdir(), 'tnfs-f10-run-'));
        const addr = ZERO_ADDR.toString({ urlSafe: true, bounceable: true });
        mkdirSync(resolve(root, 'deployments'), { recursive: true });
        writeFileSync(
            resolve(root, 'deployments', 'testnet.json'),
            JSON.stringify({
                network: 'testnet',
                addresses: {
                    jettonMaster: addr,
                    stakingMaster: addr,
                    governor: addr,
                    timelock: addr,
                    treasury: addr,
                },
            }),
            'utf8',
        );
        return {
            root,
            reportsDir: resolve(root, 'reports'),
            statePath: resolve(root, 'state.json'),
        };
    }

    const cliBase = {
        mode: 'all' as const,
        force: false,
        forceLock: false,
        manifest: 'shared' as const,
        requestedMainnet: false,
    };

    it('refuses to run while a live lock exists, with a clear message', async () => {
        const { root, reportsDir, statePath } = tmpContractsRoot();
        mkdirSync(reportsDir, { recursive: true });
        // executeRun uses the default pid-liveness probe, so the lock must name
        // a REAL alive foreign pid — the jest worker's parent qualifies.
        writeFileSync(
            runnerLockPath(reportsDir),
            JSON.stringify({ pid: findForeignAlivePid(), startedAt: '2026-07-23T00:00:00.000Z' }),
            'utf8',
        );
        await expect(
            executeRun({
                contractsRoot: root,
                cli: cliBase,
                scenarios: [],
                statePath,
                reportsDir,
                provider: stubProvider(toNano('10')),
                skipEnvCheck: true,
            }),
        ).rejects.toThrow(/already live|--force-lock/);
        // The foreign lock must not be deleted by the refused runner.
        expect(existsSync(runnerLockPath(reportsDir))).toBe(true);
    });

    it('runs with --force-lock over a live lock and releases it afterwards', async () => {
        const { root, reportsDir, statePath } = tmpContractsRoot();
        mkdirSync(reportsDir, { recursive: true });
        writeFileSync(
            runnerLockPath(reportsDir),
            JSON.stringify({ pid: findForeignAlivePid(), startedAt: '2026-07-23T00:00:00.000Z' }),
            'utf8',
        );
        const { report, reportPath } = await executeRun({
            contractsRoot: root,
            cli: { ...cliBase, forceLock: true },
            scenarios: [],
            statePath,
            reportsDir,
            provider: stubProvider(toNano('10')),
            skipEnvCheck: true,
        });
        expect(report).toBeDefined();
        expect(reportPath && existsSync(reportPath)).toBe(true);
        expect(existsSync(runnerLockPath(reportsDir))).toBe(false);
    });

    it('acquires and releases the lock on a normal run', async () => {
        const { root, reportsDir, statePath } = tmpContractsRoot();
        const { report } = await executeRun({
            contractsRoot: root,
            cli: cliBase,
            scenarios: [],
            statePath,
            reportsDir,
            provider: stubProvider(toNano('10')),
            skipEnvCheck: true,
        });
        expect(report).toBeDefined();
        expect(existsSync(runnerLockPath(reportsDir))).toBe(false);
    });
});
