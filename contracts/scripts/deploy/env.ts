import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_WALLET_VERSION = 'v4r2';

function parseEnvLine(rawLine: string): { key: string; val: string } | undefined {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
        return undefined;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
        return undefined;
    }
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
    }
    return { key, val };
}

function applyEnvFile(filePath: string, overrideEmpty = false): void {
    if (!existsSync(filePath)) {
        return;
    }
    const text = readFileSync(filePath, 'utf8');
    for (const rawLine of text.split('\n')) {
        const parsed = parseEnvLine(rawLine);
        if (!parsed) {
            continue;
        }
        const current = process.env[parsed.key];
        if (current === undefined || (overrideEmpty && current === '')) {
            process.env[parsed.key] = parsed.val;
        }
    }
}

function resolveNetworkEnvFileNames(): string[] {
    const argv = process.argv;
    if (argv.includes('--mainnet')) {
        return ['.env.mainnet'];
    }
    if (argv.includes('--testnet')) {
        return ['.env.testnet'];
    }
    return ['.env.testnet', '.env.mainnet'];
}

/** Load `.env` then network-specific files (override empty values from base `.env`). */
export function loadDeployEnv(contractsRoot: string): void {
    applyEnvFile(resolve(contractsRoot, '.env'));
    for (const name of resolveNetworkEnvFileNames()) {
        applyEnvFile(resolve(contractsRoot, name), true);
    }
}

/** Map legacy MNEMONIC_* vars to Blueprint WALLET_* and apply defaults. */
export function applyBlueprintWalletAliases(): void {
    if (!process.env.WALLET_MNEMONIC?.trim()) {
        const isMainnet = process.argv.includes('--mainnet');
        const legacy =
            (isMainnet ? process.env.MNEMONIC_MAINNET : process.env.MNEMONIC_TESTNET)?.trim() ||
            process.env.MNEMONIC?.trim();
        if (legacy) {
            process.env.WALLET_MNEMONIC = legacy;
        }
    }

    if (!process.env.WALLET_VERSION?.trim()) {
        process.env.WALLET_VERSION = DEFAULT_WALLET_VERSION;
    }
}

/** Early bootstrap for Blueprint CLI (called from blueprint.config.ts). */
export function initDeployEnv(contractsRoot: string): void {
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
}

export function resolveMnemonic(): string | undefined {
    return (
        process.env.WALLET_MNEMONIC?.trim() ||
        process.env.MNEMONIC?.trim() ||
        process.env.MNEMONIC_TESTNET?.trim() ||
        process.env.MNEMONIC_MAINNET?.trim() ||
        undefined
    );
}

export function resolveToncenterApiKey(): string | undefined {
    const isMainnet = process.argv.includes('--mainnet');
    if (isMainnet) {
        return process.env.TONCENTER_API_KEY?.trim() || undefined;
    }
    return (
        process.env.TONCENTER_API_KEY_TESTNET?.trim() ||
        process.env.TONCENTER_API_KEY?.trim() ||
        undefined
    );
}

export function isForceRedeploy(): boolean {
    return process.argv.includes('--force');
}

export function isDryRun(): boolean {
    return process.argv.includes('--dry-run');
}
