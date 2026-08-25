/**
 * Timelock.governor multisig env helpers (PARAMETERS_DECISION §2 B).
 * Used by future lab harness; bootstrap only needs TIMELOCK_GOVERNOR today.
 */
import { mnemonicToPrivateKey } from '@ton/crypto';
import { Address, WalletContractV5R1 } from '@ton/ton';

export type MultisigSignerSlot = {
    index: number;
    mnemonic: string;
    address: Address;
    publicKey: Buffer;
};

export type ResolvedMultisigEnv = {
    governor: Address;
    kind: string;
    threshold: number;
    signers: MultisigSignerSlot[];
};

const SIGNER_COUNT = 3;

function envTrim(key: string): string | undefined {
    const v = process.env[key]?.trim();
    return v && v.length > 0 ? v : undefined;
}

export function resolveTimelockGovernorAddress(env: NodeJS.ProcessEnv = process.env): Address | null {
    const raw = env.TIMELOCK_GOVERNOR?.trim() || env.TIMELOCK_GOVERNOR_MULTISIG?.trim();
    return raw ? Address.parse(raw) : null;
}

export function resolveMultisigThreshold(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.MULTISIG_THRESHOLD?.trim();
    if (!raw) {
        return 2;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
        throw new Error(`MULTISIG_THRESHOLD must be a positive integer, got ${raw}`);
    }
    return n;
}

export function resolveMultisigKind(env: NodeJS.ProcessEnv = process.env): string {
    return env.MULTISIG_KIND?.trim() || 'ton-multisig-v2';
}

async function deriveV5R1AddressFromMnemonic(mnemonic: string): Promise<{
    address: Address;
    publicKey: Buffer;
}> {
    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    if (words.length < 12) {
        throw new Error('multisig signer mnemonic must be at least 12 words');
    }
    const key = await mnemonicToPrivateKey(words);
    const networkGlobalId = Number(process.env.WALLET_NETWORK_ID ?? '-3');
    const subwalletNumber = Number(process.env.SUBWALLET_NUMBER ?? '0');
    const wallet = WalletContractV5R1.create({
        publicKey: key.publicKey,
        walletId: {
            networkGlobalId,
            context: {
                workchain: 0,
                subwalletNumber,
                walletVersion: 'v5r1',
            },
        },
    });
    return { address: wallet.address, publicKey: Buffer.from(key.publicKey) };
}

/**
 * Load signer slots 1..3 from env. Skips empty mnemonic slots.
 * Optional MULTISIG_SIGNER_N_ADDRESS overrides derived address (must match pubkey wallet
 * used for signing — override is for reporting only when derivation knobs match).
 */
export async function loadMultisigSignerSlots(_env: NodeJS.ProcessEnv = process.env): Promise<MultisigSignerSlot[]> {
    const slots: MultisigSignerSlot[] = [];
    for (let i = 1; i <= SIGNER_COUNT; i += 1) {
        const mnemonic = envTrim(`MULTISIG_SIGNER_${i}_MNEMONIC`);
        if (!mnemonic) {
            continue;
        }
        const derived = await deriveV5R1AddressFromMnemonic(mnemonic);
        const override = envTrim(`MULTISIG_SIGNER_${i}_ADDRESS`);
        const address = override ? Address.parse(override) : derived.address;
        slots.push({
            index: i,
            mnemonic,
            address,
            publicKey: derived.publicKey,
        });
    }
    return slots;
}

/**
 * Validate env for agent-autonomous lab Timelock-via-multisig work.
 * Does not deploy or send txs.
 */
export async function assertMultisigLabEnvReady(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedMultisigEnv> {
    const governor = resolveTimelockGovernorAddress(env);
    if (!governor) {
        throw new Error(
            'TIMELOCK_GOVERNOR unset — deploy a throwaway testnet multisig and set the address ' +
                '(see contracts/deployments/README.md § Timelock governor multisig)',
        );
    }
    const threshold = resolveMultisigThreshold(env);
    const kind = resolveMultisigKind(env);
    const signers = await loadMultisigSignerSlots(env);
    if (signers.length < threshold) {
        throw new Error(`need at least MULTISIG_THRESHOLD=${threshold} signer mnemonics, have ${signers.length}`);
    }
    return { governor, kind, threshold, signers };
}

/** Soft preflight for docs/scripts — returns missing requirement strings. */
export async function listMultisigLabEnvGaps(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
    const gaps: string[] = [];
    if (!resolveTimelockGovernorAddress(env)) {
        gaps.push('TIMELOCK_GOVERNOR (deploy throwaway testnet multisig and set address)');
    }
    const threshold = resolveMultisigThreshold(env);
    const signers = await loadMultisigSignerSlots(env);
    if (signers.length < threshold) {
        gaps.push(`MULTISIG_SIGNER_*_MNEMONIC (≥${threshold}; currently ${signers.length} filled)`);
    }
    if (!env.MULTISIG_KIND?.trim()) {
        gaps.push('MULTISIG_KIND (optional default ton-multisig-v2)');
    }
    if (!env.MULTISIG_THRESHOLD?.trim()) {
        gaps.push('MULTISIG_THRESHOLD (optional default 2)');
    }
    return gaps;
}
