import {
    Governor as GovernorBase,
    type CastVote,
    type CreateProposal,
    type ExecuteProposal,
    dictValueParserProposalConfig,
    type ProposalConfig,
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
import { StakingMaster } from './StakingMaster';

/** Matches `GasVoteAttach` in governor.tact (IMP-GOVOTE-04). */
export const GOVERNOR_VOTE_ATTACH_NANO = toNano('0.18');
/** Matches `GasVoteRelayForward` in governor.tact (IMP-GOVOTE-04). */
export const GOVERNOR_VOTE_RELAY_FORWARD_NANO = toNano('0.14');

export function emptyGovernorProposalMap() {
    return Dictionary.empty(Dictionary.Keys.BigUint(64), Dictionary.Values.Address());
}

export function emptyGovernorProposalStateMap() {
    return Dictionary.empty(Dictionary.Keys.BigUint(64), Dictionary.Values.Uint(8));
}

function proposalCfg(
    quorumPercent: bigint,
    thresholdPercent: bigint,
    periodSec: bigint,
    timelockDelaySec: bigint,
): ProposalConfig {
    return {
        $$type: 'ProposalConfig',
        quorumPercent,
        thresholdPercent,
        period: periodSec,
        timelockDelay: timelockDelaySec,
    };
}

/** Default quorum/threshold/voting-period/timelock per TOKENOMICS (P5-3-1-2). */
export function defaultGovernorProposalConfigs(): Dictionary<number, ProposalConfig> {
    const day = 86400n;
    const d = Dictionary.empty(Dictionary.Keys.Uint(32), dictValueParserProposalConfig());
    d.set(0, proposalCfg(10n, 51n, 3n * day, 1n * day));
    d.set(1, proposalCfg(5n, 51n, 7n * day, 1n * day));
    d.set(2, proposalCfg(20n, 66n, 7n * day, 2n * day));
    d.set(3, proposalCfg(30n, 75n, 1n * day, 0n));
    return d;
}

export class Governor extends GovernorBase {
    static async prepareInit(params: {
        minProposalVp: bigint;
        stakingMaster: Address;
        stakingLock: Address;
        timelock: Address;
        timelockDelaySec: bigint;
        proposalConfigs?: Dictionary<number, ProposalConfig>;
    }): Promise<Governor> {
        const raw = await GovernorBase.fromInit(
            0n,
            emptyGovernorProposalMap(),
            emptyGovernorProposalStateMap(),
            params.proposalConfigs ?? defaultGovernorProposalConfigs(),
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

    /**
     * Voting power Σ_tier (stake × default tier multiplier / 100) from `StakingMaster`.
     * Canonical on-chain formula; tooling should use this alongside Governor messages.
     */
    async fetchVotingPower(provider: ContractProvider, owner: Address): Promise<bigint> {
        const master = await this.getGetStakingMaster(provider);
        const staking = provider.open(StakingMaster.fromAddress(master));
        return staking.getGetVotingPower(owner);
    }

    async fetchTotalVotingPower(provider: ContractProvider): Promise<bigint> {
        const master = await this.getGetStakingMaster(provider);
        const staking = provider.open(StakingMaster.fromAddress(master));
        return staking.getGetTotalVotingPower();
    }

    async sendCreateProposal(
        provider: ContractProvider,
        via: Sender,
        p: {
            proposalType: number;
            payload?: Cell;
            claimedVp: bigint;
            queryId?: bigint;
        },
    ) {
        const msg: CreateProposal = {
            $$type: 'CreateProposal',
            queryId: p.queryId ?? 0n,
            proposalType: BigInt(p.proposalType),
            payload: p.payload ?? Governor.emptyPayload(),
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
        return this.send(provider, via, { value: GOVERNOR_VOTE_ATTACH_NANO }, msg);
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
