import { assertCheck } from './checks';
import type { CheckResult } from '../types';

/** Sandbox mirror: plain-TON cashback path stays ≤ 5 transactions (no Master↔wallet relay loop). */
export const MAX_PLAIN_TON_CASHBACK_HOPS = 5;

/**
 * TEP-89 / TEP-74 wallet discovery consistency:
 * locally predicted wallet address must equal on-chain `get_wallet_address`.
 */
export function checkTep89WalletDiscovery(input: {
    predictedWallet: string;
    onChainWallet: string;
    owner: string;
}): CheckResult[] {
    const match = input.predictedWallet === input.onChainWallet;
    return [
        assertCheck(
            input.predictedWallet.length > 0 && input.onChainWallet.length > 0,
            `wallet addresses resolved for owner ${input.owner}`,
        ),
        assertCheck(
            match,
            match
                ? `predicted wallet matches on-chain get_wallet_address (${input.onChainWallet})`
                : `TEP-89 discovery mismatch: predicted ${input.predictedWallet} !== on-chain ${input.onChainWallet}`,
        ),
    ];
}

/**
 * Accidental plain TON to master must cashback the sender without a relay loop.
 * Cashback evidence: sender lost strictly less than the full sent amount (value returned).
 * Loop guard: hop/tx count ≤ sandbox bound (MAX_PLAIN_TON_CASHBACK_HOPS).
 */
export function checkPlainTonCashback(input: {
    sentNano: bigint;
    balanceBefore: bigint;
    balanceAfter: bigint;
    hopCount: number;
    maxHops?: number;
}): CheckResult[] {
    const maxHops = input.maxHops ?? MAX_PLAIN_TON_CASHBACK_HOPS;
    const lost = input.balanceBefore - input.balanceAfter;
    const cashbackObserved = lost < input.sentNano;
    const noLoop = input.hopCount <= maxHops;

    return [
        assertCheck(
            input.sentNano > 0n,
            `plain-TON probe amount ${input.sentNano} nano`,
        ),
        assertCheck(
            cashbackObserved,
            cashbackObserved
                ? `cashback observed: sender lost ${lost} nano < sent ${input.sentNano} nano ` +
                      `(balance ${input.balanceBefore} → ${input.balanceAfter})`
                : `no cashback: sender lost ${lost} nano ≥ sent ${input.sentNano} nano ` +
                      `(balance ${input.balanceBefore} → ${input.balanceAfter})`,
        ),
        assertCheck(
            noLoop,
            noLoop
                ? `no relay loop: related hops ${input.hopCount} ≤ ${maxHops}`
                : `relay loop suspected: related hops ${input.hopCount} > ${maxHops}`,
        ),
    ];
}
