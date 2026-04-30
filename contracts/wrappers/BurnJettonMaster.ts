import {
    BurnJettonMaster as BurnJettonMasterBase,
    JettonTransferInternal,
    type Mint as MintPayload,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { Address, beginCell, Cell, ContractProvider, Sender, toNano } from '@ton/core';

export class BurnJettonMaster extends BurnJettonMasterBase {
    /**
     * Off-chain Jetton metadata (TEP-64): uri points to JSON with name, symbol, decimals, etc.
     */
    static jettonContentFromUri(metadataUri: string): Cell {
        return beginCell().storeUint(1, 8).storeRef(beginCell().storeStringTail(metadataUri).endCell()).endCell();
    }

    static async fromInitDeployed(admin: Address, content: Cell) {
        const base = await BurnJettonMasterBase.fromInit(0n, admin, content, true);
        if (base.init === undefined) {
            throw new Error('BurnJettonMaster init is not defined');
        }
        return new BurnJettonMaster(base.address, base.init);
    }

    /**
     * Admin mints jettons to `receiver`'s jetton wallet (deploys wallet on first mint).
     */
    async sendMint(
        provider: ContractProvider,
        via: Sender,
        receiver: Address,
        jettonAmount: bigint,
        forwardTonAmount: bigint,
        totalTonAmount: bigint,
    ) {
        if (totalTonAmount <= forwardTonAmount) {
            throw new Error('totalTonAmount must exceed forwardTonAmount');
        }

        const mintMessage: JettonTransferInternal = {
            $$type: 'JettonTransferInternal',
            queryId: 0n,
            amount: jettonAmount,
            sender: this.address,
            responseDestination: this.address,
            forwardTonAmount,
            forwardPayload: beginCell().storeUint(0, 1).asSlice(),
        };

        const msg: MintPayload = {
            $$type: 'Mint',
            queryId: 0n,
            receiver,
            mintMessage,
        };

        const value = totalTonAmount + toNano('0.02');
        return this.send(provider, via, { value }, msg);
    }
}
