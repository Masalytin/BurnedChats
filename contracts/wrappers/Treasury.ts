import {
    Treasury as TreasuryBase,
    dictValueParserSpendRecord,
    type SpendRecord,
    storeTreasurySpend,
    type TreasurySpend,
} from '../build/Treasury/Treasury_Treasury';
import { Address, beginCell, Cell, ContractProvider, Dictionary, Sender, toNano } from '@ton/core';
import { BurnJettonMaster } from './BurnJettonMaster';
import { BurnJettonWallet } from './BurnJettonWallet';

export function emptyTreasurySpendingLog() {
    return Dictionary.empty(Dictionary.Keys.BigInt(257), dictValueParserSpendRecord());
}

export class Treasury extends TreasuryBase {
    /**
     * Initial treasury: no receipts, empty spending log. Deploy with enough TON for rent.
     */
    static async prepareInit(timelock: Address, jettonMaster: Address): Promise<Treasury> {
        const raw = await TreasuryBase.fromInit(timelock, jettonMaster, 0n, 0n, emptyTreasurySpendingLog(), 0n);
        return new Treasury(raw.address, raw.init);
    }

    /**
     * Body for Timelock `queueArgs` targeting this treasury (after Treasury Spend proposal).
     */
    static packTimelockSpendBody(p: {
        queryId?: bigint;
        recipient: Address;
        amount: bigint;
        reason: string;
        proposalId: bigint;
    }): Cell {
        const msg: TreasurySpend = {
            $$type: 'TreasurySpend',
            queryId: p.queryId ?? 0n,
            recipient: p.recipient,
            amount: p.amount,
            reason: p.reason,
            proposalId: p.proposalId,
        };
        return beginCell().store(storeTreasurySpend(msg)).endCell();
    }

    /** TEP-74 jetton wallet holding this treasury's BURN (owner = treasury contract). */
    async getTreasuryJettonWalletAddress(provider: ContractProvider, jettonMaster: BurnJettonMaster): Promise<Address> {
        return jettonMaster.getGetWalletAddress(provider, this.address);
    }

    /** Exact on-chain jetton balance (nano tokens). */
    async getJettonBalance(provider: ContractProvider, jettonMaster: BurnJettonMaster): Promise<bigint> {
        const w = await this.getTreasuryJettonWalletAddress(provider, jettonMaster);
        const wallet = provider.open(BurnJettonWallet.fromAddress(w));
        const data = await wallet.getGetWalletData(provider);
        return data.balance;
    }

    /**
     * Direct spend (normally only Timelock calls this). For tests or tooling.
     */
    async sendTreasurySpend(
        provider: ContractProvider,
        via: Sender,
        p: {
            recipient: Address;
            amount: bigint;
            reason: string;
            proposalId: bigint;
            queryId?: bigint;
            value?: bigint;
        },
    ) {
        const msg: TreasurySpend = {
            $$type: 'TreasurySpend',
            queryId: p.queryId ?? 0n,
            recipient: p.recipient,
            amount: p.amount,
            reason: p.reason,
            proposalId: p.proposalId,
        };
        return this.send(provider, via, { value: p.value ?? toNano('0.2') }, msg);
    }
}

export type { SpendRecord, TreasurySpend };
