/**
 * IMP-TNFS-F29 — pin Governor / StakingMaster / JettonWallet code hashes to the
 * local MNAUD tip (F07-VP + F16 floors). Hard-fail only when explicitly opted in
 * via EXPECT_MNAUD_TIP=1 or manifest.expectMnaudTip — stale tips stay green
 * without the flag.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address, Cell, type ContractState } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { check } from './checks';
import type { CheckResult, FullStackManifest } from '../types';

export const NA_MNAUD_TIP_HASH_PIN_SKIPPED = 'mnaud-tip-hash-pin-skipped';

export type MnaudCodeHashKey = 'governor' | 'staking' | 'jettonWallet';

export type MnaudCodeHashes = Record<MnaudCodeHashKey, string>;

const BOC_RELATIVE: Record<MnaudCodeHashKey, string> = {
    governor: join('build', 'Governor', 'Governor_Governor.code.boc'),
    staking: join('build', 'StakingMaster', 'StakingMaster_StakingMaster.code.boc'),
    jettonWallet: join(
        'build',
        'BurnJettonMaster',
        'BurnJettonMaster_BurnJettonWallet.code.boc',
    ),
};

/** True when ops opted into hard MNAUD tip code-hash pin (env or manifest). */
export function shouldExpectMnaudTip(manifest: FullStackManifest): boolean {
    if (process.env.EXPECT_MNAUD_TIP === '1') {
        return true;
    }
    if (manifest.expectMnaudTip === true) {
        return true;
    }
    const lab = manifest.lab;
    if (lab && typeof lab === 'object' && lab.expectMnaudTip === true) {
        return true;
    }
    return false;
}

export function codeCellHashHex(code: Cell): string {
    return code.hash().toString('hex');
}

/** Load expected hashes from local build/*.code.boc artifacts (post-npm run build). */
export function loadLocalMnaudCodeHashes(contractsRoot: string): MnaudCodeHashes {
    const out = {} as MnaudCodeHashes;
    for (const key of Object.keys(BOC_RELATIVE) as MnaudCodeHashKey[]) {
        const path = join(contractsRoot, BOC_RELATIVE[key]);
        if (!existsSync(path)) {
            throw new Error(
                `MNAUD tip expected code missing: ${path} — run npm run build in contracts/`,
            );
        }
        const code = Cell.fromBoc(readFileSync(path))[0]!;
        out[key] = codeCellHashHex(code);
    }
    return out;
}

export function activeAccountCodeHashHex(state: ContractState): string | null {
    if (state.state.type !== 'active') {
        return null;
    }
    const codeBuf = state.state.code;
    if (!codeBuf || codeBuf.length === 0) {
        return null;
    }
    // @ton/core ≥0.63: active.code is BOC Buffer, not Cell.
    return codeCellHashHex(Cell.fromBoc(codeBuf)[0]!);
}

export async function readActiveAccountCodeHash(
    provider: NetworkProvider,
    address: Address,
): Promise<{ hash: string | null; stateType: string }> {
    const state = await provider.provider(address).getState();
    return { hash: activeAccountCodeHashHex(state), stateType: state.state.type };
}

/**
 * Soft N/A when pin is not requested — old tips must not hard-fail.
 * Hard FAIL on mismatch / missing BOC / non-active account when pin is on.
 */
export function checkMnaudTipCodeHashes(input: {
    expectPin: boolean;
    expected: MnaudCodeHashes | null;
    actual: Partial<MnaudCodeHashes>;
    loadError?: string;
}): CheckResult[] {
    if (!input.expectPin) {
        return [
            check(
                'mnaud-tip-code-hashes',
                true,
                `N/A: ${NA_MNAUD_TIP_HASH_PIN_SKIPPED} — set EXPECT_MNAUD_TIP=1 or ` +
                    'manifest.expectMnaudTip after F07/F16 lab redeploy',
            ),
        ];
    }

    if (input.loadError || !input.expected) {
        return [
            check(
                'mnaud-tip-code-hashes',
                false,
                input.loadError ?? 'MNAUD tip expected code hashes unavailable',
            ),
        ];
    }

    const checks: CheckResult[] = [];
    for (const key of Object.keys(input.expected) as MnaudCodeHashKey[]) {
        const want = input.expected[key];
        const got = input.actual[key];
        if (!got) {
            checks.push(
                check(
                    `mnaud-code-hash-${key}`,
                    false,
                    `on-chain ${key} code hash missing (account not active or getter failed)`,
                ),
            );
            continue;
        }
        checks.push(
            check(
                `mnaud-code-hash-${key}`,
                got === want,
                got === want
                    ? `${key} code hash matches local MNAUD tip (${got.slice(0, 12)}…)`
                    : `${key} code hash mismatch: on-chain=${got} local-build=${want} ` +
                          '(stale tip — redeploy lab/shared after F07/F16 merge)',
            ),
        );
    }
    return checks;
}

/**
 * When pin is on and manifest.codeHashes lists governor/staking/jetton(Wallet),
 * require those pins to match the local build (ops wrote them after redeploy).
 */
export function checkManifestCodeHashesVsLocal(
    expectPin: boolean,
    expected: MnaudCodeHashes | null,
    manifestHashes: FullStackManifest['codeHashes'] | undefined,
): CheckResult[] {
    if (!expectPin || !expected || !manifestHashes) {
        return [];
    }
    const pairs: Array<{ name: string; manifestKey: string; local: string; value?: string }> = [
        { name: 'governor', manifestKey: 'governor', local: expected.governor, value: manifestHashes.governor },
        { name: 'staking', manifestKey: 'staking', local: expected.staking, value: manifestHashes.staking },
        {
            name: 'jettonWallet',
            manifestKey: 'jettonWallet|jetton',
            local: expected.jettonWallet,
            value: manifestHashes.jettonWallet ?? manifestHashes.jetton,
        },
    ];
    const out: CheckResult[] = [];
    for (const p of pairs) {
        if (!p.value) {
            continue;
        }
        out.push(
            check(
                `manifest-code-hash-${p.name}`,
                p.value === p.local,
                p.value === p.local
                    ? `manifest.codeHashes.${p.manifestKey} matches local build`
                    : `manifest.codeHashes for ${p.name}=${p.value} ≠ local ${p.local} — update after redeploy`,
            ),
        );
    }
    return out;
}
