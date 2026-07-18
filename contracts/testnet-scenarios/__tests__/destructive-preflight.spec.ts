import { Address } from '@ton/core';
import { describe, expect, it } from '@jest/globals';
import {
    MINT_OVER_CAP_NANO,
    MINT_PROBE_NANO,
    MAX_SUPPLY_NANO,
    NANO_PER_BURN,
    ScenarioSkipError,
    checkMintableEquals,
    checkSupplyDelta,
    evaluateDestructivePreflight,
    isScenarioSkipError,
    skipResultFromError,
} from '../lib/destructive-preflight';

const ADMIN = new Address(0, Buffer.alloc(32, 1));
const OTHER = new Address(0, Buffer.alloc(32, 2));

function snap(partial: { mintable: boolean; admin?: Address; supply?: bigint }) {
    return {
        mintable: partial.mintable,
        adminAddress: partial.admin ?? ADMIN,
        totalSupply: partial.supply ?? 0n,
    };
}

describe('evaluateDestructivePreflight', () => {
    it('skips mint-ops when mintable is false with explicit N/A reason', () => {
        const result = evaluateDestructivePreflight(snap({ mintable: false }), ADMIN, 'mint-ops');
        expect(result.action).toBe('skip');
        if (result.action === 'skip') {
            expect(result.reason).toMatch(/^N\/A:/);
            expect(result.reason).toMatch(/mintable/i);
        }
    });

    it('skips close-mint when mintable is already false', () => {
        const result = evaluateDestructivePreflight(snap({ mintable: false }), ADMIN, 'close-mint');
        expect(result.action).toBe('skip');
        if (result.action === 'skip') {
            expect(result.reason).toMatch(/mintable/i);
        }
    });

    it('skips when sender is not the on-chain admin', () => {
        const result = evaluateDestructivePreflight(snap({ mintable: true }), OTHER, 'mint-ops');
        expect(result.action).toBe('skip');
        if (result.action === 'skip') {
            expect(result.reason).toMatch(/^N\/A:/);
            expect(result.reason).toMatch(/admin/i);
        }
    });

    it('skips when sender address is unavailable', () => {
        const result = evaluateDestructivePreflight(snap({ mintable: true }), null, 'close-mint');
        expect(result.action).toBe('skip');
        if (result.action === 'skip') {
            expect(result.reason).toMatch(/sender/i);
        }
    });

    it('proceeds for mint-ops when mintable and sender is admin', () => {
        expect(evaluateDestructivePreflight(snap({ mintable: true }), ADMIN, 'mint-ops')).toEqual({
            action: 'proceed',
        });
    });

    it('skips revoke-admin while mint is still open (recommended order)', () => {
        const result = evaluateDestructivePreflight(snap({ mintable: true }), ADMIN, 'revoke-admin');
        expect(result.action).toBe('skip');
        if (result.action === 'skip') {
            expect(result.reason).toMatch(/close-mint|mintable|order/i);
        }
    });

    it('skips revoke-admin when admin is already inaccessible (not sender)', () => {
        const result = evaluateDestructivePreflight(
            snap({ mintable: false, admin: OTHER }),
            ADMIN,
            'revoke-admin',
        );
        expect(result.action).toBe('skip');
        if (result.action === 'skip') {
            expect(result.reason).toMatch(/admin/i);
        }
    });

    it('proceeds for revoke-admin when mint closed and sender is admin', () => {
        expect(
            evaluateDestructivePreflight(snap({ mintable: false }), ADMIN, 'revoke-admin'),
        ).toEqual({ action: 'proceed' });
    });
});

describe('admin lifecycle outcome helpers (sandbox mirrors)', () => {
    it('in-cap mint expects +1 BURN supply delta', () => {
        const before = 10n * NANO_PER_BURN;
        const after = before + MINT_PROBE_NANO;
        expect(checkSupplyDelta(before, after, MINT_PROBE_NANO, 'admin mint').ok).toBe(true);
    });

    it('rejected mint expects unchanged supply (non-admin / over-cap / post-close)', () => {
        const supply = 50n * NANO_PER_BURN;
        expect(checkSupplyDelta(supply, supply, 0n, 'rejected').ok).toBe(true);
        expect(checkSupplyDelta(supply, supply + 1n, 0n, 'rejected').ok).toBe(false);
    });

    it('over-cap amount is 1001 BURN; hard cap is 1000 BURN', () => {
        expect(MINT_OVER_CAP_NANO).toBe(1001n * NANO_PER_BURN);
        expect(MAX_SUPPLY_NANO).toBe(1000n * NANO_PER_BURN);
        expect(MINT_OVER_CAP_NANO).toBeGreaterThan(MAX_SUPPLY_NANO);
    });

    it('close-mint expects mintable=false', () => {
        expect(checkMintableEquals(false, false).ok).toBe(true);
        expect(checkMintableEquals(true, false).ok).toBe(false);
    });
});

describe('ScenarioSkipError → report status skip', () => {
    it('isScenarioSkipError recognizes ScenarioSkipError', () => {
        const err = new ScenarioSkipError('N/A: mintable=false');
        expect(isScenarioSkipError(err)).toBe(true);
        expect(isScenarioSkipError(new Error('boom'))).toBe(false);
    });

    it('skipResultFromError builds status skip (not pass) with reason', () => {
        const err = new ScenarioSkipError('N/A: mintable=false — CloseMint already applied');
        const result = skipResultFromError('mint-admin-ok', err, 12);
        expect(result.status).toBe('skip');
        expect(result.status).not.toBe('pass');
        expect(result.id).toBe('mint-admin-ok');
        expect(result.error).toMatch(/mintable/i);
        expect(result.checks.some((c) => c.message.includes('N/A'))).toBe(true);
        expect(result.txUrls).toEqual([]);
    });
});
