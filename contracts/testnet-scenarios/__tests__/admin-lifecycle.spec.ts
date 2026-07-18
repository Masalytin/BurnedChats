import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { discoverScenarios, selectScenarios } from '../registry';

const SCENARIOS_DIR = resolve(__dirname, '../scenarios');

const DESTRUCTIVE_IDS = [
    'mint-admin-ok',
    'mint-non-admin-reject',
    'mint-over-cap-reject',
    'close-mint-irreversible',
    'revoke-admin',
] as const;

describe('IMP-TNSCEN-04 admin lifecycle — discovery & tags', () => {
    it('registers all five destructive admin scenario ids', () => {
        const byId = Object.fromEntries(discoverScenarios(SCENARIOS_DIR).map((s) => [s.id, s]));
        for (const id of DESTRUCTIVE_IDS) {
            expect(byId[id]).toBeDefined();
        }
    });

    it('each id has tags destructive+admin and needsLiveTx', () => {
        const byId = Object.fromEntries(discoverScenarios(SCENARIOS_DIR).map((s) => [s.id, s]));
        for (const id of DESTRUCTIVE_IDS) {
            expect(byId[id].tags).toEqual(expect.arrayContaining(['destructive', 'admin']));
            expect(byId[id].tags).toContain('destructive');
            expect(byId[id].needsLiveTx).toBe(true);
        }
    });

    it('--all and --tag burn never select destructive admin scenarios', () => {
        const all = discoverScenarios(SCENARIOS_DIR);
        const byAll = selectScenarios(all, { all: true }).map((s) => s.id);
        const byBurn = selectScenarios(all, { tag: 'burn' }).map((s) => s.id);

        for (const id of DESTRUCTIVE_IDS) {
            expect(byAll).not.toContain(id);
            expect(byBurn).not.toContain(id);
        }
    });

    it('--tag destructive selects all five; close/revoke not reachable via non-destructive filters', () => {
        const all = discoverScenarios(SCENARIOS_DIR);
        const byDestructive = selectScenarios(all, { tag: 'destructive' }).map((s) => s.id).sort();
        expect(byDestructive).toEqual([...DESTRUCTIVE_IDS].sort());

        const byAll = selectScenarios(all, { all: true }).map((s) => s.id);
        expect(byAll).not.toContain('close-mint-irreversible');
        expect(byAll).not.toContain('revoke-admin');
    });

    it('descriptions document recommended order mint* → close-mint → revoke', () => {
        const byId = Object.fromEntries(discoverScenarios(SCENARIOS_DIR).map((s) => [s.id, s]));
        for (const id of DESTRUCTIVE_IDS) {
            const text = `${byId[id].description} ${byId[id].title}`.toLowerCase();
            expect(
                text.includes('order') ||
                    text.includes('mint*') ||
                    text.includes('close-mint') ||
                    text.includes('revoke'),
            ).toBe(true);
        }
        expect(byId['close-mint-irreversible'].description.toLowerCase()).toMatch(/irreversible|warning|redeploy/);
        expect(byId['revoke-admin'].description.toLowerCase()).toMatch(/irreversible|warning|after close|order/);
    });
});
