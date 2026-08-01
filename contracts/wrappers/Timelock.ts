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

/**
 * Mainnet default for `Timelock.highValueDelayFloorSec` (24 h) — IMP-MNAUD-F03.
 * High-value TimelockQueue methods (TreasurySpend / VestEmergencyRevoke) require
 * `delay > 0 && delay >= floor`. Lab short-timer deploys pass a short floor
 * explicitly (bootstrap.ts LAB_TIMELOCK_HIGH_VALUE_FLOOR_SEC).
 */
export const TIMELOCK_HIGH_VALUE_DELAY_FLOOR_SEC = 86_400n;

export class Timelock extends TimelockBase {
    static async prepareInit(
        governor: Address,
        highValueDelayFloorSec: bigint = TIMELOCK_HIGH_VALUE_DELAY_FLOOR_SEC,
    ): Promise<Timelock> {
        const raw = await TimelockBase.fromInit(
            governor,
            highValueDelayFloorSec,
            emptyTimelockPendingMap(),
        );
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

    /**
     * @param value Optional attach. Default 0.25 TON covers ordinary TIMELOCK_TARGET_GAS
     * executes. For treasury-spend / VestEmergencyRevoke relay paths, pass a budget that
     * funds the downstream gate (e.g. ≥ Vesting.ReleaseTon + mark-executed + storage reserve).
     */
    async sendExecutePending(
        provider: ContractProvider,
        via: Sender,
        proposalId: bigint,
        queryId: bigint = 0n,
        value: bigint = toNano('0.25'),
    ) {
        const msg: TimelockExecutePending = {
            $$type: 'TimelockExecutePending',
            queryId,
            proposalId,
        };
        return this.send(provider, via, { value }, msg);
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
