/**
 * fs-jetton-plain-ton-cashback — accidental plain TON to master → cashback (IMP-RELAY-04).
 * N/A when master has no empty-receive cashback path.
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    abiHasPlainTonCashbackPath,
    cashbackNaReason,
    checkPlainTonCashback,
    loadJettonMasterAbi,
    loadJettonMasterTact,
    PLAIN_TON_CASHBACK_SEND,
} from '../lib/tep-cashback';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

async function readTonBalance(
    provider: ScenarioContext['provider'],
    address: Address,
): Promise<bigint> {
    const state = await provider.provider(address).getState();
    return state.balance;
}

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const abi = loadJettonMasterAbi(ctx.contractsRoot);
    const tact = loadJettonMasterTact(ctx.contractsRoot);
    return cashbackNaReason(abiHasPlainTonCashbackPath(abi, tact));
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));

    // Timelock sender would skip cashback — must use non-timelock mnemonic wallet.
    const timelock = Address.parse(manifest.addresses.timelock);
    if (sender.equals(timelock)) {
        throw new Error(
            'Mnemonic wallet is timelock — plain-TON cashback is skipped for timelock sender on master.',
        );
    }

    const before = await readTonBalance(provider, sender);
    console.log(
        `[fs-jetton-plain-ton-cashback] sending ${PLAIN_TON_CASHBACK_SEND} nano plain TON to master…`,
    );

    const seqnoBefore = await getSenderSeqno(provider);
    await master.send(provider.sender(), { value: PLAIN_TON_CASHBACK_SEND }, null);
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    let after = await readTonBalance(provider, sender);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const loss = before - after;
        if (loss <= PLAIN_TON_CASHBACK_SEND / 2n) {
            break;
        }
        await new Promise((r) => setTimeout(r, 2_000));
        after = await readTonBalance(provider, sender);
    }

    return checkPlainTonCashback({
        balanceBefore: before,
        balanceAfter: after,
        attachNano: PLAIN_TON_CASHBACK_SEND,
    });
}

export const scenario: Scenario = {
    id: 'fs-jetton-plain-ton-cashback',
    title: 'Plain TON to master cashback',
    description:
        'Live: send empty-body TON to jetton master; assert sender recovers attach via cashback (gas-bounded loss). N/A if cashback path absent.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-master-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
