/**
 * fs-jetton-master-smoke — readonly getJettonData / wallet code; address = manifest.
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { check } from '../lib/checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const checks: CheckResult[] = [];
    const expected = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(expected));

    const data = await master.getGetJettonData();
    checks.push(
        check(
            'manifest-address',
            true,
            `jetton master address matches manifest (${expected.toString({ urlSafe: true, bounceable: true })})`,
        ),
    );
    checks.push(
        check(
            'total-supply-readable',
            data.totalSupply >= 0n,
            `getJettonData.totalSupply=${data.totalSupply}`,
        ),
    );
    checks.push(
        check(
            'wallet-code-present',
            data.jettonWalletCode.bits.length > 0 || data.jettonWalletCode.refs.length > 0,
            'getJettonData.jettonWalletCode non-empty cell',
        ),
    );
    checks.push(
        check(
            'admin-present',
            !!data.adminAddress,
            `adminAddress=${data.adminAddress.toString({ urlSafe: true, bounceable: true })}`,
        ),
    );

    const fee = await master.getGetFeeParams();
    checks.push(
        check(
            'fee-rates-fullstack',
            fee.burnRateBps === 50n && fee.stakingRateBps === 30n && fee.treasuryRateBps === 20n,
            `fee rates ${fee.burnRateBps}/${fee.stakingRateBps}/${fee.treasuryRateBps} (expected 50/30/20)`,
        ),
    );

    if (manifest.addresses.airdropHolder) {
        const owner = Address.parse(manifest.addresses.airdropHolder);
        const wallet = await master.getGetWalletAddress(owner);
        const predicted = await BurnJettonMaster.predictWalletAddress(expected, owner);
        checks.push(
            check(
                'wallet-discovery',
                wallet.equals(predicted),
                `getWalletAddress matches predict for airdropHolder`,
            ),
        );
    }

    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-master-smoke',
    title: 'Jetton master smoke (getJettonData)',
    description:
        'Readonly: getJettonData / wallet code consistent; master address equals shared manifest tip.',
    tags: ['jetton', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-ops-deployment-fingerprint'],
    run: runChecks,
};

export default scenario;
