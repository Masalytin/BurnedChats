import { describe, expect, it } from '@jest/globals';
import { isDestructive } from '../registry';
import { parseCliArgs, selectScenarios } from '../runner';
import { emptyState } from '../state';
import type { Scenario } from '../types';

function stubScenario(partial: Partial<Scenario> & Pick<Scenario, 'id' | 'tags'>): Scenario {
    return {
        title: partial.title ?? partial.id,
        description: partial.description ?? '',
        needsLiveTx: partial.needsLiveTx ?? false,
        destructive: partial.destructive,
        depends_on: partial.depends_on,
        run: partial.run ?? (async () => [{ ok: true, name: 'ok', message: 'ok' }]),
        ...partial,
    };
}

const CATALOG: Scenario[] = [
    stubScenario({ id: 'fs-jetton-fee-split', tags: ['jetton', 'fee'] }),
    stubScenario({ id: 'fs-jetton-master-smoke', tags: ['jetton', 'readonly'] }),
    stubScenario({
        id: 'fs-jetton-close-mint',
        tags: ['jetton', 'admin', 'destructive'],
        destructive: true,
    }),
    stubScenario({
        id: 'fs-vesting-emergency-revoke',
        tags: ['vesting', 'destructive'],
        destructive: true,
    }),
    stubScenario({ id: 'fs-staking-stake-happy', tags: ['staking'] }),
];

describe('parseCliArgs', () => {
    it('parses --list and default shared manifest', () => {
        const opts = parseCliArgs(['--list']);
        expect(opts.mode).toBe('list');
        expect(opts.manifest).toBe('shared');
        expect(opts.force).toBe(false);
        expect(opts.requestedMainnet).toBe(false);
    });

    it('parses --manifest lab', () => {
        const opts = parseCliArgs(['--all', '--manifest', 'lab']);
        expect(opts.mode).toBe('all');
        expect(opts.manifest).toBe('lab');
    });

    it('detects --mainnet', () => {
        const opts = parseCliArgs(['--list', '--mainnet']);
        expect(opts.requestedMainnet).toBe(true);
    });

    it('parses --scenario / --tag / --failed-only / --force', () => {
        expect(parseCliArgs(['--scenario', 'fs-jetton-fee-split']).scenarioId).toBe('fs-jetton-fee-split');
        expect(parseCliArgs(['--tag', 'staking']).tag).toBe('staking');
        expect(parseCliArgs(['--failed-only']).mode).toBe('failed-only');
        expect(parseCliArgs(['--all', '--force']).force).toBe(true);
    });
});

describe('selectScenarios filters', () => {
    const state = emptyState('fp');

    it('--all never selects destructive', () => {
        const selected = selectScenarios(CATALOG, { mode: 'all' }, state);
        expect(selected.every((s) => !isDestructive(s))).toBe(true);
        expect(selected.map((s) => s.id)).not.toContain('fs-jetton-close-mint');
        expect(selected.map((s) => s.id)).not.toContain('fs-vesting-emergency-revoke');
        expect(selected.map((s) => s.id)).toEqual(
            expect.arrayContaining(['fs-jetton-fee-split', 'fs-staking-stake-happy']),
        );
    });

    it('--tag destructive selects destructive pack', () => {
        const selected = selectScenarios(CATALOG, { mode: 'tag', tag: 'destructive' }, state);
        expect(selected.map((s) => s.id).sort()).toEqual([
            'fs-jetton-close-mint',
            'fs-vesting-emergency-revoke',
        ]);
    });

    it('--scenario selects explicit destructive id', () => {
        const selected = selectScenarios(
            CATALOG,
            { mode: 'scenario', scenarioId: 'fs-jetton-close-mint' },
            state,
        );
        expect(selected).toHaveLength(1);
        expect(selected[0]!.id).toBe('fs-jetton-close-mint');
    });

    it('--tag staking filters by tag', () => {
        const selected = selectScenarios(CATALOG, { mode: 'tag', tag: 'staking' }, state);
        expect(selected.map((s) => s.id)).toEqual(['fs-staking-stake-happy']);
    });

    it('--failed-only selects only previously failed ids', () => {
        const failedState = {
            version: 1 as const,
            deploymentFingerprint: 'fp',
            scenarios: {
                'fs-jetton-fee-split': { status: 'fail' as const, ts: '2026-01-01T00:00:00.000Z' },
                'fs-staking-stake-happy': { status: 'pass' as const, ts: '2026-01-01T00:00:00.000Z' },
            },
        };
        const selected = selectScenarios(CATALOG, { mode: 'failed-only' }, failedState);
        expect(selected.map((s) => s.id)).toEqual(['fs-jetton-fee-split']);
    });
});
