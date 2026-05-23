import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load `.env.testnet` then `.env` from contracts root (does not override existing env). */
export function loadDeployEnv(contractsRoot: string): void {
    for (const name of ['.env.testnet', '.env']) {
        const filePath = resolve(contractsRoot, name);
        if (!existsSync(filePath)) {
            continue;
        }
        const text = readFileSync(filePath, 'utf8');
        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) {
                continue;
            }
            const eq = line.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            const key = line.slice(0, eq).trim();
            let val = line.slice(eq + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
            ) {
                val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) {
                process.env[key] = val;
            }
        }
    }
}

export function resolveMnemonic(): string | undefined {
    return (
        process.env.MNEMONIC?.trim() ||
        process.env.MNEMONIC_TESTNET?.trim() ||
        undefined
    );
}

export function resolveToncenterApiKey(): string | undefined {
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
