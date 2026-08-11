/**
 * Full-stack treasury scenario helpers (IMP-TNFS-08).
 * Fee inflow uses jetton treasury leg 0.2% = FEE_SPLIT_EXPECTED.treasury on 1 BURN.
 * Authorized spend-via-timelock is IMP-TNFS-09A — not registered here.
 */
import { Address, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { Treasury } from '../../wrappers/Treasury';
import { check } from './checks';
import {
    EXPECTED_TREASURY,
    FEE_SPLIT_EXPECTED,
    NANO_PER_BURN,
    parseEnvAddress,
    readJettonWalletBalance,
} from './balances';
import { treasuryOf } from './matrix-checks';
import type { CheckResult, ScenarioContext } from '../types';

/** Exit code for `require(sender() == timelock, "Only timelock")`. */
export const EXIT_ONLY_TIMELOCK = 3095;

/**
 * Dust / tolerance policy for fee-inflow (documented; unit-tested):
 * - Probe size is exactly `TRANSFER_AMOUNT` (1 BURN) → treasury leg is exactly
 *   `FEE_SPLIT_EXPECTED.treasury` (2_000_000 nano = 0.2%).
 * - Assert **exact** delta on both `get_total_received` and treasury jetton wallet
 *   balance — no slack window.
 * - Non-round amounts would use floor division `(amount * 20) / 10000` (`treasuryOf`);
 *   this pack does not use a ±1 nano tolerance because 1 BURN is exact.
 * - Indexing / notify lag is handled by polling, not by widening the expected delta.
 */
export const TREASURY_INFLOW_TOLERANCE_NANO = 0n;
export const TREASURY_LEG_ON_1_BURN = FEE_SPLIT_EXPECTED.treasury;

export const TRANSFER_TON = toNano('3.5');
/** Minimal attach for unauthorized TreasurySpend probe (rejects before spend gas gate). */
export const UNAUTH_SPEND_TON = toNano('0.2');
export const UNAUTH_SPEND_AMOUNT = 1n;
export const UNAUTH_SPEND_REASON = 'tnfs-08-unauthorized-probe';

export const NA_NO_FEE_SENDER = 'no fee-test sender (set FEE_TEST_SENDER or airdropHolder in manifest)';
export const NA_NO_FEE_RECIPIENT = 'FEE_TEST_RECIPIENT not set';

export function openTreasury(ctx: ScenarioContext) {
    return ctx.provider.open(Treasury.fromAddress(Address.parse(ctx.manifest.addresses.treasury)));
}

export function resolveFeeSender(ctx: ScenarioContext): Address {
    const fromEnv = parseEnvAddress('FEE_TEST_SENDER', 'BURN_SMOKE_TEST_OWNER');
    if (fromEnv) {
        return fromEnv;
    }
    const airdrop = ctx.manifest.addresses.airdropHolder;
    if (!airdrop) {
        throw new Error(NA_NO_FEE_SENDER);
    }
    return Address.parse(airdrop);
}

export function requireFeeRecipient(): Address {
    const recipient = parseEnvAddress('FEE_TEST_RECIPIENT');
    if (!recipient) {
        throw new Error(
            'Set FEE_TEST_RECIPIENT to a non-excluded TON owner (distinct from sender) in .env.testnet.',
        );
    }
    return recipient;
}

export async function readTreasuryReceived(
    provider: NetworkProvider,
    treasury: Address,
): Promise<bigint> {
    const t = provider.open(Treasury.fromAddress(treasury));
    return t.getGetTotalReceived();
}

export async function readTreasurySpent(
    provider: NetworkProvider,
    treasury: Address,
): Promise<bigint> {
    const t = provider.open(Treasury.fromAddress(treasury));
    return t.getGetTotalSpent();
}

export async function readTreasurySpendingCount(
    provider: NetworkProvider,
    treasury: Address,
): Promise<bigint> {
    const t = provider.open(Treasury.fromAddress(treasury));
    return t.getGetSpendingCount();
}

export async function readTreasuryJettonBalance(
    provider: NetworkProvider,
    jettonMaster: Address,
    treasury: Address,
): Promise<bigint> {
    return readJettonWalletBalance(provider, jettonMaster, treasury);
}

export async function sleepMs(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll until total_received reaches `before + expectedLeg` (exact), or attempts exhausted.
 */
export async function waitForTreasuryInflow(
    provider: NetworkProvider,
    treasury: Address,
    before: bigint,
    expectedLeg: bigint,
    attempts = 12,
    sleep = 2_000,
): Promise<bigint> {
    const target = before + expectedLeg;
    let current = await readTreasuryReceived(provider, treasury);
    for (let i = 0; i < attempts && current < target; i += 1) {
        await sleepMs(sleep);
        current = await readTreasuryReceived(provider, treasury);
    }
    return current;
}

export function checkTreasurySmoke(input: {
    manifestTreasury: Address;
    onChainTimelock: Address;
    manifestTimelock: Address;
    onChainJetton: Address;
    manifestJetton: Address;
    totalReceived: bigint;
    codeHash?: string;
}): CheckResult[] {
    const checks: CheckResult[] = [
        check(
            'manifest-address',
            true,
            `treasury ${input.manifestTreasury.toString({ urlSafe: true, bounceable: true })}`,
        ),
        check(
            'total-received-readable',
            input.totalReceived >= 0n,
            `get_total_received=${input.totalReceived}`,
        ),
        check(
            'linked-timelock',
            input.onChainTimelock.equals(input.manifestTimelock),
            `timelock on-chain matches manifest`,
        ),
        check(
            'linked-jetton',
            input.onChainJetton.equals(input.manifestJetton),
            `jetton master on-chain matches manifest`,
        ),
    ];
    if (input.codeHash) {
        checks.push(
            check(
                'code-hash-present',
                input.codeHash.length > 0,
                `manifest codeHashes.treasury=${input.codeHash}`,
            ),
        );
    }
    return checks;
}

/**
 * Exact inflow assert: Δ total_received and Δ JW balance equal expected treasury leg.
 */
export function checkFeeInflow(input: {
    receivedBefore: bigint;
    receivedAfter: bigint;
    walletBefore: bigint;
    walletAfter: bigint;
    expectedLeg: bigint;
    transferAmount: bigint;
}): CheckResult[] {
    const receivedDelta = input.receivedAfter - input.receivedBefore;
    const walletDelta = input.walletAfter - input.walletBefore;
    const floorLeg = treasuryOf(input.transferAmount);
    return [
        check(
            'expected-leg-matches-fee-split',
            input.expectedLeg === FEE_SPLIT_EXPECTED.treasury &&
                input.expectedLeg === EXPECTED_TREASURY &&
                floorLeg === input.expectedLeg,
            `expectedLeg=${input.expectedLeg} (== FEE_SPLIT_EXPECTED.treasury / treasuryOf(1 BURN); ` +
                `tolerance=${TREASURY_INFLOW_TOLERANCE_NANO})`,
        ),
        check(
            'total-received-inflow',
            receivedDelta === input.expectedLeg,
            `total_received Δ=${receivedDelta} (expected exact +${input.expectedLeg} = 0.2% of ${input.transferAmount / NANO_PER_BURN} BURN)`,
        ),
        check(
            'jetton-wallet-inflow',
            walletDelta === input.expectedLeg,
            `treasury JW Δ=${walletDelta} (expected exact +${input.expectedLeg})`,
        ),
        check(
            'received-matches-wallet',
            receivedDelta === walletDelta,
            `total_received Δ and JW Δ agree (${receivedDelta})`,
        ),
    ];
}

/** Unauthorized spend: accounting + JW balance must not move after rogue TreasurySpend. */
export function checkUnauthorizedSpendRejected(input: {
    spentBefore: bigint;
    spentAfter: bigint;
    receivedBefore: bigint;
    receivedAfter: bigint;
    countBefore: bigint;
    countAfter: bigint;
    walletBefore: bigint;
    walletAfter: bigint;
    senderIsTimelock: boolean;
}): CheckResult[] {
    return [
        check(
            'sender-not-timelock',
            !input.senderIsTimelock,
            input.senderIsTimelock
                ? 'mnemonic sender IS timelock — cannot assert unauthorized reject'
                : 'mnemonic sender is not timelock (rogue path)',
        ),
        check(
            'total-spent-unchanged',
            input.spentAfter === input.spentBefore,
            `total_spent ${input.spentBefore} → ${input.spentAfter}`,
        ),
        check(
            'total-received-unchanged',
            input.receivedAfter === input.receivedBefore,
            `total_received ${input.receivedBefore} → ${input.receivedAfter}`,
        ),
        check(
            'spending-count-unchanged',
            input.countAfter === input.countBefore,
            `spending_count ${input.countBefore} → ${input.countAfter}`,
        ),
        check(
            'jetton-wallet-unchanged',
            input.walletAfter === input.walletBefore,
            `treasury JW ${input.walletBefore} → ${input.walletAfter}`,
        ),
    ];
}

/** Resolve treasury jetton wallet address via master (for optional manifest cross-check). */
export async function resolveTreasuryJettonWallet(
    provider: NetworkProvider,
    jettonMaster: Address,
    treasury: Address,
): Promise<Address> {
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    return master.getGetWalletAddress(treasury);
}

/** IMP-TNFS-F28 / F14: treasury JW must have feeConfig.active after deploy push. */
export function checkTreasuryJwFeeConfigActive(active: boolean): CheckResult[] {
    return [
        check(
            'treasury-jw-feeconfig-active',
            active,
            active
                ? 'treasury jetton wallet get_fee_config_active=true (F14 deploy-push)'
                : 'treasury JW feeConfig inactive — spend path will exit 21507; redeploy/sync feeConfig',
        ),
    ];
}
