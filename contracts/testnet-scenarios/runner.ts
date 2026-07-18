import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDeployEnv, resolveMnemonic } from '../scripts/deploy/env';
import { loadDeployment } from '../scripts/deploy/store';
import { allChecksOk } from './lib/checks';
import {
    isScenarioSkipError,
    skipResultFromError,
} from './lib/destructive-preflight';
import { fingerprintFromDeployment } from './lib/fingerprint';
import { assertTestnet } from './lib/network-guard';
import { createTestnetNetworkProvider } from './lib/provider';
import { discoverScenarios, formatScenarioList, selectScenarios } from './registry';
import { buildReport, printStdoutSummary, writeReportJson } from './report';
import {
    buildSkipKey,
    failedScenarioIds,
    loadState,
    recordResult,
    shouldSkip,
} from './state';
import type { CliFilter, Scenario, ScenarioContext, ScenarioRunResult } from './types';

const CONTRACTS_ROOT = resolve(__dirname, '..');
const SCENARIOS_DIR = resolve(__dirname, 'scenarios');
const REPORTS_DIR = resolve(__dirname, 'reports');
const STATE_PATH = resolve(__dirname, '.testnet-scenario-state.json');
const ENV_TESTNET = resolve(CONTRACTS_ROOT, '.env.testnet');

export function parseArgs(argv: string[]): CliFilter {
    const out: CliFilter = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--list') {
            out.list = true;
        } else if (arg === '--all') {
            out.all = true;
        } else if (arg === '--failed-only') {
            out.failedOnly = true;
        } else if (arg === '--force') {
            out.force = true;
        } else if (arg === '--scenario') {
            const value = argv[++i];
            if (!value) {
                throw new Error('--scenario requires an id');
            }
            out.scenario = value;
        } else if (arg === '--tag') {
            const value = argv[++i];
            if (!value) {
                throw new Error('--tag requires a tag name');
            }
            out.tag = value;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (arg === '--') {
            // npm/PowerShell sometimes insert a bare `--` before script args
            continue;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return out;
}

function printHelp(): void {
    console.log(`Usage: npm run testnet:scenarios -- [options]

Options:
  --list                 List discovered scenarios (no network / no tx)
  --scenario <id>        Run one scenario (may be destructive)
  --tag <t>              Run scenarios with tag (destructive excluded unless t=destructive)
  --all                  Run all non-destructive scenarios
  --failed-only          Restrict selection to prior fail entries in skip-state
  --force                Ignore pass skip-state
  -h, --help             Show help
`);
}

function filterLabel(filter: CliFilter): string {
    if (filter.scenario) {
        return `scenario:${filter.scenario}`;
    }
    if (filter.tag) {
        return `tag:${filter.tag}`;
    }
    if (filter.all) {
        return filter.failedOnly ? 'all+failed-only' : 'all';
    }
    if (filter.failedOnly) {
        return 'failed-only';
    }
    return 'none';
}

function requireRunSelection(filter: CliFilter): void {
    if (!filter.scenario && !filter.tag && !filter.all && !filter.failedOnly) {
        throw new Error(
            'Select work with --scenario <id>, --tag <t>, --all, and/or --failed-only (or use --list).',
        );
    }
}

function assertLivePrerequisites(): void {
    if (!existsSync(ENV_TESTNET)) {
        throw new Error(`Missing ${ENV_TESTNET} — create it before running live scenarios.`);
    }
    loadDeployEnv(CONTRACTS_ROOT);
    const mnemonic = resolveMnemonic();
    if (!mnemonic) {
        throw new Error(
            'Missing wallet mnemonic in .env.testnet (WALLET_MNEMONIC / MNEMONIC_TESTNET / MNEMONIC).',
        );
    }
}

function loadTestnetDeployment() {
    const deployment = loadDeployment(CONTRACTS_ROOT, 'testnet');
    if (!deployment) {
        throw new Error('Missing deployments/testnet.json — run npm run deploy:burn:testnet first.');
    }
    if (!deployment.jettonMaster?.trim()) {
        throw new Error(
            'deployments/testnet.json has empty/pending jettonMaster — finish deploy before running scenarios.',
        );
    }
    assertTestnet(deployment.network);
    return deployment;
}

async function runOne(
    scenario: Scenario,
    ctx: ScenarioContext,
    skip: boolean,
): Promise<ScenarioRunResult> {
    const started = Date.now();
    if (skip) {
        return {
            id: scenario.id,
            status: 'skip',
            durationMs: Date.now() - started,
            checks: [],
            txUrls: [],
            error: 'skipped: prior pass (use --force to re-run)',
        };
    }
    try {
        const checks = await scenario.run(ctx);
        const ok = allChecksOk(checks);
        return {
            id: scenario.id,
            status: ok ? 'pass' : 'fail',
            durationMs: Date.now() - started,
            checks,
            txUrls: [],
            error: ok ? undefined : 'one or more checks failed',
        };
    } catch (err) {
        if (isScenarioSkipError(err)) {
            // Preflight N/A (e.g. mintable=false) — do not fail the whole run, do not record as pass.
            return skipResultFromError(scenario.id, err, Date.now() - started);
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
            id: scenario.id,
            status: 'error',
            durationMs: Date.now() - started,
            checks: [],
            txUrls: [],
            error: message,
        };
    }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
    const filter = parseArgs(argv);
    const scenarios = discoverScenarios(SCENARIOS_DIR);

    if (filter.list) {
        console.log(formatScenarioList(scenarios));
        return 0;
    }

    requireRunSelection(filter);
    // Network / secrets gate before any scenario work (including empty selection).
    assertLivePrerequisites();
    const deployment = loadTestnetDeployment();
    const fingerprint = fingerprintFromDeployment(deployment);
    const state = loadState(STATE_PATH);
    const priorFails = failedScenarioIds(
        state,
        deployment.jettonMaster,
        fingerprint,
        scenarios.map((s) => s.id),
    );

    const selected = selectScenarios(
        scenarios,
        {
            scenario: filter.scenario,
            tag: filter.tag,
            all: filter.all || (!filter.scenario && !filter.tag && filter.failedOnly),
            failedOnly: filter.failedOnly,
        },
        priorFails,
    );

    if (selected.length === 0) {
        console.log('[testnet-scenarios] nothing to run for filter', filterLabel(filter));
        return 0;
    }

    const started = new Date().toISOString();
    console.log('[testnet-scenarios] network=testnet');
    console.log(`[testnet-scenarios] master=${deployment.jettonMaster}`);
    console.log(`[testnet-scenarios] fingerprint=${fingerprint}`);
    console.log(`[testnet-scenarios] selected=${selected.map((s) => s.id).join(', ')}`);
    console.log('[testnet-scenarios] bootstrapping NetworkProvider (testnet + mnemonic)…');
    const provider = await createTestnetNetworkProvider();

    const ctx: ScenarioContext = {
        contractsRoot: CONTRACTS_ROOT,
        network: 'testnet',
        jettonMaster: deployment.jettonMaster,
        fingerprint,
        deployment,
        force: Boolean(filter.force),
        provider,
    };

    const results: ScenarioRunResult[] = [];
    for (const scenario of selected) {
        const key = buildSkipKey(deployment.jettonMaster, fingerprint, scenario.id);
        const skip = shouldSkip(state, key, { force: Boolean(filter.force) });
        console.log(`[testnet-scenarios] → ${scenario.id}${skip ? ' (skip)' : ''}`);
        const result = await runOne(scenario, ctx, skip);
        results.push(result);
        if (result.status === 'pass' || result.status === 'fail') {
            recordResult(STATE_PATH, key, {
                status: result.status,
                ts: new Date().toISOString(),
            });
        }
    }

    const finished = new Date().toISOString();
    const report = buildReport({
        network: 'testnet',
        master: deployment.jettonMaster,
        fingerprint,
        filter: filterLabel(filter),
        started,
        finished,
        scenarios: results,
    });
    const reportPath = writeReportJson(REPORTS_DIR, report);
    printStdoutSummary(report, reportPath);

    const failed = results.some((r) => r.status === 'fail' || r.status === 'error');
    return failed ? 1 : 0;
}

if (require.main === module) {
    main()
        .then((code) => process.exit(code))
        .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[testnet-scenarios] ${message}`);
            process.exit(1);
        });
}
