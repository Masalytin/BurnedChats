import {
    BurnJettonMaster as BurnJettonMasterBase,
    JettonTransferInternal,
    type ChangeOwner as ChangeOwnerPayload,
    type CloseMint as CloseMintPayload,
    type Mint as MintPayload,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { BurnJettonWallet as BurnJettonWalletBase } from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';
import { Address, beginCell, Cell, ContractProvider, Sender, toNano } from '@ton/core';

export class BurnJettonMaster extends BurnJettonMasterBase {
    /**
     * Off-chain Jetton metadata (TEP-64): uri points to JSON with name, symbol, decimals, etc.
     */
    static jettonContentFromUri(metadataUri: string): Cell {
        return beginCell().storeUint(1, 8).storeRef(beginCell().storeStringTail(metadataUri).endCell()).endCell();
    }

    /** Predict TEP-74 wallet address before master/wallet contracts are deployed on-chain. */
    static async predictWalletAddress(jettonMaster: Address, owner: Address): Promise<Address> {
        const wallet = await BurnJettonWalletBase.fromInit(owner, jettonMaster, 0n);
        return wallet.address;
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

    /** Admin permanently closes minting (irreversible). */
    async sendCloseMint(provider: ContractProvider, via: Sender) {
        const msg: CloseMintPayload = {
            $$type: 'CloseMint',
            queryId: 0n,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }

    /**
     * Admin handover. Also the admin-revocation path: transferring ownership to a
     * deliberately inaccessible address makes the master immutable forever.
     */
    async sendChangeOwner(provider: ContractProvider, via: Sender, newOwner: Address) {
        const msg: ChangeOwnerPayload = {
            $$type: 'ChangeOwner',
            queryId: 0n,
            newOwner,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }
}
