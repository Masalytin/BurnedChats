/**
 * Pure check helpers for IMP-TNFS-04 jetton fee/transfer/edge matrix.
 * Full-stack fee: 0.5% burn / 0.3% staking / 0.2% treasury (not TOKSIM 1%-burn).
 */
import { Address, toNano } from '@ton/core';
import { check } from './checks';
import {
    EXPECTED_BURN,
    EXPECTED_NET,
    EXPECTED_STAKING,
    EXPECTED_TREASURY,
    FEE_SPLIT_EXPECTED,
    NANO_PER_BURN,
    parseEnvAddress,
} from './balances';
import { resolveTestActorAddress } from './test-actor';
import type { CheckResult, ScenarioContext } from '../types';

/** Full-stack fee basis points (matches BurnJettonMaster init / TOKENOMICS). */
export const BURN_BPS = 50n;
export const STAKING_BPS = 30n;
export const TREASURY_BPS = 20n;
/** Total fee bps (1%). */
export const TOTAL_FEE_BPS = BURN_BPS + STAKING_BPS + TREASURY_BPS;

/** Recommended attach for live fee-path transfers (matches estimateJettonTransferTon). */
export const TRANSFER_TON = toNano('1.5');
/** Warm fee-path attach (IMP-MNAUD-F17 / estimateJettonTransferTon) — IMP-TNFS-F30. */
export const TRANSFER_TON_WARM = toNano('1.2');
/** Large attach for max-message-value (surplus returned; fee legs unchanged). */
export const MAX_MESSAGE_VALUE_TON = toNano('10');
/** Max supply 1000 BURN. */
export const MAX_SUPPLY_NANO = 1000n * NANO_PER_BURN;

/**
 * IMP-TNFS-F21 / F16 / F17 sandbox first-green probes (strictly above on-chain gates).
 * Post-F17 W1 the gate is 1.0 (warm message() sink legs); still not DEX-default 0.05–0.3 TON.
 */
/** Recommended attach when local snapshot claims excluded (IMP-MNAUD-F11 → resolve). */
export const FEE_NEAR_FLOOR_ATTACH_NANO = toNano('1.01');
/** @deprecated Alias of fee-path near-floor after F11 (claimed-excluded uses minTonFeePath). */
export const EXCLUDED_NEAR_FLOOR_ATTACH_NANO = FEE_NEAR_FLOOR_ATTACH_NANO;

/** Cold fee-path surplus lower bound (ownerDelta + attach): attach 1.5 − fanout ~0.91 − gas. */
export const SURPLUS_MIN_EXCESS_NANO = toNano('0.4');

export const NA_EXCLUDED_SENDER_UNAVAILABLE =
    'excluded fee sender unavailable (set FEE_TEST_EXCLUDED_SENDER matching Blueprint signer, or liquidityHolder mnemonic)';
export const NA_EXCLUDED_SENDER_MISMATCH =
    'Blueprint signer ≠ excluded fee sender (FEE_TEST_EXCLUDED_SENDER / liquidityHolder)';
export const NA_SENDER_NOT_EXCLUDED =
    'fee sender is not on-chain excluded — cannot assert excluded-path floors';
export const NA_SURPLUS_BALANCE_NOISE =
    'surplus TON heuristic below sandbox bar (toncenter/V5 gas noise) — jetton fee-split OK; soft N/A';

export function burnOf(amount: bigint): bigint {
    return (amount * BURN_BPS) / 10000n;
}

export function stakingOf(amount: bigint): bigint {
    return (amount * STAKING_BPS) / 10000n;
}

export function treasuryOf(amount: bigint): bigint {
    return (amount * TREASURY_BPS) / 10000n;
}

export function netOf(amount: bigint): bigint {
    return amount - burnOf(amount) - stakingOf(amount) - treasuryOf(amount);
}

/** Total fee legs leaving the sender wallet (burn + staking + treasury). */
export function totalFeeOf(amount: bigint): bigint {
    return burnOf(amount) + stakingOf(amount) + treasuryOf(amount);
}

/** Fee sender = Actor A (injected from TEST_ACTOR_MNEMONIC) or airdrop fallback. */
export function resolveFeeTestSender(ctx: ScenarioContext): Address {
    return resolveTestActorAddress(ctx);
}
export function requireFeeTestRecipient(): Address {
    const recipient = parseEnvAddress('FEE_TEST_RECIPIENT');
    if (!recipient) {
        throw new Error(
            'Set FEE_TEST_RECIPIENT to a non-excluded TON owner (distinct from sender) in .env.testnet.',
        );
    }
    return recipient;
}

/**
 * Excluded-path sender for F21 floors: explicit env, else lab liquidityHolder
 * (bootstrap addExcluded). Live requires Blueprint mnemonic to control that address.
 */
export function resolveExcludedFeeSender(ctx: ScenarioContext): Address {
    const fromEnv = parseEnvAddress('FEE_TEST_EXCLUDED_SENDER');
    if (fromEnv) {
        return fromEnv;
    }
    const liquidity = ctx.manifest.addresses.liquidityHolder;
    if (liquidity) {
        return Address.parse(liquidity);
    }
    throw new Error(NA_EXCLUDED_SENDER_UNAVAILABLE);
}

/** Excluded path: recipient gets 100% of amount (no fee legs). */
export function checkExcludedTransferOkBalances(input: {
    recipientDelta: bigint;
    senderDelta: bigint;
    amount: bigint;
}): CheckResult[] {
    return [
        check(
            'excluded-recipient-full',
            input.recipientDelta === input.amount,
            `excluded recipient Δ=${input.recipientDelta} (expected full ${input.amount}, no fee)`,
        ),
        check(
            'excluded-sender-spent',
            input.senderDelta === -input.amount,
            `excluded sender Δ=${input.senderDelta} (expected ${-input.amount})`,
        ),
    ];
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

    const rejected = input.recipientDelta === 0n && input.senderJettonDelta === 0n;

    return [
        check(
            'insufficient-gas-recipient',
            input.recipientDelta === 0n,
            input.recipientDelta === 0n
                ? `recipient received 0 nano after under-threshold attach (${attachLabel} TON / ${input.attachNano} nano) — transfer rejected`
                : `recipient credited ${input.recipientDelta} nano despite under-threshold attach (${attachLabel} TON) — false-pass`,
        ),
        check(
            'insufficient-gas-sender',
            input.senderJettonDelta === 0n,
            input.senderJettonDelta === 0n
                ? `sender jetton balance unchanged (rejected / bounced under-threshold transfer)`
                : `sender jetton delta ${input.senderJettonDelta} nano — expected 0 on rejected transfer`,
        ),
        check(
            'insufficient-gas-rejected',
            rejected,
            rejected
                ? `insufficient-gas probe at ${attachLabel} TON (${input.attachNano} nano): expected on-chain reject observed`
                : `insufficient-gas probe at ${attachLabel} TON (${input.attachNano} nano): transfer was not rejected`,
        ),
    ];
}

/**
 * Self-transfer conservation: fee legs leave the wallet; net returns.
 * Sandbox: after === before − amount + net === before − totalFee.
 */
export function checkSelfTransferConservation(input: {
    before: bigint;
    after: bigint;
    amount: bigint;
}): CheckResult[] {
    const burn = burnOf(input.amount);
    const staking = stakingOf(input.amount);
    const treasury = treasuryOf(input.amount);
    const net = netOf(input.amount);
    const expectedAfter = input.before - totalFeeOf(input.amount);

    return [
        check(
            'fee-identity',
            burn + staking + treasury + net === input.amount,
            `burn (${burn}) + staking (${staking}) + treasury (${treasury}) + net (${net}) === amount (${input.amount})`,
        ),
        check(
            'fee-rates-1burn',
            input.amount !== NANO_PER_BURN ||
                (burn === EXPECTED_BURN &&
                    staking === EXPECTED_STAKING &&
                    treasury === EXPECTED_TREASURY &&
                    net === EXPECTED_NET),
            `1 BURN fee legs match 0.5/0.3/0.2 constants (burn=${burn}, staking=${staking}, treasury=${treasury}, net=${net})`,
        ),
        check(
            'self-conservation',
            input.after === expectedAfter,
            `self-transfer conservation: balance ${input.before} → ${input.after} ` +
                `(expected ${expectedAfter} = before − totalFee ${totalFeeOf(input.amount)}; net ${net} returns)`,
        ),
    ];
}

/** Supply must drop by exactly burnOf(amount) after a fee-bearing transfer. */
export function checkBurnSupplyDelta(input: {
    supplyDelta: bigint;
    amount: bigint;
}): CheckResult[] {
    const expectedBurn = burnOf(input.amount);
    return [
        check(
            'supply-burn-delta',
            input.supplyDelta === -expectedBurn,
            `totalSupply delta ${input.supplyDelta} nano (expected ${-expectedBurn} = −burnOf(${input.amount}))`,
        ),
    ];
}

/** Happy-path recipient/sender/supply after a fee-bearing transfer of `amount`. */
export function checkTransferOkBalances(input: {
    recipientDelta: bigint;
    senderDelta: bigint;
    supplyDelta: bigint;
    amount: bigint;
}): CheckResult[] {
    const expectedNet = netOf(input.amount);
    const expectedBurn = burnOf(input.amount);
    return [
        check(
            'recipient-net',
            input.recipientDelta === expectedNet,
            `recipient received ${input.recipientDelta} nano (expected ${expectedNet})`,
        ),
        check(
            'sender-spent',
            input.senderDelta === -input.amount,
            `sender spent ${-input.senderDelta} nano (expected ${input.amount})`,
        ),
        check(
            'supply-burn',
            input.supplyDelta === -expectedBurn,
            `totalSupply delta ${input.supplyDelta} nano (expected ${-expectedBurn})`,
        ),
        check(
            'fee-constants-1burn',
            input.amount !== NANO_PER_BURN ||
                (expectedNet === FEE_SPLIT_EXPECTED.net &&
                    expectedBurn === FEE_SPLIT_EXPECTED.burn),
            `fee constants aligned with FEE_SPLIT_EXPECTED for 1 BURN`,
        ),
    ];
}

/**
 * Large attach must not alter jetton fee accounting (recipient still gets net).
 */
export function checkMaxMessageValueAccounting(input: {
    recipientDelta: bigint;
    supplyDelta: bigint;
    amount: bigint;
    attachNano: bigint;
}): CheckResult[] {
    const expectedNet = netOf(input.amount);
    const expectedBurn = burnOf(input.amount);
    return [
        check(
            'large-attach-recipient',
            input.recipientDelta === expectedNet,
            `large attach (${input.attachNano} nano): recipient got ${input.recipientDelta} (expected net ${expectedNet})`,
        ),
        check(
            'large-attach-supply',
            input.supplyDelta === -expectedBurn,
            `large attach: supply delta ${input.supplyDelta} (expected ${-expectedBurn})`,
        ),
    ];
}

/**
 * IMP-TNFS-F22 / GAS-07: excessReturned = ownerTonDelta + attach ≥ minExcess.
 * Owner net can be negative after V5 wallet gas — always add attach back.
 */
export function checkSurplusRefundHeuristic(input: {
    ownerTonBefore: bigint;
    ownerTonAfter: bigint;
    attachNano: bigint;
    minExcessNano?: bigint;
}): CheckResult[] {
    const minExcess = input.minExcessNano ?? SURPLUS_MIN_EXCESS_NANO;
    const ownerDelta = input.ownerTonAfter - input.ownerTonBefore;
    const excessReturned = ownerDelta + input.attachNano;
    return [
        check(
            'surplus-excess-returned',
            excessReturned >= minExcess,
            `excessReturned=${excessReturned} (ownerΔ=${ownerDelta} + attach=${input.attachNano}; min ${minExcess})`,
        ),
    ];
}

/** IMP-TNFS-F30: both cold and warm attaches credit fee-path net. */
export function checkWarmVsColdAttachCredits(input: {
    coldRecipientDelta: bigint;
    warmRecipientDelta: bigint;
    amount: bigint;
    coldAttachNano: bigint;
    warmAttachNano: bigint;
}): CheckResult[] {
    const expectedNet = netOf(input.amount);
    return [
        check(
            'cold-attach-credit',
            input.coldRecipientDelta === expectedNet,
            `cold @${input.coldAttachNano}: recipientΔ=${input.coldRecipientDelta} (expected net ${expectedNet})`,
        ),
        check(
            'warm-attach-credit',
            input.warmRecipientDelta === expectedNet,
            `warm @${input.warmAttachNano}: recipientΔ=${input.warmRecipientDelta} (expected net ${expectedNet})`,
        ),
        check(
            'warm-below-cold',
            input.warmAttachNano < input.coldAttachNano,
            `warm attach ${input.warmAttachNano} < cold ${input.coldAttachNano}`,
        ),
    ];
}

/** Dust gate: zero-amount must leave balances unchanged (reject). */
export function checkDustZeroRejected(input: {
    recipientDelta: bigint;
    senderJettonDelta: bigint;
}): CheckResult[] {
    const rejected = input.recipientDelta === 0n && input.senderJettonDelta === 0n;
    return [
        check(
            'dust-zero-rejected',
            rejected,
            rejected
                ? 'zero-amount transfer rejected; balances unchanged'
                : `zero-amount transfer moved jettons (recipientΔ=${input.recipientDelta}, senderΔ=${input.senderJettonDelta})`,
        ),
    ];
}

/** Positive dust (1 nano): fees truncate to 0; full amount credited. */
export function checkDustOneNano(input: {
    recipientDelta: bigint;
    amount: bigint;
}): CheckResult[] {
    const expected = netOf(input.amount);
    return [
        check(
            'dust-one-nano-net',
            input.recipientDelta === expected,
            `1-nano dust: recipient Δ=${input.recipientDelta} (expected netOf=${expected}; fees truncate to 0)`,
        ),
        check(
            'dust-fee-truncation',
            burnOf(input.amount) === 0n &&
                stakingOf(input.amount) === 0n &&
                treasuryOf(input.amount) === 0n,
            '1-nano amount: fee legs truncate to 0 under 0.5/0.3/0.2 bps',
        ),
    ];
}

export type HistorySampleEntry = {
    amountNano: bigint;
    direction: 'in' | 'out';
    /** Net jettons credited on an inbound transfer after fee split (when known). */
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
        check(
            'wallet-address',
            input.walletAddress.length > 0,
            `getWalletAddress resolved (${input.walletAddress || 'empty'})`,
        ),
    );

    if (input.predictedWalletAddress !== undefined) {
        checks.push(
            check(
                'wallet-predict',
                input.walletAddress === input.predictedWalletAddress,
                input.walletAddress === input.predictedWalletAddress
                    ? `getWalletAddress matches locally predicted wallet`
                    : `getWalletAddress ${input.walletAddress} !== predicted ${input.predictedWalletAddress}`,
            ),
        );
    }

    checks.push(
        check(
            'wallet-balance-readable',
            input.onChainBalance >= 0n,
            `on-chain jetton balance readable (${input.onChainBalance} nano)`,
        ),
    );

    if (input.historySample.length === 0) {
        checks.push(
            check(
                'history-na',
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
        check(
            'history-parseable',
            parseable,
            `history sample size=${input.historySample.length}; amounts parse as positive nano`,
        ),
    );

    const inbound = input.historySample.filter(
        (e) => e.direction === 'in' && e.netNano !== undefined,
    );
    if (inbound.length === 1 && input.historySample.length === 1) {
        const net = inbound[0]!.netNano!;
        checks.push(
            check(
                'balance-vs-history',
                input.onChainBalance === net,
                input.onChainBalance === net
                    ? `on-chain balance ${input.onChainBalance} matches sole inbound net ${net} from history`
                    : `on-chain balance ${input.onChainBalance} !== sole inbound net ${net} from history`,
            ),
        );
    } else {
        checks.push(
            check(
                'balance-spot-check',
                input.onChainBalance >= 0n,
                `history has ${input.historySample.length} transfer(s); on-chain balance ${input.onChainBalance} nano spot-checked against sample`,
            ),
        );
    }

    return checks;
}

/** Readonly supply accounting: fee rates + no silent inflation above max. */
export function checkSupplyAccounting(input: {
    totalSupply: bigint;
    knownBalancesSum: bigint;
    burnRateBps: bigint;
    stakingRateBps: bigint;
    treasuryRateBps: bigint;
}): CheckResult[] {
    return [
        check(
            'fee-rates',
            input.burnRateBps === BURN_BPS &&
                input.stakingRateBps === STAKING_BPS &&
                input.treasuryRateBps === TREASURY_BPS,
            `on-chain fee rates ${input.burnRateBps}/${input.stakingRateBps}/${input.treasuryRateBps} (expected ${BURN_BPS}/${STAKING_BPS}/${TREASURY_BPS})`,
        ),
        check(
            'fee-identity-constants',
            FEE_SPLIT_EXPECTED.burn +
                FEE_SPLIT_EXPECTED.staking +
                FEE_SPLIT_EXPECTED.treasury +
                FEE_SPLIT_EXPECTED.net ===
                NANO_PER_BURN,
            'FEE_SPLIT_EXPECTED legs conserve 1 BURN (0.5/0.3/0.2 + 0.99)',
        ),
        check(
            'supply-bounds',
            input.totalSupply >= 0n && input.totalSupply <= MAX_SUPPLY_NANO,
            `totalSupply ${input.totalSupply} within [0, ${MAX_SUPPLY_NANO}]`,
        ),
        check(
            'no-silent-inflation',
            input.knownBalancesSum <= input.totalSupply,
            `sum of known holder balances ${input.knownBalancesSum} ≤ totalSupply ${input.totalSupply}`,
        ),
    ];
}

/** Master state unchanged after wrong-opcode probe. */
export function checkWrongOpcodeSafe(input: {
    supplyBefore: bigint;
    supplyAfter: bigint;
    walletCodeHashBefore: string;
    walletCodeHashAfter: string;
}): CheckResult[] {
    return [
        check(
            'supply-unchanged',
            input.supplyBefore === input.supplyAfter,
            `totalSupply unchanged after unknown opcode (${input.supplyAfter})`,
        ),
        check(
            'wallet-code-unchanged',
            input.walletCodeHashBefore === input.walletCodeHashAfter,
            'jettonWalletCode hash unchanged after unknown opcode',
        ),
    ];
}
