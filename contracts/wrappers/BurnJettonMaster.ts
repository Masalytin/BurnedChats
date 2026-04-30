import {
    BurnJettonMaster as BurnJettonMasterBase,
    JettonTransferInternal,
    type Mint as MintPayload,
    type SetFeeDestinations as SetFeeDestinationsPayload,
    type SetFeeParams as SetFeeParamsPayload,
    type SyncFeeConfigToWallet as SyncFeeConfigToWalletPayload,
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
        const base = await BurnJettonMasterBase.fromInit(
            0n,
            admin,
            content,
            true,
            50n,
            30n,
            20n,
            admin,
            admin,
            false,
        );
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

    async sendSetFeeParams(provider: ContractProvider, via: Sender, p: { burnBps: bigint; stakingBps: bigint; treasuryBps: bigint }) {
        const msg: SetFeeParamsPayload = {
            $$type: 'SetFeeParams',
            queryId: 0n,
            burn_rate_bps: p.burnBps,
            staking_rate_bps: p.stakingBps,
            treasury_rate_bps: p.treasuryBps,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }

    async sendSetFeeDestinations(provider: ContractProvider, via: Sender, stakingPoolOwner: Address, treasuryOwner: Address) {
        const msg: SetFeeDestinationsPayload = {
            $$type: 'SetFeeDestinations',
            queryId: 0n,
            staking_pool: stakingPoolOwner,
            treasury: treasuryOwner,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }

    async sendSyncFeeConfigToWallet(provider: ContractProvider, via: Sender, owner: Address) {
        const msg: SyncFeeConfigToWalletPayload = {
            $$type: 'SyncFeeConfigToWallet',
            queryId: 0n,
            owner,
        };
        return this.send(provider, via, { value: toNano('0.06') }, msg);
    }
}
