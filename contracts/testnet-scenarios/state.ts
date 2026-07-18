import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SkipEntry, SkipState } from './types';

export function buildSkipKey(jettonMaster: string, fingerprint: string, scenarioId: string): string {
    return `${jettonMaster}|${fingerprint}|${scenarioId}`;
}

export function emptyState(): SkipState {
    return { entries: {} };
}

export function loadState(statePath: string): SkipState {
    if (!existsSync(statePath)) {
        return emptyState();
    }
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || !('entries' in raw)) {
        return emptyState();
    }
    const entries = (raw as SkipState).entries;
    if (!entries || typeof entries !== 'object') {
        return emptyState();
    }
    return { entries };
}

export function saveState(statePath: string, state: SkipState): void {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function recordResult(statePath: string, key: string, entry: SkipEntry): SkipState {
    const state = loadState(statePath);
    state.entries[key] = entry;
    saveState(statePath, state);
    return state;
}

export function shouldSkip(
    state: SkipState,
    key: string,
    opts: { force: boolean },
): boolean {
    if (opts.force) {
        return false;
    }
    const entry = state.entries[key];
    return entry?.status === 'pass';
}

/** Scenario ids that previously finished with status fail (for --failed-only). */
export function failedScenarioIds(
    state: SkipState,
    jettonMaster: string,
    fingerprint: string,
    scenarioIds: string[],
): Set<string> {
    const failed = new Set<string>();
    for (const id of scenarioIds) {
        const key = buildSkipKey(jettonMaster, fingerprint, id);
        if (state.entries[key]?.status === 'fail') {
            failed.add(id);
        }
    }
    return failed;
}
