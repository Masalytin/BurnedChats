import {
    Timelock as TimelockBase,
    dictValueParserPendingAction,
    type TimelockCancel,
    type TimelockExecutePending,
    type TimelockQueue,
} from '../build/Timelock/Timelock_Timelock';
import { Address, Cell, ContractProvider, Dictionary, Sender, toNano } from '@ton/core';

export function emptyTimelockPendingMap() {
    return Dictionary.empty(Dictionary.Keys.BigUint(64), dictValueParserPendingAction());
}

export class Timelock extends TimelockBase {
    static async prepareInit(governor: Address): Promise<Timelock> {
        const raw = await TimelockBase.fromInit(governor, emptyTimelockPendingMap());
        return new Timelock(raw.address, raw.init);
    }

    async sendQueue(
        provider: ContractProvider,
        via: Sender,
        p: {
            proposalId: bigint;
            proposalContract: Address;
            target: Address;
            method: bigint;
            args: Cell;
            delay: bigint;
            queryId?: bigint;
        },
    ) {
        const msg: TimelockQueue = {
            $$type: 'TimelockQueue',
            queryId: p.queryId ?? 0n,
            proposalId: p.proposalId,
            proposalContract: p.proposalContract,
            target: p.target,
            method: p.method,
            args: p.args,
            delay: p.delay,
        };
        return this.send(provider, via, { value: toNano('0.06') }, msg);
    }

    async sendExecutePending(provider: ContractProvider, via: Sender, proposalId: bigint, queryId: bigint = 0n) {
        const msg: TimelockExecutePending = {
            $$type: 'TimelockExecutePending',
            queryId,
            proposalId,
        };
        return this.send(provider, via, { value: toNano('0.25') }, msg);
    }

    async sendCancel(provider: ContractProvider, via: Sender, proposalId: bigint, queryId: bigint = 0n) {
        const msg: TimelockCancel = {
            $$type: 'TimelockCancel',
            queryId,
            proposalId,
        };
        return this.send(provider, via, { value: toNano('0.05') }, msg);
    }
}
