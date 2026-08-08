/**
 * Full-stack testnet scenario runner CLI (IMP-TNFS-02).
 *
 * Usage:
 *   npm run testnet:scenarios -- --list
 *   npm run testnet:scenarios -- --manifest lab --tag destructive
 *   npm run testnet:scenarios -- --all
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyBlueprintWalletAliases, loadDeployEnv, resolveMnemonic } from '../scripts/deploy/env';
import type { NetworkProvider } from '@ton/blueprint';
import { insufficientSenderTonReason } from './lib/balances';
import { allChecksPass } from './lib/checks';
import { computeDeploymentFingerprint } from './lib/fingerprint';
import { resolveDeployerSender } from './lib/gov';
import { loadManifest } from './lib/manifest';
import { assertNotMainnetRequest, assertTestnetOnly } from './lib/network-guard';
import {
    createTestnetNetworkProvider,
    isUninitAccountError,
    NA_ACCOUNT_NOT_INITIALIZED,
    readLiveTonBalance,
} from './lib/provider';
import { defaultScenariosDir, discoverScenarios, isDestructive, orderByDependsOn } from './registry';
import { formatStdoutSummary, writeReportJson, defaultReportsDir } from './report';
import {
    defaultStatePath,
    listFailedScenarioIds,
    loadState,
    recordScenarioResult,
    saveState,
    shouldSkipScenario,
} from './state';
import type {
    CliOptions,
    ManifestKind,
    Report,
    Scenario,
    ScenarioContext,
    ScenarioRunResult,
    RunnerState,
} from './types';

export function parseCliArgs(argv: string[]): CliOptions {
    const args = argv.slice();
    let mode: CliOptions['mode'] | undefined;
    let scenarioId: string | undefined;
    let tag: string | undefined;
    let force = false;
    let forceLock = false;
    let manifest: ManifestKind = 'shared';
    let requestedMainnet = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === '--mainnet') {
            requestedMainnet = true;
            continue;
        }
        if (a === '--force') {
            force = true;
            continue;
        }
        if (a === '--force-lock') {
            forceLock = true;
            continue;
        }
        if (a === '--list') {
            mode = 'list';
            continue;
        }
        if (a === '--all') {
            mode = 'all';
            continue;
        }
        if (a === '--failed-only') {
            mode = 'failed-only';
            continue;
        }
        if (a === '--scenario') {
            mode = 'scenario';
            scenarioId = args[++i];
            if (!scenarioId) {
                throw new Error('--scenario requires an id');
            }
            continue;
        }
        if (a === '--tag') {
            mode = 'tag';
            tag = args[++i];
            if (!tag) {
                throw new Error('--tag requires a tag name');
            }
            continue;
        }
        if (a === '--manifest') {
            const v = args[++i];
            if (v !== 'shared' && v !== 'lab') {
                throw new Error('--manifest must be "shared" or "lab"');
            }
            manifest = v;
            continue;
        }
        if (a === '--help' || a === '-h') {
            printHelp();
            mode = 'list';
            continue;
        }
        if (a.startsWith('-')) {
            throw new Error(`Unknown flag: ${a}`);
        }
    }

    if (!mode) {
        throw new Error(
            'Specify one of: --list | --scenario <id> | --tag <tag> | --all | --failed-only\n' +
                'See --help for details.',
        );
    }

    return { mode, scenarioId, tag, force, forceLock, manifest, requestedMainnet };
}

function printHelp(): void {
    console.log(`Full-stack testnet scenario runner

Usage:
  npm run testnet:scenarios -- --list
  npm run testnet:scenarios -- --scenario <id>
  npm run testnet:scenarios -- --tag <tag>
  npm run testnet:scenarios -- --all
  npm run testnet:scenarios -- --failed-only
  npm run testnet:scenarios -- --force
  npm run testnet:scenarios -- --force-lock
  npm run testnet:scenarios -- --manifest shared|lab   (default: shared)

Notes:
  - --all never selects destructive scenarios
  - destructive only via --tag destructive or --scenario <id>
  - reports: contracts/reports/*.json (gitignored)
  - state: contracts/.testnet-scenario-state.json (gitignored)
  - single-runner lock: contracts/reports/.runner.lock; a second live runner
    refuses to start while the lock pid is alive (--force-lock to take over)
  - npm on Windows swallows flags after "--": invoke directly via
    npx ts-node --transpile-only testnet-scenarios/runner.ts <flags>
`);
}

export function selectScenarios(
    all: Scenario[],
    opts: Pick<CliOptions, 'mode' | 'scenarioId' | 'tag'>,
    state: RunnerState,
): Scenario[] {
    let selected: Scenario[];

    switch (opts.mode) {
        case 'list':
            return [];
        case 'scenario': {
            const found = all.find((s) => s.id === opts.scenarioId);
            if (!found) {
                throw new Error(`Unknown scenario id: ${opts.scenarioId}`);
            }
            selected = [found];
            break;
        }
        case 'tag': {
            const tag = opts.tag!;
            selected = all.filter((s) => s.tags.includes(tag) || (tag === 'destructive' && isDestructive(s)));
            break;
        }
        case 'all':
            // Policy: destructive ∉ --all
            selected = all.filter((s) => !isDestructive(s));
            break;
        case 'failed-only': {
            const failedIds = new Set(listFailedScenarioIds(state));
            selected = all.filter((s) => failedIds.has(s.id));
            break;
        }
        default:
            selected = [];
    }

    return orderByDependsOn(selected);
}

export function filterLabel(opts: CliOptions): string {
    switch (opts.mode) {
        case 'list':
            return 'list';
        case 'scenario':
            return `scenario:${opts.scenarioId}`;
        case 'tag':
            return `tag:${opts.tag}`;
        case 'all':
            return 'all';
        case 'failed-only':
            return 'failed-only';
        default:
            return 'run';
    }
}

export function assertTestnetEnvReady(contractsRoot: string): void {
    const envPath = resolve(contractsRoot, '.env.testnet');
    if (!existsSync(envPath)) {
        throw new Error(`Missing ${envPath} — create .env.testnet with testnet mnemonic before live runs`);
    }
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    if (!resolveMnemonic()) {
        throw new Error(
            'Missing mnemonic in .env.testnet (WALLET_MNEMONIC / MNEMONIC_TESTNET / MNEMONIC)',
        );
    }
}

// ─── Single-runner lock (IMP-TNFS-F10) ──────────────────────────────────────
// RUNBOOK requires one live runner, but nothing enforced it: two overlapping
// runs (2026-07-23, after a Tee-pipe failure) raced seqno and overwrote
// reports. Lock file lives in contracts/reports/ precisely because that dir
// is gitignored.

export const RUNNER_LOCK_FILE = '.runner.lock';

export type RunnerLockInfo = { pid: number; startedAt: string };

export function runnerLockPath(reportsDir: string): string {
    return resolve(reportsDir, RUNNER_LOCK_FILE);
}

function defaultIsPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // EPERM: process exists but belongs to someone else — still alive.
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function readLockInfo(path: string): RunnerLockInfo | null {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RunnerLockInfo>;
        if (typeof parsed.pid === 'number') {
            return {
                pid: parsed.pid,
                startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : 'unknown',
            };
        }
    } catch {
        // Corrupt/unreadable lock → treated as stale below.
    }
    return null;
}

/**
 * Acquire the single-runner lock or throw with a clear message.
 * Policy: live pid → refuse (unless --force-lock); dead pid or corrupt lock →
 * warn and take over. Release only removes the lock if it is still ours.
 */
export function acquireRunnerLock(
    reportsDir: string,
    opts: { forceLock: boolean; pid?: number; isPidAlive?: (pid: number) => boolean } = {
        forceLock: false,
    },
): { path: string; release: () => void } {
    const path = runnerLockPath(reportsDir);
    const pid = opts.pid ?? process.pid;
    const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;

    if (existsSync(path)) {
        const existing = readLockInfo(path);
        const existingAlive = existing !== null && existing.pid !== pid && isPidAlive(existing.pid);
        if (existingAlive && !opts.forceLock) {
            throw new Error(
                `Another scenario runner is already live: pid=${existing.pid} started=${existing.startedAt} ` +
                    `(lock ${path}). Concurrent runners race wallet seqno and overwrite reports/state — ` +
                    `wait for it to finish, or re-run with --force-lock if it is truly gone. ` +
                    `Invoke directly (npm swallows flags): ` +
                    `npx ts-node --transpile-only testnet-scenarios/runner.ts <filter> --force-lock`,
            );
        }
        if (existingAlive) {
            console.warn(
                `[runner-lock] --force-lock: taking over LIVE lock pid=${existing.pid} started=${existing.startedAt}`,
            );
        } else {
            console.warn(
                `[runner-lock] stale lock (pid=${existing?.pid ?? '?'} dead or lock unreadable) — taking over`,
            );
        }
    }

    mkdirSync(reportsDir, { recursive: true });
    const info: RunnerLockInfo = { pid, startedAt: new Date().toISOString() };
    writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`, 'utf8');

    let released = false;
    return {
        path,
        release: () => {
            if (released) {
                return;
            }
            released = true;
            // Only unlink if the lock is still ours (a takeover may have replaced it).
            if (existsSync(path) && readLockInfo(path)?.pid === pid) {
                unlinkSync(path);
            }
        },
    };
}

function formatList(scenarios: Scenario[]): string {
    if (scenarios.length === 0) {
        return 'No scenarios registered (scenarios/ is empty — add fs-* files in later cards).';
    }
    const lines = scenarios.map((s) => {
        const flags = [
            s.needsLiveTx ? 'live-tx' : 'readonly',
            isDestructive(s) ? 'destructive' : undefined,
        ]
            .filter(Boolean)
            .join(',');
        return `${s.id}\t[${s.tags.join(',')}]\t${flags}\t${s.title}`;
    });
    return lines.join('\n');
}

export async function runOne(
    scenario: Scenario,
    ctx: ScenarioContext,
    state: RunnerState,
    force: boolean,
): Promise<{ result: ScenarioRunResult; state: RunnerState }> {
    const skip = shouldSkipScenario(scenario.id, state, { force });
    if (skip.skip) {
        return {
            result: {
                id: scenario.id,
                title: scenario.title,
                status: 'skipped',
                durationMs: 0,
                checks: [],
                skippedReason: skip.reason,
            },
            state,
        };
    }

    let naReason: string | null | undefined;
    try {
        naReason = scenario.naWhen ? await scenario.naWhen(ctx) : undefined;
        // Balance preflight (IMP-TNFS-F10): V5R1 silently skips actions whose
        // attach exceeds the balance — check the declared budget up front.
        // `signer: 'deploy'` must check Timelock.governor (DEPLOY_WALLET_MNEMONIC),
        // not Blueprint Actor A (IMP-TNFS-F16).
        if (!naReason && scenario.budget) {
            let signer = ctx.provider.sender().address ?? null;
            if (scenario.budget.signer === 'deploy') {
                try {
                    signer = (await resolveDeployerSender(ctx)).address;
                } catch {
                    // Unit stubs without deployer mnemonic keep Blueprint sender.
                }
            }
            if (signer) {
                const balance = await readLiveTonBalance(ctx.provider, signer);
                naReason = insufficientSenderTonReason({
                    budget: scenario.budget,
                    balance,
                    address: signer.toString({ urlSafe: true, bounceable: true }),
                });
            }
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isUninitAccountError(err)) {
            // Fresh actor wallets / undeployed children are a legitimate state
            // during preflight probes — explicit N/A, not FAIL (IMP-TNFS-F10).
            return {
                result: {
                    id: scenario.id,
                    title: scenario.title,
                    status: 'na',
                    durationMs: 0,
                    checks: [],
                    naReason: `${NA_ACCOUNT_NOT_INITIALIZED} (${message})`,
                },
                state,
            };
        }
        // Other preflight failures fail this scenario (recorded, never skipped)
        // instead of crashing the whole run loop.
        const next = recordScenarioResult(state, scenario.id, {
            status: 'fail',
            ts: new Date().toISOString(),
        });
        return {
            result: {
                id: scenario.id,
                title: scenario.title,
                status: 'fail',
                durationMs: 0,
                checks: [],
                error: `preflight failed: ${message}`,
            },
            state: next,
        };
    }
    if (naReason) {
        return {
            result: {
                id: scenario.id,
                title: scenario.title,
                status: 'na',
                durationMs: 0,
                checks: [],
                naReason,
            },
            state,
        };
    }

    const started = Date.now();
    try {
        const checks = await scenario.run(ctx);
        const durationMs = Date.now() - started;
        const ok = allChecksPass(checks);
        const status = ok ? 'pass' : 'fail';
        const next = recordScenarioResult(state, scenario.id, {
            status,
            ts: new Date().toISOString(),
        });
        return {
            result: {
                id: scenario.id,
                title: scenario.title,
                status,
                durationMs,
                checks,
                error: ok ? undefined : 'one or more checks failed',
            },
            state: next,
        };
    } catch (err) {
        const durationMs = Date.now() - started;
        const message = err instanceof Error ? err.message : String(err);
        const next = recordScenarioResult(state, scenario.id, {
            status: 'fail',
            ts: new Date().toISOString(),
        });
        return {
            result: {
                id: scenario.id,
                title: scenario.title,
                status: 'fail',
                durationMs,
                checks: [],
                error: message,
            },
            state: next,
        };
    }
}

export async function executeRun(opts: {
    contractsRoot: string;
    cli: CliOptions;
    scenarios?: Scenario[];
    statePath?: string;
    reportsDir?: string;
    /** Injected provider (unit tests); otherwise SilentUI + mnemonic bootstrap. */
    provider?: NetworkProvider;
    /** When true, skip .env.testnet / mnemonic fail-fast (unit tests). */
    skipEnvCheck?: boolean;
    /** When true, skip NetworkProvider bootstrap (unit tests with injected stub). */
    skipProvider?: boolean;
}): Promise<{ report?: Report; listOutput?: string; reportPath?: string }> {
    const { contractsRoot, cli } = opts;

    assertNotMainnetRequest({
        requestedMainnet: cli.requestedMainnet,
        networkEnv: process.env.NETWORK,
    });

    const scenarios = opts.scenarios ?? discoverScenarios(defaultScenariosDir(contractsRoot));

    if (cli.mode === 'list') {
        return { listOutput: formatList(scenarios) };
    }

    if (!opts.skipEnvCheck) {
        assertTestnetEnvReady(contractsRoot);
    }

    const manifest = loadManifest(contractsRoot, cli.manifest);
    assertTestnetOnly({
        requestedMainnet: cli.requestedMainnet,
        networkEnv: process.env.NETWORK,
        manifestNetwork: manifest.network,
    });

    // Single-runner lock (IMP-TNFS-F10): refuse to overlap a live run.
    const reportsDir = opts.reportsDir ?? defaultReportsDir(contractsRoot);
    const lock = acquireRunnerLock(reportsDir, { forceLock: cli.forceLock });
    try {
        const deploymentFingerprint = computeDeploymentFingerprint(manifest);
        const statePath = opts.statePath ?? defaultStatePath(contractsRoot);
        let state = loadState(statePath, deploymentFingerprint);

        const selected = selectScenarios(scenarios, cli, state);
        let provider = opts.provider;
        if (!provider && !opts.skipProvider) {
            provider = await createTestnetNetworkProvider(contractsRoot);
        }
        if (!provider) {
            throw new Error(
                'NetworkProvider required for scenario runs (pass provider or disable skipProvider)',
            );
        }
        const ctx: ScenarioContext = {
            network: 'testnet',
            contractsRoot,
            manifestKind: cli.manifest,
            manifest,
            deploymentFingerprint,
            provider,
        };

        const started = new Date().toISOString();
        const results: ScenarioRunResult[] = [];
        for (const scenario of selected) {
            const { result, state: next } = await runOne(scenario, ctx, state, cli.force);
            state = next;
            results.push(result);
        }
        const finished = new Date().toISOString();

        saveState(statePath, state);

        const report: Report = {
            network: 'testnet',
            manifestKind: cli.manifest,
            fingerprint: deploymentFingerprint,
            filter: filterLabel(cli),
            started,
            finished,
            scenarios: results,
        };

        const reportPath = writeReportJson(reportsDir, report);
        return { report, reportPath };
    } finally {
        lock.release();
    }
}

async function main(): Promise<void> {
    const contractsRoot = resolve(__dirname, '..');
    const cli = parseCliArgs(process.argv.slice(2));

    if (cli.mode === 'list') {
        // --list: no live tx, no env/mnemonic required
        assertNotMainnetRequest({
            requestedMainnet: cli.requestedMainnet,
            networkEnv: process.env.NETWORK,
        });
        const scenarios = discoverScenarios(defaultScenariosDir(contractsRoot));
        console.log(formatList(scenarios));
        return;
    }

    const { report, reportPath } = await executeRun({ contractsRoot, cli });
    if (report) {
        console.log(formatStdoutSummary(report, reportPath));
        const failed = report.scenarios.some((s) => s.status === 'fail');
        if (failed) {
            process.exitCode = 1;
        }
    }
}

if (require.main === module) {
    main().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exitCode = 1;
    });
}
