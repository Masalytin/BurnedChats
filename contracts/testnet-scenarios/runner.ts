/**
 * Full-stack testnet scenario runner CLI (IMP-TNFS-02).
 *
 * Usage:
 *   npm run testnet:scenarios -- --list
 *   npm run testnet:scenarios -- --manifest lab --tag destructive
 *   npm run testnet:scenarios -- --all
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDeployEnv, resolveMnemonic } from '../scripts/deploy/env';
import { allChecksPass } from './lib/checks';
import { computeDeploymentFingerprint } from './lib/fingerprint';
import { loadManifest } from './lib/manifest';
import { assertNotMainnetRequest, assertTestnetOnly } from './lib/network-guard';
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

    return { mode, scenarioId, tag, force, manifest, requestedMainnet };
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
  npm run testnet:scenarios -- --manifest shared|lab   (default: shared)

Notes:
  - --all never selects destructive scenarios
  - destructive only via --tag destructive or --scenario <id>
  - reports: contracts/reports/*.json (gitignored)
  - state: contracts/.testnet-scenario-state.json (gitignored)
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
    if (!resolveMnemonic()) {
        throw new Error(
            'Missing mnemonic in .env.testnet (WALLET_MNEMONIC / MNEMONIC_TESTNET / MNEMONIC)',
        );
    }
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

async function runOne(
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

    const naReason = scenario.naWhen ? await scenario.naWhen(ctx) : undefined;
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
    /** When true, skip .env.testnet / mnemonic fail-fast (unit tests). */
    skipEnvCheck?: boolean;
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

    const deploymentFingerprint = computeDeploymentFingerprint(manifest);
    const statePath = opts.statePath ?? defaultStatePath(contractsRoot);
    let state = loadState(statePath, deploymentFingerprint);

    const selected = selectScenarios(scenarios, cli, state);
    const ctx: ScenarioContext = {
        network: 'testnet',
        contractsRoot,
        manifestKind: cli.manifest,
        manifest,
        deploymentFingerprint,
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

    const reportsDir = opts.reportsDir ?? defaultReportsDir(contractsRoot);
    const reportPath = writeReportJson(reportsDir, report);
    return { report, reportPath };
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
