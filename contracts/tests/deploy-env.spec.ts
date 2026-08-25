import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { applyBlueprintWalletAliases, initDeployEnv, loadDeployEnv, resolveMnemonic } from '../scripts/deploy/env';

const ENV_KEYS = ['WALLET_MNEMONIC', 'WALLET_VERSION', 'MNEMONIC', 'MNEMONIC_TESTNET', 'MNEMONIC_MAINNET'] as const;

describe('deploy env', () => {
    let tempRoot: string;
    const savedEnv: Record<string, string | undefined> = {};
    const savedArgv = [...process.argv];

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'burn-deploy-env-'));
        for (const key of ENV_KEYS) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        process.argv = savedArgv;
        rmSync(tempRoot, { recursive: true, force: true });
        for (const key of ENV_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    });

    it('maps MNEMONIC_TESTNET to WALLET_MNEMONIC on --testnet', () => {
        process.argv = ['node', 'blueprint', 'run', 'deploy', '--testnet', '--mnemonic'];
        writeFileSync(join(tempRoot, '.env.testnet'), 'MNEMONIC_TESTNET=word1 word2\n');

        initDeployEnv(tempRoot);

        expect(process.env.WALLET_MNEMONIC).toBe('word1 word2');
        expect(process.env.WALLET_VERSION).toBe('v5r1');
        expect(resolveMnemonic()).toBe('word1 word2');
    });

    it('maps MNEMONIC_MAINNET to WALLET_MNEMONIC on --mainnet', () => {
        process.argv = ['node', 'blueprint', 'run', 'deploy', '--mainnet', '--mnemonic'];
        writeFileSync(join(tempRoot, '.env.mainnet'), 'MNEMONIC_MAINNET=main words\n');

        initDeployEnv(tempRoot);

        expect(process.env.WALLET_MNEMONIC).toBe('main words');
    });

    it('does not override explicit WALLET_MNEMONIC', () => {
        process.argv = ['node', 'blueprint', 'run', 'deploy', '--testnet', '--mnemonic'];
        writeFileSync(join(tempRoot, '.env.testnet'), 'WALLET_MNEMONIC=explicit\nMNEMONIC_TESTNET=legacy\n');

        loadDeployEnv(tempRoot);
        applyBlueprintWalletAliases();

        expect(process.env.WALLET_MNEMONIC).toBe('explicit');
    });

    it('strips quotes AND trailing comment from quoted values (IMP-TNFS-F09 identity drift)', () => {
        // `VAR="..." # comment` used to keep the literal quotes in the value;
        // for TEST_ACTOR_MNEMONIC that polluted the first/last mnemonic words
        // and shifted the derived Actor A wallet address on live.
        process.argv = ['node', 'blueprint', 'run', 'deploy', '--testnet', '--mnemonic'];
        const saved = process.env.TEST_ACTOR_MNEMONIC;
        delete process.env.TEST_ACTOR_MNEMONIC;
        try {
            writeFileSync(
                join(tempRoot, '.env.testnet'),
                'TEST_ACTOR_MNEMONIC="alpha beta gamma" # tonkeeper-style seed\n' +
                    "MNEMONIC_TESTNET='quoted words' # single quotes too\n",
            );

            initDeployEnv(tempRoot);

            expect(process.env.TEST_ACTOR_MNEMONIC).toBe('alpha beta gamma');
            expect(process.env.MNEMONIC_TESTNET).toBe('quoted words');
        } finally {
            if (saved === undefined) {
                delete process.env.TEST_ACTOR_MNEMONIC;
            } else {
                process.env.TEST_ACTOR_MNEMONIC = saved;
            }
        }
    });

    it('strips inline comments from env values', () => {
        process.argv = ['node', 'blueprint', 'run', 'deploy', '--testnet', '--mnemonic'];
        writeFileSync(
            join(tempRoot, '.env.testnet'),
            'SUBWALLET_NUMBER=0           # optional, v5r1 wallets\nWALLET_NETWORK_ID=-3\n',
        );

        initDeployEnv(tempRoot);

        expect(process.env.SUBWALLET_NUMBER).toBe('0');
        expect(Number(process.env.SUBWALLET_NUMBER)).toBe(0);
    });

    it('network env overrides empty values from base .env', () => {
        process.argv = ['node', 'blueprint', 'run', 'deploy', '--testnet', '--mnemonic'];
        writeFileSync(join(tempRoot, '.env'), 'MNEMONIC_TESTNET=\n');
        writeFileSync(join(tempRoot, '.env.testnet'), 'MNEMONIC_TESTNET=from testnet file\n');

        initDeployEnv(tempRoot);

        expect(process.env.WALLET_MNEMONIC).toBe('from testnet file');
    });
});
