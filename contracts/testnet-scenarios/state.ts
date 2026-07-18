import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RunnerState, ScenarioStateEntry } from './types';

export const DEFAULT_STATE_FILENAME = '.testnet-scenario-state.json';

export function defaultStatePath(contractsRoot: string): string {
    return resolve(contractsRoot, DEFAULT_STATE_FILENAME);
}

export function emptyState(deploymentFingerprint: string): RunnerState {
    return {
        version: 1,
        deploymentFingerprint,
        scenarios: {},
    };
}

export function loadState(statePath: string, deploymentFingerprint: string): RunnerState {
    if (!existsSync(statePath)) {
        return emptyState(deploymentFingerprint);
    }
    try {
        const raw = JSON.parse(readFileSync(statePath, 'utf8')) as RunnerState;
        if (raw.version !== 1 || typeof raw.scenarios !== 'object' || raw.scenarios === null) {
            return emptyState(deploymentFingerprint);
        }
        // Fingerprint change invalidates all skip entries.
        if (raw.deploymentFingerprint !== deploymentFingerprint) {
            return emptyState(deploymentFingerprint);
        }
        return {
            version: 1,
            deploymentFingerprint,
            scenarios: raw.scenarios,
        };
    } catch {
        return emptyState(deploymentFingerprint);
    }
}

export function saveState(statePath: string, state: RunnerState): void {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Skip only previous pass under the same deployment fingerprint.
 * Fail never skipped. --force bypasses.
 */
export function shouldSkipScenario(
    scenarioId: string,
    state: RunnerState,
    opts: { force: boolean },
): { skip: boolean; reason?: string } {
    if (opts.force) {
        return { skip: false };
    }
    const entry = state.scenarios[scenarioId];
    if (!entry) {
        return { skip: false };
    }
    if (entry.status === 'fail') {
        return { skip: false };
    }
    if (entry.status === 'pass') {
        return { skip: true, reason: 'already passed under current deployment fingerprint' };
    }
    return { skip: false };
}

export function recordScenarioResult(
    state: RunnerState,
    scenarioId: string,
    entry: ScenarioStateEntry,
): RunnerState {
    return {
        ...state,
        scenarios: {
            ...state.scenarios,
            [scenarioId]: entry,
        },
    };
}

export function listFailedScenarioIds(state: RunnerState): string[] {
    return Object.entries(state.scenarios)
        .filter(([, e]) => e.status === 'fail')
        .map(([id]) => id)
        .sort((a, b) => a.localeCompare(b));
}
