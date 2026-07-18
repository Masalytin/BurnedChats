import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { Address } from '@ton/core';
import {
    ADMIN_SCENARIO_IDS,
    DESTRUCTIVE_ADMIN_IDS,
    isRevokedAdmin,
    MAX_SUPPLY_NANO,
    NA_MINT_CLOSED,
    NA_SHARED_DESTRUCTIVE,
    naWhenSharedDestructive,
    OVER_CAP_MINT_AMOUNT_NANO,
    REVOKED_ADMIN_ADDRESS,
} from '../lib/jetton-admin';
import { defaultScenariosDir, discoverScenarios, isDestructive } from '../registry';
import { selectScenarios } from '../runner';
import { emptyState } from '../state';
import type { ScenarioContext } from '../types';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const EXPECTED_TAGS: Record<(typeof ADMIN_SCENARIO_IDS)[number], string[]> = {
    'fs-jetton-mint-admin-ok': ['jetton', 'admin'],
    'fs-jetton-mint-non-admin-reject': ['jetton', 'admin'],
    'fs-jetton-mint-over-cap-reject': ['jetton', 'admin'],
    'fs-jetton-close-mint': ['jetton', 'admin', 'destructive'],
    'fs-jetton-revoke-admin': ['jetton', 'admin', 'destructive'],
};

const LIVE_TX: Record<(typeof ADMIN_SCENARIO_IDS)[number], boolean> = {
    'fs-jetton-mint-admin-ok': true,
    'fs-jetton-mint-non-admin-reject': true,
    'fs-jetton-mint-over-cap-reject': true,
    'fs-jetton-close-mint': true,
    'fs-jetton-revoke-admin': true,
};

const DESTRUCTIVE_FLAG: Record<(typeof ADMIN_SCENARIO_IDS)[number], boolean> = {
    'fs-jetton-mint-admin-ok': false,
    'fs-jetton-mint-non-admin-reject': false,
    'fs-jetton-mint-over-cap-reject': false,
    'fs-jetton-close-mint': true,
    'fs-jetton-revoke-admin': true,
};

describe('IMP-TNFS-05 jetton admin lifecycle — discovery & tags', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers all 5 admin scenario ids', () => {
        for (const id of ADMIN_SCENARIO_IDS) {
            expect(byId.get(id)).toBeDefined();
        }
    });

    it('tags / destructive / needsLiveTx match DESIGN', () => {
        for (const id of ADMIN_SCENARIO_IDS) {
            const s = byId.get(id)!;
            expect(s.tags).toEqual(expect.arrayContaining(EXPECTED_TAGS[id]));
            expect(s.needsLiveTx).toBe(LIVE_TX[id]);
            expect(!!s.destructive).toBe(DESTRUCTIVE_FLAG[id]);
            expect(isDestructive(s)).toBe(DESTRUCTIVE_FLAG[id]);
        }
        expect(byId.get('fs-jetton-close-mint')!.tags).toContain('destructive');
        expect(byId.get('fs-jetton-revoke-admin')!.tags).toContain('destructive');
    });

    it('lab order: revoke-admin depends_on close-mint', () => {
        expect(byId.get('fs-jetton-revoke-admin')!.depends_on).toContain('fs-jetton-close-mint');
        expect(byId.get('fs-jetton-close-mint')!.depends_on).toContain('fs-jetton-mint-admin-ok');
    });

    it('--all never selects destructive close/revoke (regression)', () => {
        const state = emptyState('fp');
        const byAll = selectScenarios(scenarios, { mode: 'all' }, state).map((s) => s.id);
        for (const id of DESTRUCTIVE_ADMIN_IDS) {
            expect(byAll).not.toContain(id);
        }
        // Non-destructive admin ids remain selectable via --all
        expect(byAll).toContain('fs-jetton-mint-admin-ok');
        expect(byAll).toContain('fs-jetton-mint-non-admin-reject');
        expect(byAll).toContain('fs-jetton-mint-over-cap-reject');
    });

    it('--tag destructive selects close-mint and revoke-admin', () => {
        const state = emptyState('fp');
        const byTag = selectScenarios(scenarios, { mode: 'tag', tag: 'destructive' }, state).map(
            (s) => s.id,
        );
        expect(byTag).toEqual(expect.arrayContaining([...DESTRUCTIVE_ADMIN_IDS]));
        expect(byTag).not.toContain('fs-jetton-mint-admin-ok');
    });

    it('--tag admin selects all five', () => {
        const state = emptyState('fp');
        const byTag = selectScenarios(scenarios, { mode: 'tag', tag: 'admin' }, state).map(
            (s) => s.id,
        );
        for (const id of ADMIN_SCENARIO_IDS) {
            expect(byTag).toContain(id);
        }
    });

    it('naWhen wired for mint/close/revoke; non-admin has none', () => {
        expect(typeof byId.get('fs-jetton-mint-admin-ok')!.naWhen).toBe('function');
        expect(typeof byId.get('fs-jetton-mint-over-cap-reject')!.naWhen).toBe('function');
        expect(typeof byId.get('fs-jetton-close-mint')!.naWhen).toBe('function');
        expect(typeof byId.get('fs-jetton-revoke-admin')!.naWhen).toBe('function');
        expect(byId.get('fs-jetton-mint-non-admin-reject')!.naWhen).toBeUndefined();
    });

    it('does not register TOKSIM / TNSCEN / pure-1%-burn ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids).not.toContain('transfer-burn-1pct');
        expect(ids).not.toContain('mint-admin-ok');
        expect(ids).not.toContain('close-mint-irreversible');
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
        expect(ids.some((id) => id.includes('tnscen'))).toBe(false);
    });
});

describe('IMP-TNFS-05 jetton-admin helpers — N/A policy', () => {
    it('shared destructive always N/A with explicit reason', () => {
        const sharedCtx = {
            manifestKind: 'shared',
        } as ScenarioContext;
        expect(naWhenSharedDestructive(sharedCtx)).toBe(NA_SHARED_DESTRUCTIVE);

        const labCtx = { manifestKind: 'lab' } as ScenarioContext;
        expect(naWhenSharedDestructive(labCtx)).toBeNull();
    });

    it('revoked admin sentinel detection', () => {
        expect(isRevokedAdmin(REVOKED_ADMIN_ADDRESS)).toBe(true);
        expect(isRevokedAdmin(Address.parse('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N'))).toBe(
            false,
        );
    });

    it('over-cap amount exceeds MAX_SUPPLY', () => {
        expect(OVER_CAP_MINT_AMOUNT_NANO).toBe(MAX_SUPPLY_NANO + 1n);
        expect(MAX_SUPPLY_NANO).toBe(1000n * 10n ** 9n);
    });

    it('lab tip artifact exists (destructive pack prerequisite)', () => {
        const labPath = resolve(CONTRACTS_ROOT, 'deployments/testnet-lab.json');
        expect(existsSync(labPath)).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const lab = require(labPath) as {
            role?: string;
            lab?: { mintableAdmin?: boolean };
        };
        expect(lab.role).toBe('lab');
        expect(lab.lab?.mintableAdmin).toBe(true);
    });

    it('NA reason strings are non-empty (report-friendly)', () => {
        expect(NA_SHARED_DESTRUCTIVE.length).toBeGreaterThan(10);
        expect(NA_MINT_CLOSED.length).toBeGreaterThan(10);
    });
});
