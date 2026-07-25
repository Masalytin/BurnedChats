/**
 * IMP-TNFS-F11 — one-shot recovery of assets stranded on the quote-polluted
 * Actor A wallet (identity drift root-caused in IMP-TNFS-F09).
 *
 * Background: the old parseEnvLine bug left LITERAL double quotes on the
 * TEST_ACTOR_MNEMONIC value (`"word1 … word24"`). mnemonicToPrivateKey does
 * not validate words, so live runs signed with a DIFFERENT deterministic
 * wallet ("polluted"): same 24 words but `"` glued to the first and last one.
 * That wallet holds ~25 TON, a 10.02 BURN stake (lab StakingMaster tier 0)
 * and possibly loose BURN on its jetton wallet.
 *
 * Recovery plan (executed in order with --yes, always printed):
 *   a. read live state via toncenter (polluted TON, get_stake, BURN balances);
 *   b. unstake the full tier-0 (Flexible) stake, signed by the polluted wallet;
 *   c. transfer ALL BURN from the polluted jetton wallet → clean Actor A;
 *   d. sweep remaining TON (minus a small fee reserve) → source/deploy wallet;
 *   e. print final balances.
 *
 * Secrets policy: the polluted mnemonic is NEVER stored and NEVER printed —
 * the clean TEST_ACTOR_MNEMONIC is read via the (fixed) env loader and the
 * quotes are re-applied in memory only. Output contains addresses/amounts only.
 *
 * Hard gate: both derivations must match the hardcoded expected addresses
 * (polluted 0:79a475a6…, clean 0:6b6456…) or the script aborts before any
 * network write.
 *
 * WARNING — npm swallows flags on Windows/PowerShell (live 2026-07-23).
 * Always invoke directly:
 *
 *   npx ts-node --transpile-only scripts/recover-polluted-actor-testnet.ts --testnet --dry-run
 *   npx ts-node --transpile-only scripts/recover-polluted-actor-testnet.ts --testnet --yes
 *
 * Defense in depth: without --yes the script prints the plan and exits 2.
 */
import { resolve } from 'node:path';
import { Address, internal, SendMode, toNano } from '@ton/core';
import { mnemonicToPrivateKey, type KeyPair } from '@ton/crypto';
import { WalletContractV5R1 } from '@ton/ton';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingMaster } from '../wrappers/StakingMaster';
import { readJettonWalletBalance } from '../testnet-scenarios/lib/balances';
import { loadManifest } from '../testnet-scenarios/lib/manifest';
import { readLiveTonBalance } from '../testnet-scenarios/lib/provider';
import { readStakeRecord } from '../testnet-scenarios/lib/staking';
import { resolveTestActorMnemonic } from '../testnet-scenarios/lib/test-actor';
import { applyBlueprintWalletAliases, loadDeployEnv } from './deploy/env';

// ─── Constants (exported for unit tests) ────────────────────────────────────

/** Polluted V5R1 wallet the live runs actually signed with (IMP-TNFS-F09 RCA). */
export const EXPECTED_POLLUTED_RAW =
    '0:79a475a6d84427cdb897c954e4bcffd147fcdd3be9b01df9e48da28d08fca1c9';
/** Clean Actor A derivation of TEST_ACTOR_MNEMONIC (bounceable-testnet form). */
export const EXPECTED_CLEAN_FRIENDLY = 'kQBrZFZiElcBTlnOIDkm0Mow-jIGrLNs_7lSXw5CvFtHNGlL';
/** Source / deploy wallet — destination of the final TON sweep (active, bounce ok). */
export const SOURCE_WALLET_FRIENDLY = 'EQB8WzqUmqJpvVVdu26-wKMNOLwVR3ZP5fLfBMoPY6joDm07';

/** Flexible tier holding the stranded 10.02 BURN stake. */
export const RECOVERY_TIER = 0;
/** UnstakeJetton attach — matches wrappers/StakingMaster.sendUnstakeJetton. */
export const UNSTAKE_ATTACH_TON = toNano('4.2');
/**
 * BURN-leg attach: Actor A path is non-excluded → fee-split gate
 * minTonFeePath = 2.1 TON; 2.5 gives margin (live-confirmed, IMP-TNFS-F08).
 */
export const BURN_TRANSFER_ATTACH = toNano('2.5');
/** TON left on the polluted wallet to pay the sweep's own gas/fwd fees. */
export const TON_SWEEP_RESERVE = toNano('0.05');
/** Acceptance target — polluted wallet must end below this. */
export const MAX_LEFTOVER_TON = toNano('0.1');
/** Preflight floor before live sends (unstake + BURN attach + sweep margin). */
export const MIN_POLLUTED_TON_FOR_RECOVERY = UNSTAKE_ATTACH_TON + BURN_TRANSFER_ATTACH + toNano('0.3');

// ─── CLI mode (exported for unit tests) ─────────────────────────────────────

/**
 * - usage:     help only
 * - dry-run:   read-only plan, guaranteed no transactions (wins over --yes)
 * - plan-only: no --yes → plan printed, sends refused (exit 2). Fail-safe when
 *              npm swallows --dry-run / --yes flags.
 * - send:      --yes present and --dry-run absent
 */
export type RecoveryCliMode = 'usage' | 'dry-run' | 'plan-only' | 'send';

export function resolveRecoveryCliMode(argv: string[]): RecoveryCliMode {
    const wantsUsage =
        argv.length === 0 || argv.includes('--usage') || argv.includes('--help') || argv.includes('-h');
    if (wantsUsage) {
        return 'usage';
    }
    if (argv.includes('--dry-run')) {
        return 'dry-run';
    }
    return argv.includes('--yes') ? 'send' : 'plan-only';
}

// ─── Pure derivation / plan math (exported for unit tests) ──────────────────

/**
 * Re-create the quote pollution IN MEMORY: literal `"` prefixed to the first
 * word and suffixed to the last word — exactly what the pre-F09 parseEnvLine
 * left in the env value. Returns a new array; never logs anything.
 */
export function polluteMnemonicWords(words: readonly string[]): string[] {
    if (words.length < 12) {
        throw new Error(`mnemonic must be at least 12 words (got ${words.length})`);
    }
    const polluted = [...words];
    polluted[0] = `"${polluted[0]}`;
    polluted[polluted.length - 1] = `${polluted[polluted.length - 1]}"`;
    return polluted;
}

/** TON sweep value: full balance minus the fee reserve (never negative). */
export function computeTonSweepValue(balance: bigint, reserve: bigint = TON_SWEEP_RESERVE): bigint {
    const value = balance - reserve;
    return value > 0n ? value : 0n;
}

/**
 * Hard gate: derived address must equal the hardcoded expectation. Prints both
 * addresses on mismatch and throws — the caller aborts before ANY send.
 */
export function assertDerivedAddress(actual: Address, expectedRaw: string, label: string): void {
    const expected = Address.parse(expectedRaw);
    if (!actual.equals(expected)) {
        throw new Error(
            `${label} derivation mismatch — REFUSING to continue.\n` +
                `  derived : ${actual.toRawString()}\n` +
                `  expected: ${expected.toRawString()}\n` +
                'Check WALLET_VERSION / WALLET_NETWORK_ID / SUBWALLET_NUMBER and TEST_ACTOR_MNEMONIC.',
        );
    }
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp(): void {
    console.log(`recover-polluted-actor-testnet — one-shot recovery of the quote-polluted Actor A wallet (IMP-TNFS-F11)

Recommended invocation (npm run swallows -- flags on Windows/PowerShell):
  npx ts-node --transpile-only scripts/recover-polluted-actor-testnet.ts --testnet --dry-run
  npx ts-node --transpile-only scripts/recover-polluted-actor-testnet.ts --testnet --yes

Flags:
  --testnet   REQUIRED network selector (mainnet is hard-refused)
  --dry-run   read-only: derive addresses, read live state, print the plan (exit 0)
  --yes       REQUIRED for real sends; without it the script prints the plan
              and exits 2 (protects against npm-swallowed flags)

Plan (executed in order with --yes):
  1. unstake the full tier-0 Flexible stake (signed by the polluted wallet)
  2. transfer ALL BURN from the polluted jetton wallet → clean Actor A
  3. sweep remaining TON (minus ${TON_SWEEP_RESERVE} nano reserve) → source wallet

Env (.env.testnet, secrets local only — never printed):
  TEST_ACTOR_MNEMONIC   clean Actor A seed; pollution is re-applied in memory only
  WALLET_MNEMONIC       Blueprint provider bootstrap (not used for signing legs)
`);
}

// ─── Wallet plumbing ────────────────────────────────────────────────────────

type DirectWallet = {
    address: Address;
    keyPair: KeyPair;
    wallet: WalletContractV5R1;
};

/**
 * Build a V5R1 wallet from mnemonic words using the same env knobs as
 * Blueprint / test-actor derivation. The polluted wallet is V5R1 (live
 * evidence, IMP-TNFS-F09) — other WALLET_VERSION values are refused because
 * they cannot reproduce the polluted address anyway.
 */
async function buildWalletFromWords(words: readonly string[]): Promise<DirectWallet> {
    const version = (process.env.WALLET_VERSION?.trim() || 'v5r1').toLowerCase();
    if (version !== 'v5r1') {
        throw new Error(
            `WALLET_VERSION=${version} unsupported — the polluted wallet is V5R1 (set WALLET_VERSION=v5r1)`,
        );
    }
    const keyPair = await mnemonicToPrivateKey([...words]);
    const networkGlobalId = Number(process.env.WALLET_NETWORK_ID ?? '-3');
    const subwalletNumber = Number(process.env.SUBWALLET_NUMBER ?? '0');
    const wallet = WalletContractV5R1.create({
        publicKey: keyPair.publicKey,
        walletId: {
            networkGlobalId,
            context: {
                workchain: 0,
                subwalletNumber,
                walletVersion: 'v5r1',
            },
        },
    });
    return { address: wallet.address, keyPair, wallet };
}

function fmtAddr(a: Address): string {
    return a.toString({ urlSafe: true, bounceable: true, testOnly: true });
}

function fmtTon(nano: bigint): string {
    return `${nano.toString()} nano (${(Number(nano) / 1e9).toFixed(4)} TON)`;
}

function fmtBurn(nano: bigint): string {
    return `${nano.toString()} nano (${(Number(nano) / 1e9).toFixed(4)} BURN)`;
}

async function sleepMs(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

async function waitForWalletSeqnoAbove(
    provider: NetworkProvider,
    dw: DirectWallet,
    fromSeqno: number,
    attempts = 20,
    delayMs = 3_000,
): Promise<void> {
    for (let i = 1; i <= attempts; i++) {
        try {
            const current = await provider.open(dw.wallet).getSeqno();
            if (current > fromSeqno) {
                return;
            }
        } catch {
            // transient node error — keep polling
        }
        await sleepMs(delayMs);
    }
    throw new Error(
        `wallet ${fmtAddr(dw.address)} seqno did not advance from ${fromSeqno} after ${attempts} attempts`,
    );
}

// ─── Live state / plan ──────────────────────────────────────────────────────

type RecoveryState = {
    pollutedTon: bigint;
    stakeAmount: bigint;
    pollutedBurn: bigint;
    cleanBurn: bigint;
    sourceTon: bigint;
    pollutedJettonWallet: Address;
};

type RecoveryAddresses = {
    polluted: DirectWallet;
    clean: Address;
    source: Address;
    stakingMaster: Address;
    jettonMaster: Address;
};

async function readRecoveryState(
    provider: NetworkProvider,
    addrs: RecoveryAddresses,
): Promise<RecoveryState> {
    const pollutedTon = await readLiveTonBalance(provider, addrs.polluted.address);
    const record = await readStakeRecord(
        provider,
        addrs.stakingMaster,
        addrs.polluted.address,
        RECOVERY_TIER,
    );
    const master = provider.open(BurnJettonMaster.fromAddress(addrs.jettonMaster));
    const pollutedJettonWallet = await master.getGetWalletAddress(addrs.polluted.address);
    // readJettonWalletBalance tolerates a lazily-deployed (uninit) jetton wallet → 0.
    const pollutedBurn = await readJettonWalletBalance(provider, addrs.jettonMaster, addrs.polluted.address);
    const cleanBurn = await readJettonWalletBalance(provider, addrs.jettonMaster, addrs.clean);
    const sourceTon = await readLiveTonBalance(provider, addrs.source);
    return {
        pollutedTon,
        stakeAmount: record?.amount ?? 0n,
        pollutedBurn,
        cleanBurn,
        sourceTon,
        pollutedJettonWallet,
    };
}

function printPlan(addrs: RecoveryAddresses, state: RecoveryState): void {
    const projectedBurn = state.pollutedBurn + state.stakeAmount;
    console.log('[recover-polluted-actor] plan (no secrets — addresses and amounts only)');
    console.log('  polluted wallet     ', fmtAddr(addrs.polluted.address));
    console.log('                      ', addrs.polluted.address.toRawString());
    console.log('  clean Actor A       ', fmtAddr(addrs.clean));
    console.log('                      ', addrs.clean.toRawString());
    console.log('  source wallet       ', fmtAddr(addrs.source));
    console.log('  staking master (lab)', fmtAddr(addrs.stakingMaster));
    console.log('  jetton master (lab) ', fmtAddr(addrs.jettonMaster));
    console.log('  polluted jetton wal.', fmtAddr(state.pollutedJettonWallet));
    console.log('');
    console.log('  live state (toncenter):');
    console.log('    polluted TON      ', fmtTon(state.pollutedTon));
    console.log(`    stake (tier ${RECOVERY_TIER})    `, fmtBurn(state.stakeAmount));
    console.log('    polluted BURN     ', fmtBurn(state.pollutedBurn));
    console.log('    clean Actor BURN  ', fmtBurn(state.cleanBurn));
    console.log('    source TON        ', fmtTon(state.sourceTon));
    console.log('');
    console.log('  intended transfers (in order):');
    if (state.stakeAmount > 0n) {
        console.log(
            `    1. UnstakeJetton tier ${RECOVERY_TIER}: ${fmtBurn(state.stakeAmount)} ` +
                `→ polluted jetton wallet (attach ${fmtTon(UNSTAKE_ATTACH_TON)} from polluted wallet)`,
        );
    } else {
        console.log('    1. UnstakeJetton — SKIP (no open stake record)');
    }
    console.log(
        `    2. JettonTransfer ALL BURN (projected ≈ ${fmtBurn(projectedBurn)}; live re-read before send) ` +
            `${fmtAddr(addrs.polluted.address)} → ${fmtAddr(addrs.clean)} ` +
            `(attach ${fmtTon(BURN_TRANSFER_ATTACH)}; recipient jetton wallet auto-created)`,
    );
    console.log(
        `    3. TON sweep (balance at send time − ${TON_SWEEP_RESERVE} nano reserve; ` +
            `now ≈ ${fmtTon(computeTonSweepValue(state.pollutedTon))}) ` +
            `${fmtAddr(addrs.polluted.address)} → ${fmtAddr(addrs.source)} (bounce=true, source is active)`,
    );
    console.log(`    target: polluted wallet ends below ${fmtTon(MAX_LEFTOVER_TON)}`);
}

// ─── Live steps (only reachable with --yes) ─────────────────────────────────

async function stepUnstake(
    provider: NetworkProvider,
    addrs: RecoveryAddresses,
    stakeAmount: bigint,
): Promise<void> {
    if (stakeAmount <= 0n) {
        console.log('[recover-polluted-actor] step 1 skip — no open stake record');
        return;
    }
    const dw = addrs.polluted;
    const opened = provider.open(dw.wallet);
    const sender = opened.sender(dw.keyPair.secretKey);
    const master = provider.open(new StakingMaster(addrs.stakingMaster));
    const burnBefore = await readJettonWalletBalance(provider, addrs.jettonMaster, dw.address);
    const seqno = await opened.getSeqno();
    console.log(
        `[recover-polluted-actor] step 1 — unstake ${fmtBurn(stakeAmount)} (tier ${RECOVERY_TIER}, ` +
            `attach ${fmtTon(UNSTAKE_ATTACH_TON)})`,
    );
    await master.sendUnstakeJetton(sender, { tier: RECOVERY_TIER, amount: stakeAmount });
    await waitForWalletSeqnoAbove(provider, dw, seqno);

    // V5R1 silently skips underfunded actions (seqno grows, internal never
    // leaves) — verify by ACTUAL state, not seqno: stake record gone AND the
    // principal arrived on the polluted jetton wallet (excluded payout = full).
    const attempts = 30;
    for (let i = 1; i <= attempts; i++) {
        const record = await readStakeRecord(provider, addrs.stakingMaster, dw.address, RECOVERY_TIER);
        const burnAfter = await readJettonWalletBalance(provider, addrs.jettonMaster, dw.address);
        if ((record === null || record.amount === 0n) && burnAfter - burnBefore >= (stakeAmount * 99n) / 100n) {
            console.log(
                `[recover-polluted-actor] step 1 verified — stake record cleared, BURN ${burnBefore} → ${burnAfter}`,
            );
            return;
        }
        await sleepMs(5_000);
    }
    throw new Error(
        'unstake NOT verified: stake record still present or principal did not arrive on the ' +
            'polluted jetton wallet — check the wallet trace on testnet.tonscan.org (V5R1 may have ' +
            'silently skipped an underfunded action).',
    );
}

async function stepTransferBurn(provider: NetworkProvider, addrs: RecoveryAddresses): Promise<bigint> {
    const dw = addrs.polluted;
    // Live re-read: transfer everything present NOW (post-unstake).
    const amount = await readJettonWalletBalance(provider, addrs.jettonMaster, dw.address);
    if (amount <= 0n) {
        console.log('[recover-polluted-actor] step 2 skip — polluted jetton wallet is empty');
        return 0n;
    }
    const cleanBefore = await readJettonWalletBalance(provider, addrs.jettonMaster, addrs.clean);
    const opened = provider.open(dw.wallet);
    const sender = opened.sender(dw.keyPair.secretKey);
    const master = provider.open(BurnJettonMaster.fromAddress(addrs.jettonMaster));
    const jwAddr = await master.getGetWalletAddress(dw.address);
    const jw = provider.open(BurnJettonWallet.fromAddress(jwAddr));
    const seqno = await opened.getSeqno();
    console.log(
        `[recover-polluted-actor] step 2 — transfer ${fmtBurn(amount)} → ${fmtAddr(addrs.clean)} ` +
            `(attach ${fmtTon(BURN_TRANSFER_ATTACH)})`,
    );
    await jw.sendTransfer(sender, {
        jettonAmount: amount,
        destinationOwner: addrs.clean,
        responseDestination: dw.address,
        forwardTonAmount: 1n,
        value: BURN_TRANSFER_ATTACH,
    });
    await waitForWalletSeqnoAbove(provider, dw, seqno);

    // Fee-split path (both non-excluded) delivers ≥ 99%.
    const attempts = 30;
    for (let i = 1; i <= attempts; i++) {
        const cleanAfter = await readJettonWalletBalance(provider, addrs.jettonMaster, addrs.clean);
        if (cleanAfter - cleanBefore >= (amount * 99n) / 100n) {
            console.log(
                `[recover-polluted-actor] step 2 verified — clean Actor BURN ${cleanBefore} → ${cleanAfter}`,
            );
            return amount;
        }
        await sleepMs(5_000);
    }
    throw new Error(
        'BURN transfer NOT verified: clean Actor A jetton balance did not grow by ≥ 99% — check the ' +
            'transfer trace (exit 32113 = attach below minTonFeePath).',
    );
}

async function stepSweepTon(provider: NetworkProvider, addrs: RecoveryAddresses): Promise<void> {
    const dw = addrs.polluted;
    const balance = await readLiveTonBalance(provider, dw.address);
    const value = computeTonSweepValue(balance);
    if (value <= 0n) {
        console.log('[recover-polluted-actor] step 3 skip — nothing above the fee reserve');
        return;
    }
    const sourceBefore = await readLiveTonBalance(provider, addrs.source);
    const opened = provider.open(dw.wallet);
    const seqno = await opened.getSeqno();
    console.log(
        `[recover-polluted-actor] step 3 — sweep ${fmtTon(value)} → ${fmtAddr(addrs.source)} (bounce=true)`,
    );
    // Direct signed transfer (fund-test-wallets pattern); bounce=true is safe —
    // the source/deploy wallet is active.
    await opened.sendTransfer({
        seqno,
        secretKey: dw.keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [internal({ to: addrs.source, value, bounce: true })],
    });
    await waitForWalletSeqnoAbove(provider, dw, seqno);

    const attempts = 30;
    for (let i = 1; i <= attempts; i++) {
        const sourceAfter = await readLiveTonBalance(provider, addrs.source);
        const pollutedAfter = await readLiveTonBalance(provider, dw.address);
        if (sourceAfter - sourceBefore >= (value * 95n) / 100n && pollutedAfter < MAX_LEFTOVER_TON) {
            console.log(
                `[recover-polluted-actor] step 3 verified — source TON ${sourceBefore} → ${sourceAfter}, ` +
                    `polluted leftover ${fmtTon(pollutedAfter)}`,
            );
            return;
        }
        await sleepMs(5_000);
    }
    throw new Error(
        'TON sweep NOT verified: source balance did not grow by ≥ 95% of the sweep value or the ' +
            'polluted wallet still holds ≥ 0.1 TON — check the wallet trace on testnet.tonscan.org.',
    );
}

async function printFinalBalances(provider: NetworkProvider, addrs: RecoveryAddresses): Promise<void> {
    const pollutedTon = await readLiveTonBalance(provider, addrs.polluted.address);
    const pollutedBurn = await readJettonWalletBalance(provider, addrs.jettonMaster, addrs.polluted.address);
    const cleanBurn = await readJettonWalletBalance(provider, addrs.jettonMaster, addrs.clean);
    const sourceTon = await readLiveTonBalance(provider, addrs.source);
    const record = await readStakeRecord(
        provider,
        addrs.stakingMaster,
        addrs.polluted.address,
        RECOVERY_TIER,
    );
    console.log('[recover-polluted-actor] final balances:');
    console.log('  polluted TON        ', fmtTon(pollutedTon));
    console.log('  polluted BURN       ', fmtBurn(pollutedBurn));
    console.log(`  polluted stake t${RECOVERY_TIER}  `, fmtBurn(record?.amount ?? 0n));
    console.log('  clean Actor A BURN  ', fmtBurn(cleanBurn));
    console.log('  source TON          ', fmtTon(sourceTon));
}

// ─── Orchestration ──────────────────────────────────────────────────────────

async function executeRecovery(provider: NetworkProvider, contractsRoot: string, mode: RecoveryCliMode): Promise<void> {
    const cleanMnemonic = resolveTestActorMnemonic();
    if (!cleanMnemonic) {
        throw new Error('TEST_ACTOR_MNEMONIC unset — cannot derive the clean / polluted Actor A wallets');
    }
    const cleanWords = cleanMnemonic.split(/\s+/).filter(Boolean);
    if (cleanWords.some((w) => w.includes('"') || w.includes("'"))) {
        throw new Error(
            'TEST_ACTOR_MNEMONIC still contains literal quotes — the env loader fix (IMP-TNFS-F09) is ' +
                'not in effect; refusing to double-pollute.',
        );
    }

    const clean = await buildWalletFromWords(cleanWords);
    const polluted = await buildWalletFromWords(polluteMnemonicWords(cleanWords));

    // HARD GATE — both derivations must match the hardcoded expectations
    // before anything else happens (throws with both addresses on mismatch).
    assertDerivedAddress(clean.address, Address.parse(EXPECTED_CLEAN_FRIENDLY).toRawString(), 'clean Actor A');
    assertDerivedAddress(polluted.address, EXPECTED_POLLUTED_RAW, 'polluted wallet');
    console.log('[recover-polluted-actor] derivation gate OK');
    console.log('  clean    ', clean.address.toRawString());
    console.log('  polluted ', polluted.address.toRawString());

    const manifest = loadManifest(contractsRoot, 'lab');
    const addrs: RecoveryAddresses = {
        polluted,
        clean: clean.address,
        source: Address.parse(SOURCE_WALLET_FRIENDLY),
        stakingMaster: Address.parse(manifest.addresses.stakingMaster),
        jettonMaster: Address.parse(manifest.addresses.jettonMaster),
    };

    const state = await readRecoveryState(provider, addrs);
    printPlan(addrs, state);

    if (mode === 'dry-run') {
        console.log('[recover-polluted-actor] dry-run — no transactions sent');
        return;
    }
    if (mode === 'plan-only') {
        console.log(
            '[recover-polluted-actor] plan only — REFUSING to send without explicit --yes. ' +
                'If you passed --yes/--dry-run through `npm run`, npm may have swallowed the flags; ' +
                'invoke directly: npx ts-node --transpile-only scripts/recover-polluted-actor-testnet.ts ' +
                '--testnet --yes',
        );
        process.exitCode = 2;
        return;
    }

    // Preflight the polluted TON budget: V5R1 silently skips actions the
    // balance cannot cover (external accepted, seqno grows, nothing on-chain).
    if (state.pollutedTon < MIN_POLLUTED_TON_FOR_RECOVERY) {
        throw new Error(
            `polluted TON ${state.pollutedTon} nano < required ${MIN_POLLUTED_TON_FOR_RECOVERY} nano — ` +
                'V5R1 would silently skip underfunded actions; top up before recovery.',
        );
    }

    await stepUnstake(provider, addrs, state.stakeAmount);
    await stepTransferBurn(provider, addrs);
    await stepSweepTon(provider, addrs);
    await printFinalBalances(provider, addrs);
    console.log('[recover-polluted-actor] done — all steps verified via toncenter reads');
}

/** Provider bootstrap that keeps deploy WALLET_MNEMONIC (no Actor A switch). */
async function createTestnetNetworkProviderWithoutActor(contractsRoot: string): Promise<NetworkProvider> {
    const { createNetworkProvider } = await import('@ton/blueprint');
    const { SilentUIProvider } = await import('../testnet-scenarios/lib/provider');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    if (!process.argv.includes('--testnet')) {
        process.argv.push('--testnet');
    }
    return createNetworkProvider(
        new SilentUIProvider(),
        { _: [], '--testnet': true, '--mnemonic': true } as never,
        undefined,
        false,
    );
}

async function mainCli(): Promise<void> {
    const argv = process.argv.slice(2);
    const mode = resolveRecoveryCliMode(argv);
    if (mode === 'usage') {
        printHelp();
        return;
    }
    if (argv.includes('--mainnet')) {
        throw new Error('mainnet is hard-refused — this recovery targets the TESTNET lab tip only');
    }
    if (!argv.includes('--testnet')) {
        throw new Error('pass --testnet explicitly (testnet-only script)');
    }

    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    // Do NOT applyTestActorForScenarios — signing wallets are built directly.

    const provider = await createTestnetNetworkProviderWithoutActor(contractsRoot);
    await executeRecovery(provider, contractsRoot, mode);
}

const isDirectRun =
    typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;

if (isDirectRun) {
    mainCli().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[recover-polluted-actor]', msg);
        process.exitCode = 1;
    });
}
