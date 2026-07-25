/**
 * IMP-TNFS-F12 — tolerant Timelock.get_pending read vs toncenter-v2 nested tuple.
 *
 * Same client-side mine as IMP-TNFS-F09 get_stake (see decision log
 * IMP-TNFS-F09-root-cause-live-stake-record.md): `@ton/ton` TonClient
 * (toncenter API v2 — Blueprint's default) parses NESTED tuple elements via
 * `parseStackEntry`, which yields RAW values instead of `TupleItem` objects:
 *  - tvm.numberDecimal → bare bigint (ints and bools, bool as -1n/0n);
 *  - tvm.cell / tvm.slice → bare `Cell` (addresses arrive as slices → Cell).
 * The generated wrapper `getGetPending` → `loadTuplePendingAction` calls
 * `TupleReader.readBigNumber()/readAddress()/readCell()/readBoolean()` and
 * throws "Not a number" on every NON-NULL pending action read over v2.
 *
 * These tests feed both stack shapes to `readPendingAction` (lib/gov.ts):
 * red against the wrapper path, green with the tolerant direct parser.
 */
import {
    Address,
    beginCell,
    Cell,
    Contract,
    ContractProvider,
    openContract,
    TupleItem,
    TupleReader,
} from '@ton/core';
import { expect } from '@jest/globals';
import type { NetworkProvider } from '@ton/blueprint';
import { readPendingAction } from '../testnet-scenarios/lib/gov';
import '@ton/test-utils';

const TIMELOCK_ADDR = Address.parse('EQBmkM_xe-12_YjfTqUBeh3JnqR8PttyPALYHBwcr_0ryvMH');
const PROPOSAL_CONTRACT = Address.parseRaw(
    '0:79a475a6d84427cdb897c954e4bcffd147fcdd3be9b01df9e48da28d08fca1c9',
);
const TARGET = Address.parseRaw(
    '0:6b64561111111111111111111111111111111111111111111111111111111111',
);

/** Canonical TreasurySpend opcode — realistic `method` value. */
const OP_TREASURY_SPEND = 0x5a1c9010n;
const ARGS_CELL = beginCell().storeUint(7, 64).storeCoins(1_000_000n).endCell();

const PENDING = {
    proposalId: 7n,
    proposalContract: PROPOSAL_CONTRACT,
    target: TARGET,
    method: OP_TREASURY_SPEND,
    args: ARGS_CELL,
    scheduledTime: 1_784_900_000n,
    executed: false,
};

function addressCell(addr: Address): Cell {
    return beginCell().storeAddress(addr).endCell();
}

/**
 * get_pending result stack exactly as `@ton/ton` TonClient v2 builds it:
 * top-level `parseStackItem` wraps the tuple as `{ type: 'tuple', items }`,
 * but `items` come from `parseStackEntry` → RAW values (bigint for
 * ints/bools, bare Cell for slices/cells), not TupleItem objects.
 */
function toncenterV2GetPendingStack(p: typeof PENDING | null): TupleReader {
    if (p === null) {
        return new TupleReader([{ type: 'null' } as TupleItem]);
    }
    const rawItems = [
        p.proposalId,
        addressCell(p.proposalContract),
        addressCell(p.target),
        p.method,
        p.args,
        p.scheduledTime,
        p.executed ? -1n : 0n,
    ];
    return new TupleReader([
        { type: 'tuple', items: rawItems as unknown as TupleItem[] } as TupleItem,
    ]);
}

/** Well-formed shape (sandbox / TonClient4 / liteclient): proper TupleItem objects. */
function wellFormedGetPendingStack(p: typeof PENDING): TupleReader {
    const items: TupleItem[] = [
        { type: 'int', value: p.proposalId },
        { type: 'slice', cell: addressCell(p.proposalContract) },
        { type: 'slice', cell: addressCell(p.target) },
        { type: 'int', value: p.method },
        { type: 'cell', cell: p.args },
        { type: 'int', value: p.scheduledTime },
        { type: 'int', value: p.executed ? -1n : 0n },
    ];
    return new TupleReader([{ type: 'tuple', items } as TupleItem]);
}

/** Minimal NetworkProvider stub: every get returns the supplied stack. */
function stubNetworkProvider(makeStack: () => TupleReader): NetworkProvider {
    const contractProvider = {
        get: async (_name: string, _args: TupleItem[]) => ({ stack: makeStack() }),
    } as unknown as ContractProvider;
    return {
        provider: (_addr: Address) => contractProvider,
        open: <T extends Contract>(contract: T) => openContract(contract, () => contractProvider),
    } as unknown as NetworkProvider;
}

function expectPendingMatches(view: Awaited<ReturnType<typeof readPendingAction>>) {
    expect(view).not.toBeNull();
    expect(view!.proposalId).toBe(PENDING.proposalId);
    expect(view!.proposalContract.equals(PENDING.proposalContract)).toBe(true);
    expect(view!.target.equals(PENDING.target)).toBe(true);
    expect(view!.method).toBe(PENDING.method);
    expect(view!.args.equals(PENDING.args)).toBe(true);
    expect(view!.scheduledTime).toBe(PENDING.scheduledTime);
    expect(view!.executed).toBe(PENDING.executed);
}

describe('IMP-TNFS-F12 — readPendingAction vs toncenter-v2 nested tuple shape', () => {
    it('reads a NON-NULL pending action in toncenter-v2 shape (raw bigints / bare Cells)', async () => {
        const provider = stubNetworkProvider(() => toncenterV2GetPendingStack(PENDING));
        const view = await readPendingAction(provider, TIMELOCK_ADDR, PENDING.proposalId);
        expectPendingMatches(view);
    });

    it('reads an executed=true pending action in toncenter-v2 shape (raw -1n bool)', async () => {
        const executedPending = { ...PENDING, executed: true };
        const provider = stubNetworkProvider(() => toncenterV2GetPendingStack(executedPending));
        const view = await readPendingAction(provider, TIMELOCK_ADDR, PENDING.proposalId);
        expect(view).not.toBeNull();
        expect(view!.executed).toBe(true);
        expect(view!.scheduledTime).toBe(PENDING.scheduledTime);
    });

    it('reads a NON-NULL pending action in well-formed shape (sandbox/TonClient4)', async () => {
        const provider = stubNetworkProvider(() => wellFormedGetPendingStack(PENDING));
        const view = await readPendingAction(provider, TIMELOCK_ADDR, PENDING.proposalId);
        expectPendingMatches(view);
    });

    it('returns null when there is no pending action', async () => {
        const provider = stubNetworkProvider(() => toncenterV2GetPendingStack(null));
        const view = await readPendingAction(provider, TIMELOCK_ADDR, PENDING.proposalId);
        expect(view).toBeNull();
    });
});
