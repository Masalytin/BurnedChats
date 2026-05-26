import {
    BurnJettonMaster as BurnJettonMasterBase,
    JettonTransferInternal,
    type AddExcluded as AddExcludedPayload,
    type ChangeOwner as ChangeOwnerPayload,
    type Mint as MintPayload,
    type RemoveExcluded as RemoveExcludedPayload,
    type SetAutoReduceParams as SetAutoReduceParamsPayload,
    type SetDynamicBurnEnabled as SetDynamicBurnEnabledPayload,
    type SetDynamicBurnThresholds as SetDynamicBurnThresholdsPayload,
    type SetFeeDestinations as SetFeeDestinationsPayload,
    type SetFeeParams as SetFeeParamsPayload,
    type SyncFeeConfigToWallet as SyncFeeConfigToWalletPayload,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { BurnJettonWallet as BurnJettonWalletBase } from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';
import { Address, beginCell, Cell, ContractProvider, Sender, toNano } from '@ton/core';

const NANO = 10n ** 9n;
const EMPTY_WALLET_FEE_CONFIG = beginCell().endCell();

export class BurnJettonMaster extends BurnJettonMasterBase {
    /**
     * Off-chain Jetton metadata (TEP-64): uri points to JSON with name, symbol, decimals, etc.
     */
    static jettonContentFromUri(metadataUri: string): Cell {
        return beginCell().storeUint(1, 8).storeRef(beginCell().storeStringTail(metadataUri).endCell()).endCell();
    }

    /** Predict TEP-74 wallet address before master/wallet contracts are deployed on-chain. */
    static async predictWalletAddress(jettonMaster: Address, owner: Address): Promise<Address> {
        const wallet = await BurnJettonWalletBase.fromInit(owner, jettonMaster, 0n, EMPTY_WALLET_FEE_CONFIG);
        return wallet.address;
    }

    static async fromInitDeployed(admin: Address, content: Cell, timelock: Address = admin) {
        const emptyExcluded = beginCell().endCell();
        const base = await BurnJettonMasterBase.fromInit(
            0n,
            admin,
            timelock,
            content,
            true,
            50n,
            30n,
            20n,
            admin,
            admin,
            false,
            emptyExcluded,
            0n,
            false,
            10n * NANO,
            100n,
            100n,
            0n,
            0n,
            100n * NANO,
            10n,
            6n,
            4n,
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

    async sendChangeOwner(provider: ContractProvider, via: Sender, newOwner: Address) {
        const msg: ChangeOwnerPayload = {
            $$type: 'ChangeOwner',
            queryId: 0n,
            newOwner,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
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

    async sendAddExcluded(provider: ContractProvider, via: Sender, holder: Address) {
        const msg: AddExcludedPayload = {
            $$type: 'AddExcluded',
            queryId: 0n,
            address: holder,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }

    async sendRemoveExcluded(provider: ContractProvider, via: Sender, holder: Address) {
        const msg: RemoveExcludedPayload = {
            $$type: 'RemoveExcluded',
            queryId: 0n,
            address: holder,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }

    async sendSetDynamicBurnEnabled(provider: ContractProvider, via: Sender, enabled: boolean) {
        const msg: SetDynamicBurnEnabledPayload = {
            $$type: 'SetDynamicBurnEnabled',
            queryId: 0n,
            enabled,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }

    async sendSetDynamicBurnThresholds(provider: ContractProvider, via: Sender, p: { largeTxThreshold: bigint; activityThreshold: bigint }) {
        const msg: SetDynamicBurnThresholdsPayload = {
            $$type: 'SetDynamicBurnThresholds',
            queryId: 0n,
            large_tx_threshold: p.largeTxThreshold,
            activity_threshold: p.activityThreshold,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }

    async sendSetAutoReduceParams(
        provider: ContractProvider,
        via: Sender,
        p: { threshold: bigint; lowBurnBps: bigint; lowStakingBps: bigint; lowTreasuryBps: bigint },
    ) {
        const msg: SetAutoReduceParamsPayload = {
            $$type: 'SetAutoReduceParams',
            queryId: 0n,
            threshold: p.threshold,
            low_burn_bps: p.lowBurnBps,
            low_staking_bps: p.lowStakingBps,
            low_treasury_bps: p.lowTreasuryBps,
        };
        return this.send(provider, via, { value: toNano('0.02') }, msg);
    }
}
