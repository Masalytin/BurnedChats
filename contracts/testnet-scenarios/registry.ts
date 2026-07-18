import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CliFilter, Scenario } from './types';

const DESTRUCTIVE_TAG = 'destructive';

function isScenario(value: unknown): value is Scenario {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const s = value as Partial<Scenario>;
    return (
        typeof s.id === 'string' &&
        typeof s.title === 'string' &&
        typeof s.description === 'string' &&
        Array.isArray(s.tags) &&
        typeof s.needsLiveTx === 'boolean' &&
        typeof s.run === 'function'
    );
}

function loadScenarioModule(filePath: string): Scenario | null {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(filePath) as Record<string, unknown>;
    if (isScenario(mod.default)) {
        return mod.default;
    }
    if (isScenario(mod.scenario)) {
        return mod.scenario;
    }
    for (const value of Object.values(mod)) {
        if (isScenario(value)) {
            return value;
        }
    }
    return null;
}

/**
 * Runtime discovery: every `scenarios/*.ts` (except tests / declarations) may export a Scenario.
 * Keeps later cards from fighting over a static registry file.
 */
export function discoverScenarios(scenariosDir: string): Scenario[] {
    if (!existsSync(scenariosDir)) {
        return [];
    }
    const files = readdirSync(scenariosDir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.spec.ts'))
        .sort();
    const out: Scenario[] = [];
    const seen = new Set<string>();
    for (const name of files) {
        const filePath = join(scenariosDir, name);
        const scenario = loadScenarioModule(filePath);
        if (!scenario) {
            continue;
        }
        if (seen.has(scenario.id)) {
            throw new Error(`Duplicate scenario id "${scenario.id}" from ${name}`);
        }
        seen.add(scenario.id);
        out.push(scenario);
    }
    return out;
}

export type SelectOptions = Pick<CliFilter, 'scenario' | 'tag' | 'all' | 'failedOnly'>;

/**
 * Apply CLI filters. Policy (Q2=B):
 * - `--all` and `--tag <t>` (when t !== 'destructive') never include `destructive`
 * - `destructive` only via `--tag destructive` or `--scenario <id>`
 */
export function selectScenarios(
    scenarios: Scenario[],
    opts: SelectOptions,
    failedOnlyIds?: Set<string>,
): Scenario[] {
    let selected: Scenario[];

    if (opts.scenario) {
        const found = scenarios.find((s) => s.id === opts.scenario);
        if (!found) {
            throw new Error(`Unknown scenario id: ${opts.scenario}`);
        }
        selected = [found];
    } else if (opts.tag) {
        if (opts.tag === DESTRUCTIVE_TAG) {
            selected = scenarios.filter((s) => s.tags.includes(DESTRUCTIVE_TAG));
        } else {
            selected = scenarios.filter(
                (s) => s.tags.includes(opts.tag!) && !s.tags.includes(DESTRUCTIVE_TAG),
            );
        }
    } else if (opts.all) {
        selected = scenarios.filter((s) => !s.tags.includes(DESTRUCTIVE_TAG));
    } else {
        selected = [];
    }

    if (opts.failedOnly) {
        if (!failedOnlyIds) {
            throw new Error('--failed-only requires a prior-fail id set');
        }
        selected = selected.filter((s) => failedOnlyIds.has(s.id));
    }

    return selected;
}

export function formatScenarioList(scenarios: Scenario[]): string {
    if (scenarios.length === 0) {
        return 'No scenarios registered (add files under testnet-scenarios/scenarios/).';
    }
    const lines = scenarios.map((s) => {
        const tags = s.tags.length > 0 ? s.tags.join(',') : '-';
        const live = s.needsLiveTx ? 'live-tx' : 'readonly';
        return `  ${s.id}\t[${tags}]\t${live}\t${s.title}`;
    });
    return [`Scenarios (${scenarios.length}):`, ...lines].join('\n');
}
