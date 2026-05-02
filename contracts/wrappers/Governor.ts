import {
    Governor as GovernorBase,
    type CastVote,
    type CreateProposal,
    type ExecuteProposal,
} from '../build/Governor/Governor_Governor';
import {
    Address,
    beginCell,
    Cell,
    ContractProvider,
    Dictionary,
    Sender,
    toNano,
} from '@ton/core';

export function emptyGovernorProposalMap() {
    return Dictionary.empty(Dictionary.Keys.BigUint(64), Dictionary.Values.Address());
}

export function emptyGovernorProposalStateMap() {
    return Dictionary.empty(Dictionary.Keys.BigUint(64), Dictionary.Values.Uint(8));
}

export class Governor extends GovernorBase {
    static async prepareInit(params: {
        minProposalVp: bigint;
        stakingMaster: Address;
        stakingLock: Address;
        timelock: Address;
        timelockDelaySec: bigint;
    }): Promise<Governor> {
        const raw = await GovernorBase.fromInit(
            0n,
            emptyGovernorProposalMap(),
            emptyGovernorProposalStateMap(),
            params.minProposalVp,
            params.stakingMaster,
            params.stakingLock,
            params.timelock,
            params.timelockDelaySec,
        );
        return new Governor(raw.address, raw.init);
    }

    static emptyPayload(): Cell {
        return beginCell().endCell();
    }

    async sendCreateProposal(
        provider: ContractProvider,
        via: Sender,
        p: {
            proposalType: number;
            payload?: Cell;
            periodSeconds: number;
            quorumRequired: bigint;
            thresholdBps: number;
            claimedVp: bigint;
            queryId?: bigint;
        },
    ) {
        const msg: CreateProposal = {
            $$type: 'CreateProposal',
            queryId: p.queryId ?? 0n,
            proposalType: BigInt(p.proposalType),
            payload: p.payload ?? Governor.emptyPayload(),
            periodSeconds: BigInt(p.periodSeconds),
            quorumRequired: p.quorumRequired,
            thresholdBps: BigInt(p.thresholdBps),
            claimedVp: p.claimedVp,
        };
        return this.send(provider, via, { value: toNano('0.5') }, msg);
    }

    async sendCastVote(
        provider: ContractProvider,
        via: Sender,
        p: { proposalId: bigint; support: boolean; claimedVp: bigint },
    ) {
        const msg: CastVote = {
            $$type: 'CastVote',
            queryId: 0n,
            proposalId: p.proposalId,
            support: p.support,
            claimedVp: p.claimedVp,
        };
        return this.send(provider, via, { value: toNano('0.08') }, msg);
    }

    async sendExecuteProposal(provider: ContractProvider, via: Sender, p: { proposalId: bigint }) {
        const msg: ExecuteProposal = {
            $$type: 'ExecuteProposal',
            queryId: 0n,
            proposalId: p.proposalId,
        };
        return this.send(provider, via, { value: toNano('0.11') }, msg);
    }
}
