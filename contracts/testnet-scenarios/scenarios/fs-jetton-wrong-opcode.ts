/**
 * fs-jetton-wrong-opcode — unknown opcode → bounce/ignore without state corruption.
 */
import { Address, beginCell, toNano } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { checkWrongOpcodeSafe } from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** Deliberately unused opcode (not in master receive handlers). */
const UNKNOWN_OPCODE = 0xdeadbeef;

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));

    const before = await master.getGetJettonData();
    const walletCodeHashBefore = before.jettonWalletCode.hash().toString('hex');

    const body = beginCell().storeUint(UNKNOWN_OPCODE, 32).storeUint(0, 64).endCell();
    console.log(
        `[fs-jetton-wrong-opcode] sending opcode 0x${UNKNOWN_OPCODE.toString(16)} to master…`,
    );

    const seqnoBefore = await getSenderSeqno(provider);
    // Raw cell body — unknown opcode; contract should bounce/ignore without mutating state.
    await provider.provider(jettonMaster).internal(provider.sender(), {
        value: toNano('0.05'),
        bounce: true,
        body,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    // Brief settle for any bounce path
    await new Promise((r) => setTimeout(r, 2_000));

    const after = await master.getGetJettonData();
    const walletCodeHashAfter = after.jettonWalletCode.hash().toString('hex');

    return checkWrongOpcodeSafe({
        supplyBefore: before.totalSupply,
        supplyAfter: after.totalSupply,
        walletCodeHashBefore,
        walletCodeHashAfter,
    });
}

export const scenario: Scenario = {
    id: 'fs-jetton-wrong-opcode',
    title: 'Unknown opcode safe (no state corruption)',
    description:
        'Send unknown opcode to jetton master; assert totalSupply and wallet code unchanged.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-master-smoke'],
    run: runChecks,
};

export default scenario;
