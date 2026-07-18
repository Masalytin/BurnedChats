/**
 * fs-jetton-tep74-discovery — TEP-74 get_wallet_address matches wrapper predict.
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { check } from '../lib/checks';
import {
    abiHasTep74WalletGetter,
    checkTep74Discovery,
    loadJettonMasterAbi,
} from '../lib/tep-cashback';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest, contractsRoot } = ctx;
    const checks: CheckResult[] = [];

    const abi = loadJettonMasterAbi(contractsRoot);
    checks.push(
        check(
            'tep74-getter-in-abi',
            abiHasTep74WalletGetter(abi),
            abiHasTep74WalletGetter(abi)
                ? 'ABI exposes get_wallet_address (TEP-74)'
                : 'ABI missing get_wallet_address getter',
        ),
    );

    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));

    const owners: Array<{ label: string; address: Address }> = [];
    if (manifest.addresses.airdropHolder) {
        owners.push({
            label: 'airdropHolder',
            address: Address.parse(manifest.addresses.airdropHolder),
        });
    }
    if (manifest.addresses.liquidityHolder) {
        owners.push({
            label: 'liquidityHolder',
            address: Address.parse(manifest.addresses.liquidityHolder),
        });
    }
    const sender = provider.sender().address;
    if (sender) {
        owners.push({ label: 'mnemonic-sender', address: sender });
    }
    if (owners.length === 0) {
        // Fallback: use staking master as a stable basechain owner from manifest.
        owners.push({
            label: 'stakingMaster',
            address: Address.parse(manifest.addresses.stakingMaster),
        });
    }

    for (const owner of owners) {
        const getterWallet = await master.getGetWalletAddress(owner.address);
        const predicted = await BurnJettonMaster.predictWalletAddress(jettonMaster, owner.address);
        checks.push(
            checkTep74Discovery({
                getterWallet,
                predictedWallet: predicted,
                ownerLabel: owner.label,
            }),
        );
    }

    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-tep74-discovery',
    title: 'TEP-74 wallet discovery getters',
    description:
        'Readonly: get_wallet_address matches BurnJettonMaster.predictWalletAddress for manifest owners.',
    tags: ['jetton', 'tep', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-jetton-master-smoke'],
    run: runChecks,
};

export default scenario;
