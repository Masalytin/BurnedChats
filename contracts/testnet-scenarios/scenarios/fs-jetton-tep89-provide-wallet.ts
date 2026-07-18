/**
 * fs-jetton-tep89-provide-wallet — ProvideWalletAddress → TakeWalletAddress (TEP-89).
 * N/A when master ABI has no ProvideWalletAddress receiver.
 */
import { Address } from '@ton/core';
import type { ProvideWalletAddress as ProvideWalletAddressMsg } from '../../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { check } from '../lib/checks';
import {
    abiHasProvideWalletPath,
    checkTep89TakeWalletOp,
    loadJettonMasterAbi,
    opMatches,
    provideWalletNaReason,
    TAKE_WALLET_ADDRESS_OP,
    TEP89_DISCOVERY_TON,
} from '../lib/tep-cashback';
import {
    sleep,
    tonapiFetchJson,
    tonapiHost,
    tonviewerTxUrl,
    type TonapiOutMsg,
} from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

type TxRow = {
    hash?: string;
    in_msg?: {
        source?: { address?: string };
        destination?: { address?: string };
        op_code?: string;
        decoded_op_name?: string;
        decoded_body?: {
            query_id?: string | number;
            wallet_address?: { address?: string };
        };
    };
    out_msgs?: TonapiOutMsg[];
};

async function findTakeWalletResponse(
    host: string,
    sender: Address,
    master: Address,
    queryId: bigint,
): Promise<{ found: boolean; wallet?: Address | null; txHash?: string }> {
    const accountId = sender.toString({ urlSafe: true, bounceable: true });
    const url = `${host}/v2/blockchain/accounts/${accountId}/transactions?limit=15`;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
        const body = await tonapiFetchJson<{ transactions?: TxRow[] }>(url);
        for (const tx of body.transactions ?? []) {
            const im = tx.in_msg;
            if (!im) {
                continue;
            }
            const srcRaw = im.source?.address;
            if (!srcRaw) {
                continue;
            }
            let src: Address;
            try {
                src = Address.parse(srcRaw);
            } catch {
                continue;
            }
            if (!src.equals(master)) {
                continue;
            }
            const opOk =
                opMatches(im.op_code, TAKE_WALLET_ADDRESS_OP) ||
                (im.decoded_op_name ?? '').toLowerCase().includes('take_wallet');
            if (!opOk) {
                continue;
            }
            const qRaw = im.decoded_body?.query_id;
            if (qRaw !== undefined && BigInt(qRaw) !== queryId) {
                continue;
            }
            let wallet: Address | null | undefined;
            const wRaw = im.decoded_body?.wallet_address?.address;
            if (wRaw) {
                try {
                    wallet = Address.parse(wRaw);
                } catch {
                    wallet = undefined;
                }
            }
            return { found: true, wallet: wallet ?? null, txHash: tx.hash };
        }
        if (attempt < 4) {
            await sleep(2_000);
        }
    }
    return { found: false };
}

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const abi = loadJettonMasterAbi(ctx.contractsRoot);
    return provideWalletNaReason(abiHasProvideWalletPath(abi));
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const owner =
        manifest.addresses.airdropHolder != null
            ? Address.parse(manifest.addresses.airdropHolder)
            : sender;
    const expectedWallet = await master.getGetWalletAddress(owner);
    const queryId = 9001n;

    const msg: ProvideWalletAddressMsg = {
        $$type: 'ProvideWalletAddress',
        queryId,
        ownerAddress: owner,
        includeAddress: false,
    };

    console.log(
        `[fs-jetton-tep89-provide-wallet] ProvideWalletAddress queryId=${queryId} owner=${owner.toString()}…`,
    );

    const seqnoBefore = await getSenderSeqno(provider);
    await master.send(provider.sender(), { value: TEP89_DISCOVERY_TON }, msg);
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleep(2_000);

    const host = tonapiHost('testnet');
    const take = await findTakeWalletResponse(host, sender, jettonMaster, queryId);
    const checks: CheckResult[] = checkTep89TakeWalletOp({
        foundTakeWalletOp: take.found,
        queryId,
        expectedWallet,
        responseWallet: take.wallet,
    });

    if (take.txHash) {
        checks.push(
            check(
                'tep89-tonviewer',
                true,
                `TakeWalletAddress tx: ${tonviewerTxUrl('testnet', take.txHash)}`,
            ),
        );
    }

    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-tep89-provide-wallet',
    title: 'TEP-89 ProvideWalletAddress / TakeWalletAddress',
    description:
        'Live: send ProvideWalletAddress; assert TakeWalletAddress response matches get_wallet_address. N/A if ABI has no provide path.',
    tags: ['jetton', 'tep'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-tep74-discovery'],
    naWhen,
    run: runChecks,
};

export default scenario;
