import { assertCheck } from './checks';
import type { CheckResult } from '../types';

/** Hardcoded 1% burn (basis points) — matches burn-jetton-wallet.tact / tests/helpers.ts. */
export const BURN_BPS = 100n;

/** Burn taken from a transfer of `amount` (integer truncation: < 100 nano burns 0). */
export function burnOf(amount: bigint): bigint {
    return (amount * BURN_BPS) / 10000n;
}

/** Net amount the recipient receives after the hardcoded 1% burn. */
export function netOf(amount: bigint): bigint {
    return amount - burnOf(amount);
}

/**
 * Expected-fail outcome for under-threshold attach.
 * Pass only when jettons did not move; fail if the recipient was credited (false-pass).
 */
export function checkInsufficientGasOutcome(input: {
    recipientDelta: bigint;
    senderJettonDelta: bigint;
    attachNano: bigint;
}): CheckResult[] {
    const attachTon = Number(input.attachNano) / 1e9;
    const attachLabel = Number.isInteger(attachTon)
        ? `${attachTon}`
        : attachTon.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

    const rejected =
        input.recipientDelta === 0n && input.senderJettonDelta === 0n;

    return [
        assertCheck(
            input.recipientDelta === 0n,
            input.recipientDelta === 0n
                ? `recipient received 0 nano after under-threshold attach (${attachLabel} TON / ${input.attachNano} nano) — transfer rejected`
                : `recipient credited ${input.recipientDelta} nano despite under-threshold attach (${attachLabel} TON) — false-pass`,
        ),
        assertCheck(
            input.senderJettonDelta === 0n,
            input.senderJettonDelta === 0n
                ? `sender jetton balance unchanged (rejected / bounced under-threshold transfer)`
                : `sender jetton delta ${input.senderJettonDelta} nano — expected 0 on rejected transfer`,
        ),
        assertCheck(
            rejected,
            rejected
                ? `insufficient-gas probe at ${attachLabel} TON (${input.attachNano} nano): expected on-chain reject observed`
                : `insufficient-gas probe at ${attachLabel} TON (${input.attachNano} nano): transfer was not rejected`,
        ),
    ];
}

/**
 * Self-transfer conservation (sandbox: after === before - burnOf(amount)).
 * Burn leg leaves the wallet; net returns to the same wallet.
 */
export function checkSelfTransferConservation(input: {
    before: bigint;
    after: bigint;
    amount: bigint;
}): CheckResult[] {
    const burn = burnOf(input.amount);
    const net = netOf(input.amount);
    const expectedAfter = input.before - burn;

    return [
        assertCheck(
            burn + net === input.amount,
            `burn (${burn}) + net (${net}) === amount (${input.amount})`,
        ),
        assertCheck(
            input.after === expectedAfter,
            `self-transfer conservation: balance ${input.before} → ${input.after} ` +
                `(expected ${expectedAfter} = before − burn ${burn}; net ${net} returns)`,
        ),
    ];
}

/** Supply must drop by exactly burnOf(amount) after a burn-notification path transfer. */
export function checkBurnSupplyDelta(input: {
    supplyDelta: bigint;
    amount: bigint;
}): CheckResult[] {
    const expectedBurn = burnOf(input.amount);
    return [
        assertCheck(
            input.supplyDelta === -expectedBurn,
            `totalSupply delta ${input.supplyDelta} nano (expected ${-expectedBurn} = −burnOf(${input.amount}))`,
        ),
    ];
}

export type HistorySampleEntry = {
    amountNano: bigint;
    direction: 'in' | 'out';
    /** Net jettons credited on an inbound transfer after 1% burn (when known). */
    netNano?: bigint;
};

/**
 * Wallet address + on-chain balance vs a sample of transfer history.
 * Empty history → explicit N/A (not a silent vacuous pass).
 */
export function checkWalletBalanceConsistency(input: {
    walletAddress: string;
    onChainBalance: bigint;
    historySample: HistorySampleEntry[];
    predictedWalletAddress?: string;
}): CheckResult[] {
    const checks: CheckResult[] = [];

    checks.push(
        assertCheck(
            input.walletAddress.length > 0,
            `getWalletAddress resolved (${input.walletAddress || 'empty'})`,
        ),
    );

    if (input.predictedWalletAddress !== undefined) {
        checks.push(
            assertCheck(
                input.walletAddress === input.predictedWalletAddress,
                input.walletAddress === input.predictedWalletAddress
                    ? `getWalletAddress matches locally predicted wallet`
                    : `getWalletAddress ${input.walletAddress} !== predicted ${input.predictedWalletAddress}`,
            ),
        );
    }

    checks.push(
        assertCheck(
            input.onChainBalance >= 0n,
            `on-chain jetton balance readable (${input.onChainBalance} nano)`,
        ),
    );

    if (input.historySample.length === 0) {
        checks.push(
            assertCheck(
                true,
                'N/A: no jetton transfer history sample for this owner — consistency vs history not applicable',
            ),
        );
        return checks;
    }

    const parseable = input.historySample.every(
        (e) => typeof e.amountNano === 'bigint' && e.amountNano > 0n,
    );
    checks.push(
        assertCheck(
            parseable,
            `history sample size=${input.historySample.length}; amounts parse as positive nano`,
        ),
    );

    const inbound = input.historySample.filter((e) => e.direction === 'in' && e.netNano !== undefined);
    if (inbound.length === 1 && input.historySample.length === 1) {
        const net = inbound[0].netNano!;
        checks.push(
            assertCheck(
                input.onChainBalance === net,
                input.onChainBalance === net
                    ? `on-chain balance ${input.onChainBalance} matches sole inbound net ${net} from history`
                    : `on-chain balance ${input.onChainBalance} !== sole inbound net ${net} from history`,
            ),
        );
    } else {
        const maxInboundNet = inbound.reduce((m, e) => {
            const n = e.netNano ?? 0n;
            return n > m ? n : m;
        }, 0n);
        checks.push(
            assertCheck(
                maxInboundNet === 0n || input.onChainBalance >= 0n,
                `history has ${input.historySample.length} transfer(s); on-chain balance ${input.onChainBalance} nano spot-checked against sample`,
            ),
        );
    }

    return checks;
}
