import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Address } from '@ton/core';
import { resolveTimelockGovernor } from '../scripts/deploy/bootstrap';

const DEPLOYER = new Address(0, Buffer.alloc(32, 1));
const MULTISIG = new Address(0, Buffer.alloc(32, 2));

const ENV_KEYS = ['TIMELOCK_GOVERNOR', 'TIMELOCK_GOVERNOR_MULTISIG'] as const;

describe('resolveTimelockGovernor (PARAMETERS §2 B)', () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    it('lab path: defaults to deployer when env unset', () => {
        expect(resolveTimelockGovernor(DEPLOYER, { requireMultisig: false }).equals(DEPLOYER)).toBe(
            true,
        );
    });

    it('mainnet path: throws when env unset', () => {
        expect(() => resolveTimelockGovernor(DEPLOYER, { requireMultisig: true })).toThrow(
            /TIMELOCK_GOVERNOR unset/,
        );
    });

    it('uses TIMELOCK_GOVERNOR when set', () => {
        process.env.TIMELOCK_GOVERNOR = MULTISIG.toString({ urlSafe: true, bounceable: true });
        expect(resolveTimelockGovernor(DEPLOYER, { requireMultisig: true }).equals(MULTISIG)).toBe(
            true,
        );
    });

    it('accepts TIMELOCK_GOVERNOR_MULTISIG alias', () => {
        process.env.TIMELOCK_GOVERNOR_MULTISIG = MULTISIG.toString({
            urlSafe: true,
            bounceable: true,
        });
        expect(resolveTimelockGovernor(DEPLOYER, { requireMultisig: true }).equals(MULTISIG)).toBe(
            true,
        );
    });
});
