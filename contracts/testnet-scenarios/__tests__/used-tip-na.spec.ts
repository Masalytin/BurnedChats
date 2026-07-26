/**
 * IMP-TNFS-F14 — honest N/A / tolerances for the "used" lab tip
 * (admin revoked to zero address, vaults drained, supply burned by fee legs).
 * Lab manifest softens expected used-tip states; shared manifest stays strict.
 */
import { describe, expect, it } from '@jest/globals';
import { Address } from '@ton/core';
import { check } from '../lib/checks';
import {
    NA_LAB_TIP_ADMIN_REVOKED,
    ZERO_ADDRESS,
    applyAdminRevokedNa,
    isJettonAdminRevoked,
} from '../scenarios/fs-gov-role-checks';
import {
    USED_LAB_TIP_TOLERANCE,
    checkHolderBalanceForTip,
    checkJettonAdminForTip,
    checkTotalSupplyForTip,
} from '../scenarios/fs-ops-deployment-fingerprint';

const addr = (n: number) => new Address(0, Buffer.alloc(32, n));

const NANO = 10n ** 9n;
const MAX_SUPPLY = 1000n * NANO;

describe('IMP-TNFS-F14 lab-tip-admin-revoked soft N/A', () => {
    it('detects the canonical zero address', () => {
        expect(isJettonAdminRevoked(ZERO_ADDRESS)).toBe(true);
        expect(isJettonAdminRevoked(new Address(0, Buffer.alloc(32, 0)))).toBe(true);
        expect(isJettonAdminRevoked(addr(1))).toBe(false);
    });

    it('softens a failing jetton-admin-is-timelock on lab when admin revoked', () => {
        const failing = [
            check('jetton-admin-is-timelock', false, 'jetton adminAddress equals timelock'),
            check('staking-governor-matches', true, 'ok'),
        ];
        const softened = applyAdminRevokedNa(failing, ZERO_ADDRESS, 'lab');
        const adminCheck = softened.find((c) => c.name === 'jetton-admin-is-timelock')!;
        expect(adminCheck.ok).toBe(true);
        expect(adminCheck.message).toContain(`N/A: ${NA_LAB_TIP_ADMIN_REVOKED}`);
        // Other checks pass through untouched.
        expect(softened.find((c) => c.name === 'staking-governor-matches')).toEqual(failing[1]);
    });

    it('keeps shared manifest strict even with a zero admin', () => {
        const failing = [check('jetton-admin-is-timelock', false, 'mismatch')];
        expect(applyAdminRevokedNa(failing, ZERO_ADDRESS, 'shared')).toEqual(failing);
    });

    it('does not soften when admin is a real (non-zero) wrong address', () => {
        const failing = [check('jetton-admin-is-timelock', false, 'mismatch')];
        expect(applyAdminRevokedNa(failing, addr(7), 'lab')).toEqual(failing);
    });

    it('leaves passing checks and other check names unchanged', () => {
        const checks = [
            check('jetton-admin-is-timelock', true, 'jetton adminAddress equals timelock'),
            check('supply-unchanged-after-rogue', false, 'supply grew'),
        ];
        expect(applyAdminRevokedNa(checks, ZERO_ADDRESS, 'lab')).toEqual(checks);
    });
});

describe('IMP-TNFS-F14 fingerprint used-lab-tip tolerances', () => {
    it('total-supply: lab tolerates burns (0 < supply ≤ initial), rejects overflow/zero', () => {
        const burned = checkTotalSupplyForTip('lab', 999_701_000_000n);
        expect(burned.ok).toBe(true);
        expect(burned.message).toContain(USED_LAB_TIP_TOLERANCE);

        expect(checkTotalSupplyForTip('lab', MAX_SUPPLY).ok).toBe(true);
        expect(checkTotalSupplyForTip('lab', MAX_SUPPLY + 1n).ok).toBe(false);
        expect(checkTotalSupplyForTip('lab', 0n).ok).toBe(false);
    });

    it('total-supply: shared stays strict equality', () => {
        expect(checkTotalSupplyForTip('shared', MAX_SUPPLY).ok).toBe(true);
        expect(checkTotalSupplyForTip('shared', 999_701_000_000n).ok).toBe(false);
    });

    it('holder balances: lab tolerates drain/distribution (≤ initial), shared strict', () => {
        const expected = 200n * NANO;
        // Airdrop distributed 160 vs 200; vault drained to 0 — both fine on lab.
        expect(
            checkHolderBalanceForTip('lab', 'mint-Community airdrop', 'Community airdrop', 160n * NANO, expected).ok,
        ).toBe(true);
        expect(
            checkHolderBalanceForTip('lab', 'vesting-dev-balance', 'vesting developer vault', 0n, 7n * NANO).ok,
        ).toBe(true);
        // Over-mint must still fail on lab.
        expect(
            checkHolderBalanceForTip('lab', 'mint-Community airdrop', 'Community airdrop', expected + 1n, expected).ok,
        ).toBe(false);
        // Shared stays strict.
        expect(
            checkHolderBalanceForTip('shared', 'mint-Community airdrop', 'Community airdrop', 160n * NANO, expected).ok,
        ).toBe(false);
        expect(
            checkHolderBalanceForTip('shared', 'mint-Community airdrop', 'Community airdrop', expected, expected).ok,
        ).toBe(true);
    });

    it('jetton-admin: lab + revoked → soft N/A; shared + revoked → FAIL; lab non-zero mismatch → FAIL', () => {
        const timelock = addr(1);

        const labRevoked = checkJettonAdminForTip('lab', ZERO_ADDRESS, timelock);
        expect(labRevoked.ok).toBe(true);
        expect(labRevoked.message).toContain(`N/A: ${NA_LAB_TIP_ADMIN_REVOKED}`);

        expect(checkJettonAdminForTip('shared', ZERO_ADDRESS, timelock).ok).toBe(false);
        expect(checkJettonAdminForTip('lab', addr(7), timelock).ok).toBe(false);
        expect(checkJettonAdminForTip('lab', timelock, timelock).ok).toBe(true);
        expect(checkJettonAdminForTip('shared', timelock, timelock).ok).toBe(true);
    });
});
