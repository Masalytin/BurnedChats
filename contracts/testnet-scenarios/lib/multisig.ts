/**
 * Lab Timelock.governor via throwaway ton-multisig-v2 (IMP-MNAUD-F15).
 *
 * When on-chain `Timelock.get_governor` equals the deploy EOA → reuse
 * `resolveDeployerSender` (byte-compatible with IMP-TNFS-F16).
 * When it equals `TIMELOCK_GOVERNOR` → pack order + ≥threshold approve and
 * deliver Timelock messages from the multisig contract.
 *
 * Never logs mnemonics. Mainnet signer keys must not appear in agent env.
 */
import {
    Address,
    beginCell,
    Cell,
    Dictionary,
    SendMode,
    storeMessageRelaxed,
    toNano,
    type Sender,
    type SenderArguments,
    type TupleItem,
} from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import {
    assertMultisigLabEnvReady,
    listMultisigLabEnvGaps,
    resolveMultisigKind,
    resolveTimelockGovernorAddress,
    type ResolvedMultisigEnv,
} from '../../scripts/deploy/multisig-env';
import {
    readTimelockGovernor,
    resolveDeployerSender,
    type DeployerSender,
} from './gov';
import { sleepMs } from './treasury';
import type { ScenarioContext } from '../types';

/** ton-blockchain/multisig-contract-v2 opcodes (vendored — see decision-log). */
const OP_NEW_ORDER = 0xf718510f;
const OP_ORDER_APPROVE = 0xa762230f;
const OP_SEND_MESSAGE = 0xf1381e5b;

const BIT_OP = 32;
const BIT_QUERY = 64;
const BIT_ORDER_SEQNO = 256;
const BIT_SIGNER_IDX = 8;
const BIT_TIME = 48;

/** Extra TON attached to `new_order` beyond the relayed Timelock value (order deploy + gas). */
const NEW_ORDER_OVERHEAD_TON = toNano('0.35');
const APPROVE_TON = toNano('0.12');
const ORDER_EXPIRE_SEC = 3600;

const SEQNO_POLL_ATTEMPTS = 40;
const SEQNO_POLL_SLEEP_MS = 3_000;
const ORDER_EXEC_POLL_ATTEMPTS = 40;
const ORDER_EXEC_POLL_SLEEP_MS = 3_000;

export const NA_MULTISIG_ENV_INCOMPLETE =
    'multisig Timelock.governor env incomplete (TIMELOCK_GOVERNOR / MULTISIG_SIGNER_* / threshold) — see deployments README § Timelock governor multisig';

export const NA_MULTISIG_UNDERFUNDED =
    'multisig Timelock.governor underfunded for queue/execute attach — fund TIMELOCK_GOVERNOR with testnet TON';

export const NA_MULTISIG_KIND_UNSUPPORTED =
    'unsupported MULTISIG_KIND — lab harness only supports ton-multisig-v2 (IMP-MNAUD-F15)';

export type TimelockGovernorPathKind = 'eoa' | 'multisig' | 'mismatch';

/**
 * Pure path selector (unit-tested). Prefer EOA when on-chain governor is the
 * deploy wallet; otherwise require env governor address equality for multisig.
 */
export function selectTimelockGovernorPath(input: {
    onChainGovernor: Address;
    deployerAddress: Address;
    envGovernor: Address | null;
}): TimelockGovernorPathKind {
    if (input.onChainGovernor.equals(input.deployerAddress)) {
        return 'eoa';
    }
    if (input.envGovernor && input.onChainGovernor.equals(input.envGovernor)) {
        return 'multisig';
    }
    return 'mismatch';
}

export function packTransferAction(args: {
    to: Address;
    value: bigint;
    body: Cell;
    bounce?: boolean;
    sendMode?: number;
}): Cell {
    const message = beginCell()
        .store(
            storeMessageRelaxed({
                info: {
                    type: 'internal',
                    ihrDisabled: true,
                    bounce: args.bounce ?? true,
                    bounced: false,
                    dest: args.to,
                    value: { coins: args.value },
                    ihrFee: 0n,
                    forwardFee: 0n,
                    createdLt: 0n,
                    createdAt: 0,
                },
                body: args.body,
            }),
        )
        .endCell();
    return beginCell()
        .storeUint(OP_SEND_MESSAGE, BIT_OP)
        .storeUint(args.sendMode ?? SendMode.PAY_GAS_SEPARATELY, 8)
        .storeRef(message)
        .endCell();
}

export function packOrderActions(actions: Cell[]): Cell {
    const dict = Dictionary.empty(Dictionary.Keys.Uint(8), Dictionary.Values.Cell());
    for (let i = 0; i < actions.length; i += 1) {
        dict.set(i, actions[i]!);
    }
    return beginCell().storeDictDirect(dict).endCell();
}

export function packNewOrderBody(args: {
    orderCell: Cell;
    expirationSec: number;
    isSigner: boolean;
    signerIndex: number;
    orderSeqno: bigint;
    queryId?: bigint;
}): Cell {
    return beginCell()
        .storeUint(OP_NEW_ORDER, BIT_OP)
        .storeUint(args.queryId ?? 0n, BIT_QUERY)
        .storeUint(args.orderSeqno, BIT_ORDER_SEQNO)
        .storeBit(args.isSigner)
        .storeUint(args.signerIndex, BIT_SIGNER_IDX)
        .storeUint(args.expirationSec, BIT_TIME)
        .storeRef(args.orderCell)
        .endCell();
}

export function packOrderApproveBody(args: {
    signerIndex: number;
    queryId?: bigint;
}): Cell {
    return beginCell()
        .storeUint(OP_ORDER_APPROVE, BIT_OP)
        .storeUint(args.queryId ?? 0n, BIT_QUERY)
        .storeUint(args.signerIndex, BIT_SIGNER_IDX)
        .endCell();
}

function cellToAddressArray(addrDict: Cell | null): Address[] {
    if (!addrDict) {
        return [];
    }
    const dict = Dictionary.loadDirect(
        Dictionary.Keys.Uint(8),
        Dictionary.Values.Address(),
        addrDict,
    );
    return dict.values();
}

async function readMultisigData(
    ctx: ScenarioContext,
    multisig: Address,
): Promise<{ nextOrderSeqno: bigint; threshold: number; signers: Address[] }> {
    const { stack } = await ctx.provider.provider(multisig).get('get_multisig_data', []);
    const nextOrderSeqno = stack.readBigNumber();
    const threshold = Number(stack.readBigNumber());
    const signers = cellToAddressArray(stack.readCellOpt());
    // proposers cell — discard
    stack.readCellOpt();
    return { nextOrderSeqno, threshold, signers };
}

async function readOrderAddress(
    ctx: ScenarioContext,
    multisig: Address,
    orderSeqno: bigint,
): Promise<Address> {
    const { stack } = await ctx.provider.provider(multisig).get('get_order_address', [
        { type: 'int', value: orderSeqno } as TupleItem,
    ]);
    return stack.readAddress();
}

async function readOrderExecuted(
    ctx: ScenarioContext,
    order: Address,
): Promise<boolean | null> {
    try {
        const { stack } = await ctx.provider.provider(order).get('get_order_data', []);
        stack.readAddress(); // multisig
        stack.readBigNumber(); // order_seqno
        const threshold = stack.readNumberOpt();
        if (threshold === null) {
            return null; // not inited yet
        }
        const executed = stack.readBooleanOpt();
        return executed === true;
    } catch {
        return null;
    }
}

type OpenedSigner = {
    indexOnChain: number;
    address: Address;
    sender: Sender;
    getSeqno: () => Promise<number>;
};

async function openSignerWallet(
    ctx: ScenarioContext,
    mnemonic: string,
): Promise<{ address: Address; sender: Sender; getSeqno: () => Promise<number> }> {
    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    if (words.length < 12) {
        throw new Error('multisig signer mnemonic must be at least 12 words');
    }
    const keyPair = await mnemonicToPrivateKey(words);
    const version = (process.env.WALLET_VERSION?.trim() || 'v5r1').toLowerCase();
    if (version === 'v5r1') {
        const networkGlobalId = Number(process.env.WALLET_NETWORK_ID ?? '-3');
        const subwalletNumber = Number(process.env.SUBWALLET_NUMBER ?? '0');
        const wallet = WalletContractV5R1.create({
            publicKey: keyPair.publicKey,
            walletId: {
                networkGlobalId,
                context: {
                    workchain: 0,
                    subwalletNumber,
                    walletVersion: 'v5r1',
                },
            },
        });
        const opened = ctx.provider.open(wallet);
        const raw = opened.sender(keyPair.secretKey);
        const sender: Sender = { address: wallet.address, send: (a) => raw.send(a) };
        return { address: wallet.address, sender, getSeqno: () => opened.getSeqno() };
    }
    if (version === 'v4r2' || version === 'v4') {
        const walletId = process.env.WALLET_ID?.trim() ? Number(process.env.WALLET_ID) : undefined;
        const wallet = WalletContractV4.create({
            workchain: 0,
            publicKey: keyPair.publicKey,
            walletId,
        });
        const opened = ctx.provider.open(wallet);
        const raw = opened.sender(keyPair.secretKey);
        const sender: Sender = { address: wallet.address, send: (a) => raw.send(a) };
        return { address: wallet.address, sender, getSeqno: () => opened.getSeqno() };
    }
    throw new Error(`Unsupported WALLET_VERSION=${version} for multisig signers`);
}

async function waitWalletSeqno(
    getSeqno: () => Promise<number>,
    fromSeqno: number,
    label: string,
): Promise<void> {
    for (let i = 1; i <= SEQNO_POLL_ATTEMPTS; i += 1) {
        try {
            if ((await getSeqno()) > fromSeqno) {
                return;
            }
        } catch {
            // transient
        }
        await sleepMs(SEQNO_POLL_SLEEP_MS);
    }
    throw new Error(
        `${label} seqno did not advance from ${fromSeqno} after ${SEQNO_POLL_ATTEMPTS} attempts`,
    );
}

async function waitOrderExecuted(
    ctx: ScenarioContext,
    order: Address,
): Promise<void> {
    for (let i = 1; i <= ORDER_EXEC_POLL_ATTEMPTS; i += 1) {
        const executed = await readOrderExecuted(ctx, order);
        if (executed === true) {
            return;
        }
        await sleepMs(ORDER_EXEC_POLL_SLEEP_MS);
    }
    throw new Error(
        `multisig order ${order.toString({ urlSafe: true, bounceable: true })} ` +
            `did not execute after ${ORDER_EXEC_POLL_ATTEMPTS} polls`,
    );
}

function mapSignersToOnChain(
    env: ResolvedMultisigEnv,
    onChainSigners: Address[],
    opened: Array<{ address: Address; sender: Sender; getSeqno: () => Promise<number> }>,
): OpenedSigner[] {
    const mapped: OpenedSigner[] = [];
    for (let i = 0; i < env.signers.length; i += 1) {
        const slot = env.signers[i]!;
        const wallet = opened[i]!;
        const indexOnChain = onChainSigners.findIndex((a) => a.equals(wallet.address));
        if (indexOnChain < 0) {
            throw new Error(
                `MULTISIG_SIGNER_${slot.index} address ` +
                    `${wallet.address.toString({ urlSafe: true, bounceable: true })} ` +
                    `is not in on-chain multisig signers — check derivation knobs / ADDRESS override`,
            );
        }
        mapped.push({
            indexOnChain,
            address: wallet.address,
            sender: wallet.sender,
            getSeqno: wallet.getSeqno,
        });
    }
    mapped.sort((a, b) => a.indexOnChain - b.indexOnChain);
    return mapped;
}

/**
 * Soft N/A when tip governor is multisig but agent cannot act (env / kind).
 * Returns null when EOA path applies or multisig env looks ready (balance
 * checked separately by runner budget preflight).
 */
export async function naWhenMultisigGovernorUnavailable(
    ctx: ScenarioContext,
    onChainGovernor: Address,
    deployerAddress: Address,
): Promise<string | null> {
    const envGovernor = resolveTimelockGovernorAddress();
    const path = selectTimelockGovernorPath({
        onChainGovernor,
        deployerAddress,
        envGovernor,
    });
    if (path === 'eoa') {
        return null;
    }
    if (path === 'mismatch') {
        return NA_MULTISIG_ENV_INCOMPLETE;
    }
    const kind = resolveMultisigKind();
    if (kind !== 'ton-multisig-v2') {
        return NA_MULTISIG_KIND_UNSUPPORTED;
    }
    const gaps = await listMultisigLabEnvGaps();
    const hard = gaps.filter(
        (g) => g.includes('TIMELOCK_GOVERNOR') || g.includes('MULTISIG_SIGNER'),
    );
    if (hard.length > 0) {
        return `${NA_MULTISIG_ENV_INCOMPLETE} (${hard.join('; ')})`;
    }
    try {
        await assertMultisigLabEnvReady();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `${NA_MULTISIG_ENV_INCOMPLETE} (${msg})`;
    }
    return null;
}

async function makeMultisigGovernorSender(
    ctx: ScenarioContext,
    governor: Address,
): Promise<DeployerSender> {
    const kind = resolveMultisigKind();
    if (kind !== 'ton-multisig-v2') {
        throw new Error(NA_MULTISIG_KIND_UNSUPPORTED);
    }
    const env = await assertMultisigLabEnvReady();
    if (!env.governor.equals(governor)) {
        throw new Error(
            'TIMELOCK_GOVERNOR env does not match on-chain Timelock.governor\n' +
                `  env: ${env.governor.toString({ urlSafe: true, bounceable: true })}\n` +
                `  on-chain: ${governor.toString({ urlSafe: true, bounceable: true })}`,
        );
    }

    const openedWallets = await Promise.all(
        env.signers.map((s) => openSignerWallet(ctx, s.mnemonic)),
    );
    const data = await readMultisigData(ctx, governor);
    const threshold = Math.max(env.threshold, data.threshold);
    const mapped = mapSignersToOnChain(env, data.signers, openedWallets);
    if (mapped.length < threshold) {
        throw new Error(
            `need ≥${threshold} mapped signers for on-chain multisig, have ${mapped.length}`,
        );
    }

    let completedOrders = 0;

    const sendViaMultisig = async (args: SenderArguments): Promise<void> => {
        if (!args.body) {
            throw new Error('multisig Timelock send requires a body cell');
        }
        const fresh = await readMultisigData(ctx, governor);
        const orderSeqno = fresh.nextOrderSeqno;
        const orderAddr = await readOrderAddress(ctx, governor, orderSeqno);
        const action = packTransferAction({
            to: args.to,
            value: args.value,
            body: args.body,
            bounce: args.bounce ?? true,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });
        const orderCell = packOrderActions([action]);
        const expirationSec = Math.floor(Date.now() / 1000) + ORDER_EXPIRE_SEC;
        const proposers = mapped.slice(0, threshold);
        const first = proposers[0]!;
        const newOrderValue = args.value + NEW_ORDER_OVERHEAD_TON;

        console.log(
            `[multisig] new_order seqno=${orderSeqno} signerIdx=${first.indexOnChain} ` +
                `to=${args.to.toString({ urlSafe: true, bounceable: true })} ` +
                `value=${args.value} order=${orderAddr.toString({ urlSafe: true, bounceable: true })}`,
        );

        let seq = await first.getSeqno();
        await first.sender.send({
            to: governor,
            value: newOrderValue,
            bounce: true,
            body: packNewOrderBody({
                orderCell,
                expirationSec,
                isSigner: true,
                signerIndex: first.indexOnChain,
                orderSeqno,
            }),
        });
        await waitWalletSeqno(first.getSeqno, seq, `multisig signer ${first.indexOnChain}`);

        // First signer auto-approves on new_order; collect remaining approvals.
        for (let i = 1; i < proposers.length; i += 1) {
            const signer = proposers[i]!;
            // Wait until order is inited before approving.
            for (let attempt = 0; attempt < 15; attempt += 1) {
                const executed = await readOrderExecuted(ctx, orderAddr);
                if (executed !== null) {
                    break;
                }
                await sleepMs(2_000);
            }
            console.log(
                `[multisig] approve order=${orderAddr.toString({ urlSafe: true, bounceable: true })} ` +
                    `signerIdx=${signer.indexOnChain}`,
            );
            seq = await signer.getSeqno();
            await signer.sender.send({
                to: orderAddr,
                value: APPROVE_TON,
                bounce: true,
                body: packOrderApproveBody({ signerIndex: signer.indexOnChain }),
            });
            await waitWalletSeqno(signer.getSeqno, seq, `multisig signer ${signer.indexOnChain}`);
        }

        await waitOrderExecuted(ctx, orderAddr);
        completedOrders += 1;
    };

    const sender: Sender = {
        address: governor,
        send: sendViaMultisig,
    };

    return {
        sender,
        address: governor,
        getSeqno: async () => {
            const { nextOrderSeqno } = await readMultisigData(ctx, governor);
            // Prefer on-chain nextOrderSeqno; fall back to local completed count
            // when the node lags right after execution.
            return Math.max(Number(nextOrderSeqno), completedOrders);
        },
        waitSeqnoIncrement: async (fromSeqno: number) => {
            for (let i = 1; i <= SEQNO_POLL_ATTEMPTS; i += 1) {
                try {
                    const { nextOrderSeqno } = await readMultisigData(ctx, governor);
                    if (Number(nextOrderSeqno) > fromSeqno || completedOrders > fromSeqno) {
                        return;
                    }
                } catch {
                    // transient
                }
                await sleepMs(SEQNO_POLL_SLEEP_MS);
            }
            // send() already waited for order execution — treat as soft-ok when
            // completedOrders advanced locally even if get_multisig_data lags.
            if (completedOrders > fromSeqno) {
                return;
            }
            throw new Error(
                `multisig ${governor.toString({ urlSafe: true, bounceable: true })} ` +
                    `order seqno did not advance from ${fromSeqno}`,
            );
        },
    };
}

/**
 * Resolve the sender that must equal on-chain `Timelock.governor`.
 * EOA path when governor == deploy wallet; multisig otherwise.
 */
export async function resolveTimelockGovernorSender(
    ctx: ScenarioContext,
): Promise<DeployerSender> {
    const deployer = await resolveDeployerSender(ctx);
    const onChain = await readTimelockGovernor(ctx);
    const envGovernor = resolveTimelockGovernorAddress();
    const path = selectTimelockGovernorPath({
        onChainGovernor: onChain,
        deployerAddress: deployer.address,
        envGovernor,
    });

    if (path === 'eoa') {
        return deployer;
    }
    if (path === 'multisig') {
        return makeMultisigGovernorSender(ctx, onChain);
    }

    throw new Error(
        'Timelock.governor mismatch — cannot build governor sender.\n' +
            `  on-chain governor: ${onChain.toString({ urlSafe: true, bounceable: true })}\n` +
            `  deploy wallet    : ${deployer.address.toString({ urlSafe: true, bounceable: true })}\n` +
            `  TIMELOCK_GOVERNOR: ${
                envGovernor
                    ? envGovernor.toString({ urlSafe: true, bounceable: true })
                    : '(unset)'
            }\n` +
            'For lab multisig tip set TIMELOCK_GOVERNOR + MULTISIG_SIGNER_*_MNEMONIC ' +
            '(throwaway testnet only).',
    );
}

/**
 * Send one or more messages as Timelock.governor (order per message).
 * Convenience for callers that do not use wrapper `via: Sender`.
 */
export async function sendAsTimelockGovernor(
    ctx: ScenarioContext,
    messages: SenderArguments[],
): Promise<DeployerSender> {
    const governor = await resolveTimelockGovernorSender(ctx);
    for (const msg of messages) {
        const before = await governor.getSeqno();
        await governor.sender.send(msg);
        await governor.waitSeqnoIncrement(before);
    }
    return governor;
}
