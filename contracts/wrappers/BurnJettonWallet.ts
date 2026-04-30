import {
    BurnJettonWallet as BurnJettonWalletBase,
    type JettonTransfer as JettonTransferPayload,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonWallet';
import { Address, beginCell, ContractProvider, Sender } from '@ton/core';

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
            forwardPayload: beginCell().storeUint(0, 1).asSlice(),
        };
        return this.send(provider, via, { value: params.value }, msg);
    }
}
