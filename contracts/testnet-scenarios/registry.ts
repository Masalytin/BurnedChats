import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Scenario } from './types';

function isScenario(value: unknown): value is Scenario {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const s = value as Partial<Scenario>;
    return (
        typeof s.id === 'string' &&
        s.id.length > 0 &&
        typeof s.title === 'string' &&
        typeof s.description === 'string' &&
        Array.isArray(s.tags) &&
        typeof s.needsLiveTx === 'boolean' &&
        typeof s.run === 'function'
    );
}

function extractScenario(mod: Record<string, unknown>, file: string): Scenario {
    const candidate = mod.default ?? mod.scenario ?? mod;
    if (isScenario(candidate)) {
        return candidate;
    }
    // Named export: first Scenario-shaped export
    for (const value of Object.values(mod)) {
        if (isScenario(value)) {
            return value;
        }
    }
    throw new Error(`Scenario module ${file} does not export a Scenario`);
}

/**
 * Runtime discovery: load every `scenarios/*.ts` file.
 * Empty directory is valid (harness-only card; scenarios land in later cards).
 */
export function discoverScenarios(scenariosDir: string): Scenario[] {
    const dir = resolve(scenariosDir);
    if (!existsSync(dir)) {
        return [];
    }
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.spec.ts'))
        .sort((a, b) => a.localeCompare(b));

    const scenarios: Scenario[] = [];
    const seen = new Set<string>();

    for (const file of files) {
        const fullPath = join(dir, file);
        // Dynamic require keeps discovery open for parallel scenario cards.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(fullPath) as Record<string, unknown>;
        const scenario = extractScenario(mod, file);
        if (seen.has(scenario.id)) {
            throw new Error(`Duplicate scenario id "${scenario.id}" (from ${file})`);
        }
        seen.add(scenario.id);
        scenarios.push(scenario);
    }

    return scenarios.sort((a, b) => a.id.localeCompare(b.id));
}

export function defaultScenariosDir(contractsRoot: string): string {
    return resolve(contractsRoot, 'testnet-scenarios', 'scenarios');
}

export function isDestructive(scenario: Scenario): boolean {
    return scenario.destructive === true || scenario.tags.includes('destructive');
}

/** Soft topological order by depends_on (missing deps ignored; cycles broken by id). */
export function orderByDependsOn(scenarios: Scenario[]): Scenario[] {
    const byId = new Map(scenarios.map((s) => [s.id, s]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const out: Scenario[] = [];

    function visit(id: string): void {
        if (done.has(id) || !byId.has(id)) {
            return;
        }
        if (visiting.has(id)) {
            return; // cycle: skip further deps
        }
        visiting.add(id);
        const s = byId.get(id)!;
        for (const dep of s.depends_on ?? []) {
            visit(dep);
        }
        visiting.delete(id);
        done.add(id);
        out.push(s);
    }

    for (const s of scenarios) {
        visit(s.id);
    }
    return out;
}
