import type { SendMessageResult } from '@ton/sandbox';
import { Address } from '@ton/core';
import { expect } from '@jest/globals';

export type RelayTransactions = SendMessageResult['transactions'];

export interface AssertRelayFlowCleanOptions {
    /** Upper bound on tx count (default 15, per RELAY audit criterion). */
    maxTx?: number;
    /** Partner address pairs that must have zero empty-body hops between them. */
    partnerPairs?: Array<[Address, Address]>;
}

/**
 * Count internal messages with empty body between two partner contracts (either direction).
 * Used to detect RC-A cashback ping-pong (IMP-GOVOTE-02/08, IMP-RELAY-01).
 */
export function countEmptyBodyHopsBetween(
    transactions: RelayTransactions,
    addrA: Address,
    addrB: Address,
): number {
    let count = 0;
    for (const tx of transactions) {
        const inMsg = tx.inMessage;
        if (!inMsg || inMsg.info.type !== 'internal') {
            continue;
        }
        const from = inMsg.info.src;
        const to = inMsg.info.dest;
        const isHop =
            (from.equals(addrA) && to.equals(addrB)) || (from.equals(addrB) && to.equals(addrA));
        if (!isHop) {
            continue;
        }
        if (inMsg.body.bits.length === 0) {
            count++;
        }
    }
    return count;
}

/** Governor ↔ StakingMaster empty-body hops (IMP-GOVOTE-02 / RC-2). */
export function countEmptyGovernorStakingHops(
    transactions: RelayTransactions,
    governor: Address,
    stakingMaster: Address,
): number {
    return countEmptyBodyHopsBetween(transactions, governor, stakingMaster);
}

/** Proposal ↔ StakingMaster empty-body hops (IMP-GOVOTE-08). */
export function countEmptyProposalStakingHops(
    transactions: RelayTransactions,
    proposal: Address,
    stakingMaster: Address,
): number {
    return countEmptyBodyHopsBetween(transactions, proposal, stakingMaster);
}

function assertNoOutOfGas(transactions: RelayTransactions): void {
    for (const tx of transactions) {
        if (tx.description.type !== 'generic') {
            continue;
        }
        const phase = tx.description.computePhase;
        if (phase.type === 'vm') {
            expect(phase.exitCode).not.toBe(-14);
        }
    }
}

/**
 * Relay-audit regression gate: bounded tx count, no out-of-gas, zero empty-body partner hops.
 * See docs/specs/SECURITY.md (governance on-chain / relay flows).
 */
export function assertRelayFlowClean(
    transactions: RelayTransactions,
    options: AssertRelayFlowCleanOptions = {},
): void {
    const maxTx = options.maxTx ?? 15;
    expect(transactions.length).toBeLessThan(maxTx);
    assertNoOutOfGas(transactions);
    for (const [addrA, addrB] of options.partnerPairs ?? []) {
        expect(countEmptyBodyHopsBetween(transactions, addrA, addrB)).toBe(0);
    }
}
