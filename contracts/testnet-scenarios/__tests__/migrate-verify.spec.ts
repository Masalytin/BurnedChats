import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { defaultScenariosDir, discoverScenarios } from '../registry';
import { EXIT_FEE_CONFIG_INACTIVE, FEE_SPLIT_EXPECTED } from '../lib/balances';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

describe('IMP-TNFS-03 migrate verify scenarios', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers the four migrated scenario ids', () => {
        expect(scenarios.map((s) => s.id).sort()).toEqual(
            expect.arrayContaining([
                'fs-ops-deployment-fingerprint',
                'fs-jetton-fee-split',
                'fs-jetton-fee-split-readonly',
                'fs-jetton-fee-excluded-smoke',
            ]),
        );
        expect(byId.size).toBeGreaterThanOrEqual(4);
    });

    it('tags ops/jetton/fee/readonly correctly', () => {
        const ops = byId.get('fs-ops-deployment-fingerprint')!;
        expect(ops.tags).toEqual(expect.arrayContaining(['ops', 'readonly']));
        expect(ops.needsLiveTx).toBe(false);

        const live = byId.get('fs-jetton-fee-split')!;
        expect(live.tags).toEqual(expect.arrayContaining(['jetton', 'fee']));
        expect(live.tags).not.toContain('readonly');
        expect(live.needsLiveTx).toBe(true);

        const readonly = byId.get('fs-jetton-fee-split-readonly')!;
        expect(readonly.tags).toEqual(expect.arrayContaining(['jetton', 'fee', 'readonly']));
        expect(readonly.needsLiveTx).toBe(false);

        const excluded = byId.get('fs-jetton-fee-excluded-smoke')!;
        expect(excluded.tags).toEqual(expect.arrayContaining(['jetton', 'fee']));
        expect(excluded.needsLiveTx).toBe(false);
    });

    it('readonly fee-split needsLiveTx=false (Q4=A)', () => {
        expect(byId.get('fs-jetton-fee-split-readonly')!.needsLiveTx).toBe(false);
    });

    it('fee constants match full-stack 0.5/0.3/0.2 on 1 BURN', () => {
        expect(FEE_SPLIT_EXPECTED.net).toBe(990_000_000n);
        expect(FEE_SPLIT_EXPECTED.burn).toBe(5_000_000n);
        expect(FEE_SPLIT_EXPECTED.staking).toBe(3_000_000n);
        expect(FEE_SPLIT_EXPECTED.treasury).toBe(2_000_000n);
        expect(EXIT_FEE_CONFIG_INACTIVE).toBe(21507);
    });

    it('does not register TOKSIM / pure-1%-burn ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids).not.toContain('transfer-burn-1pct');
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
    });
});
