import {
    BurnJettonWallet as BurnJettonWalletBase,
    type JettonBurn as JettonBurnPayload,
    type JettonTransfer as JettonTransferPayload,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';
import { Address, beginCell, ContractProvider, Sender, Slice, toNano } from '@ton/core';

export class BurnJettonWallet extends BurnJettonWalletBase {
    static override fromAddress(address: Address): BurnJettonWallet {
        return new BurnJettonWallet(address);
    }
    /**
     * Transfer jettons to `destinationOwner` (user TON address, not jetton wallet).
     */
    async sendTransfer(
        provider: ContractProvider,
        via: Sender,
        params: {
            jettonAmount: bigint;
            destinationOwner: Address;
            responseDestination: Address;
            forwardTonAmount?: bigint;
            /** TEP-74 either-cell forward payload (staking uses ref with `StakeForward`). */
            forwardPayload?: Slice;
            value: bigint;
        },
    ) {
        const forwardTon = params.forwardTonAmount ?? 1n;
        const msg: JettonTransferPayload = {
            $$type: 'JettonTransfer',
            queryId: 0n,
            amount: params.jettonAmount,
            destination: params.destinationOwner,
            responseDestination: params.responseDestination,
            customPayload: null,
            forwardTonAmount: forwardTon,
            forwardPayload: params.forwardPayload ?? beginCell().storeUint(0, 1).asSlice(),
        };
        return this.send(provider, via, { value: params.value }, msg);
    }

    async sendBurn(
        provider: ContractProvider,
        via: Sender,
        params: { jettonAmount: bigint; responseDestination?: Address | null; value?: bigint },
    ) {
        const msg: JettonBurnPayload = {
            $$type: 'JettonBurn',
            queryId: 0n,
            amount: params.jettonAmount,
            responseDestination: params.responseDestination ?? null,
            customPayload: null,
        };
        const value = params.value ?? toNano('0.05');
        return this.send(provider, via, { value }, msg);
    }
}
