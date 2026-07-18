import { describe, expect, it } from '@jest/globals';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadManifest, resolveManifestPath } from '../lib/manifest';
import { parseCliArgs } from '../runner';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

describe('manifest shared vs lab', () => {
    it('shared resolves to deployments/testnet.json', () => {
        const path = resolveManifestPath(CONTRACTS_ROOT, 'shared');
        expect(path).toBe(resolve(CONTRACTS_ROOT, 'deployments', 'testnet.json'));
        expect(existsSync(path)).toBe(true);
    });

    it('lab resolves to deployments/testnet-lab.json', () => {
        const path = resolveManifestPath(CONTRACTS_ROOT, 'lab');
        expect(path).toBe(resolve(CONTRACTS_ROOT, 'deployments', 'testnet-lab.json'));
        expect(existsSync(path)).toBe(true);
    });

    it('loadManifest(shared) reads testnet.json masters', () => {
        const m = loadManifest(CONTRACTS_ROOT, 'shared');
        expect(m.network).toBe('testnet');
        expect(m.addresses.jettonMaster).toBeTruthy();
        expect(m.addresses.stakingMaster).toBeTruthy();
        expect(m.addresses.governor).toBeTruthy();
        expect(m.addresses.timelock).toBeTruthy();
        expect(m.addresses.treasury).toBeTruthy();
    });

    it('loadManifest(lab) reads testnet-lab.json (distinct tip)', () => {
        const shared = loadManifest(CONTRACTS_ROOT, 'shared');
        const lab = loadManifest(CONTRACTS_ROOT, 'lab');
        expect(lab.network).toBe('testnet');
        expect(lab.addresses.jettonMaster).toBeTruthy();
        // Lab tip must not silently alias shared (IMP-TNFS-01 artifacts).
        expect(lab.addresses.jettonMaster).not.toBe(shared.addresses.jettonMaster);
    });

    it('CLI --manifest lab selects lab kind', () => {
        const opts = parseCliArgs(['--list', '--manifest', 'lab']);
        expect(opts.manifest).toBe('lab');
        expect(resolveManifestPath(CONTRACTS_ROOT, opts.manifest).endsWith('testnet-lab.json')).toBe(
            true,
        );
    });
});
