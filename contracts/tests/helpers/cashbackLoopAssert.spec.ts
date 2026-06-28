import { describe, expect, it } from '@jest/globals';
import { Address, beginCell } from '@ton/core';
import type { SendMessageResult } from '@ton/sandbox';

import {
    assertRelayFlowClean,
    countEmptyBodyHopsBetween,
    countEmptyGovernorStakingHops,
    countEmptyProposalStakingHops,
} from './cashbackLoopAssert';

type RelayTransactions = SendMessageResult['transactions'];

const ADDR_A = Address.parse('0:0000000000000000000000000000000000000000000000000000000000000000');
const ADDR_B = Address.parse('0:1111111111111111111111111111111111111111111111111111111111111111');
const ADDR_C = Address.parse('0:2222222222222222222222222222222222222222222222222222222222222222');

function mockInternalTx(
    from: Address,
    to: Address,
    emptyBody: boolean,
    exitCode = 0,
): RelayTransactions[number] {
    return {
        inMessage: {
            info: {
                type: 'internal',
                src: from,
                dest: to,
            },
            body: emptyBody ? beginCell().endCell() : beginCell().storeUint(0x5a040102, 32).endCell(),
        },
        description: {
            type: 'generic',
            computePhase: {
                type: 'vm',
                exitCode,
            },
        },
    } as RelayTransactions[number];
}

function mockExternalTx(): RelayTransactions[number] {
    return {
        inMessage: {
            info: { type: 'external-in' },
            body: beginCell().endCell(),
        },
        description: {
            type: 'generic',
            computePhase: { type: 'vm', exitCode: 0 },
        },
    } as RelayTransactions[number];
}

describe('countEmptyBodyHopsBetween', () => {
    it('counts only empty-body internal hops between the partner pair', () => {
        const txs: RelayTransactions = [
            mockInternalTx(ADDR_A, ADDR_B, true),
            mockInternalTx(ADDR_B, ADDR_A, true),
            mockInternalTx(ADDR_A, ADDR_B, false),
            mockInternalTx(ADDR_A, ADDR_C, true),
            mockInternalTx(ADDR_C, ADDR_B, true),
            mockExternalTx(),
        ];
        expect(countEmptyBodyHopsBetween(txs, ADDR_A, ADDR_B)).toBe(2);
    });

    it('returns 0 when no empty hops exist between partners', () => {
        const txs: RelayTransactions = [mockInternalTx(ADDR_A, ADDR_B, false)];
        expect(countEmptyBodyHopsBetween(txs, ADDR_A, ADDR_B)).toBe(0);
    });
});

describe('partner wrappers', () => {
    it('countEmptyGovernorStakingHops delegates to generic helper', () => {
        const txs: RelayTransactions = [mockInternalTx(ADDR_A, ADDR_B, true)];
        expect(countEmptyGovernorStakingHops(txs, ADDR_A, ADDR_B)).toBe(1);
        expect(countEmptyGovernorStakingHops(txs, ADDR_B, ADDR_A)).toBe(1);
    });

    it('countEmptyProposalStakingHops delegates to generic helper', () => {
        const txs: RelayTransactions = [
            mockInternalTx(ADDR_C, ADDR_B, true),
            mockInternalTx(ADDR_B, ADDR_C, false),
        ];
        expect(countEmptyProposalStakingHops(txs, ADDR_C, ADDR_B)).toBe(1);
    });
});

describe('assertRelayFlowClean', () => {
    it('passes for a clean flow within bounds and zero partner hops', () => {
        const txs: RelayTransactions = [
            mockInternalTx(ADDR_A, ADDR_B, false),
            mockInternalTx(ADDR_B, ADDR_A, false),
        ];
        expect(() =>
            assertRelayFlowClean(txs, { maxTx: 15, partnerPairs: [[ADDR_A, ADDR_B]] }),
        ).not.toThrow();
    });

    it('fails when empty-body partner hops exist', () => {
        const txs: RelayTransactions = [mockInternalTx(ADDR_A, ADDR_B, true)];
        expect(() =>
            assertRelayFlowClean(txs, { partnerPairs: [[ADDR_A, ADDR_B]] }),
        ).toThrow();
    });

    it('fails when tx count exceeds maxTx', () => {
        const txs: RelayTransactions = Array.from({ length: 16 }, () =>
            mockInternalTx(ADDR_A, ADDR_C, false),
        );
        expect(() => assertRelayFlowClean(txs, { maxTx: 15 })).toThrow();
    });

    it('fails on out-of-gas exit code -14', () => {
        const txs: RelayTransactions = [mockInternalTx(ADDR_A, ADDR_B, false, -14)];
        expect(() => assertRelayFlowClean(txs)).toThrow();
    });
});
