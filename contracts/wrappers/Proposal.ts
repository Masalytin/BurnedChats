import {
    Proposal as ProposalBase,
    type ProposalCancel,
    type ProposalFinalize,
} from '../build/Governor/Governor_Proposal';
import { ContractProvider, Dictionary, Sender, toNano } from '@ton/core';

export function emptyProposalVotedMap() {
    return Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.Uint(8));
}

/**
 * On-chain Proposal instance; deployed by Governor. Typical usage: wrap `get_proposal(id)` address.
 */
export class Proposal extends ProposalBase {
    async sendFinalize(provider: ContractProvider, via: Sender) {
        const msg: ProposalFinalize = { $$type: 'ProposalFinalize' };
        return this.send(provider, via, { value: toNano('0.06') }, msg);
    }

    async sendCancel(provider: ContractProvider, via: Sender) {
        const msg: ProposalCancel = { $$type: 'ProposalCancel' };
        return this.send(provider, via, { value: toNano('0.06') }, msg);
    }
}
