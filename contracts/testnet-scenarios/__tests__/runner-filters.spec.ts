import { describe, expect, it } from '@jest/globals';
import { selectScenarios } from '../registry';
import type { Scenario } from '../types';

function scenario(partial: Pick<Scenario, 'id' | 'tags'> & Partial<Scenario>): Scenario {
    return {
        title: partial.id,
        description: partial.id,
        needsLiveTx: false,
        run: async () => [],
        ...partial,
    };
}

const catalog: Scenario[] = [
    scenario({ id: 'deployment-smoke', tags: ['readonly'] }),
    scenario({ id: 'transfer-burn-1pct', tags: ['burn'] }),
    scenario({ id: 'close-mint-irreversible', tags: ['admin', 'destructive'] }),
    scenario({ id: 'revoke-admin', tags: ['admin', 'destructive', 'burn'] }),
];

describe('selectScenarios', () => {
    it('--all never selects destructive scenarios', () => {
        const selected = selectScenarios(catalog, { all: true });
        expect(selected.map((s) => s.id).sort()).toEqual(['deployment-smoke', 'transfer-burn-1pct']);
        expect(selected.every((s) => !s.tags.includes('destructive'))).toBe(true);
    });

    it('--tag burn never selects destructive scenarios even when they also tag burn', () => {
        const selected = selectScenarios(catalog, { tag: 'burn' });
        expect(selected.map((s) => s.id)).toEqual(['transfer-burn-1pct']);
        expect(selected.some((s) => s.tags.includes('destructive'))).toBe(false);
    });

    it('--tag destructive selects only destructive scenarios', () => {
        const selected = selectScenarios(catalog, { tag: 'destructive' });
        expect(selected.map((s) => s.id).sort()).toEqual(['close-mint-irreversible', 'revoke-admin']);
    });

    it('--scenario <id> can select a destructive scenario by id', () => {
        const selected = selectScenarios(catalog, { scenario: 'close-mint-irreversible' });
        expect(selected.map((s) => s.id)).toEqual(['close-mint-irreversible']);
    });

    it('--scenario <id> selects a single non-destructive scenario', () => {
        const selected = selectScenarios(catalog, { scenario: 'transfer-burn-1pct' });
        expect(selected.map((s) => s.id)).toEqual(['transfer-burn-1pct']);
    });

    it('--failed-only keeps only scenarios with prior fail status', () => {
        const failedIds = new Set(['transfer-burn-1pct', 'close-mint-irreversible']);
        const selected = selectScenarios(catalog, { all: true, failedOnly: true }, failedIds);
        expect(selected.map((s) => s.id)).toEqual(['transfer-burn-1pct']);
    });
});
