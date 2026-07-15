// SPDX-License-Identifier: MIT
// BURN Jetton master (TEP-74 + TEP-64 + TEP-89). Max supply 1000 BURN (9 decimals).
// Pure meme-token master: Mint (until CloseMint), CloseMint (irreversible),
// ChangeOwner (admin revocation), JettonUpdateContent, JettonBurnNotification.
// No fee config, no exclusion list, no governance hooks (IMP-TOKSIM-01).

import "./burn-jetton-wallet";

/// 1000 tokens * 10^9 nano
const BURN_MAX_SUPPLY_NANO: Int = 1000 * pow(10, 9);
/// TEP-89: headroom for provide_wallet_address computation (reference jetton-minter-discoverable.fc).
const provideAddressGasConsumption: Int = ton("0.01");

struct BurnJettonMasterState {
    totalSupply: Int as coins;
    mintable: Bool;
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
}

contract BurnJettonMaster(
    totalSupply: Int as coins,
    admin: Address,
    content: Cell,
    mintable: Bool,
) {
    /// Plain TON (e.g. accidental sends) is returned to the sender.
    receive() {
        cashback(sender());
    }

    receive(msg: ProvideWalletAddress) {
        let ctx = context();
        let fwdFee = ctx.readForwardFee();
        require(
            ctx.value > fwdFee + provideAddressGasConsumption,
            "Insufficient gas for wallet discovery",
        );

        let ownerWorkchain: Int = parseStdAddress(msg.ownerAddress.asSlice()).workchain;
        let walletResolvable: Bool = ownerWorkchain == Basechain;

        message(MessageParameters {
            body: makeTep89TakeWalletAddressMsg(walletResolvable, msg),
            to: sender(),
            value: 0,
            mode: SendRemainingValue,
        });
    }

    receive(msg: Mint) {
        require(sender() == self.admin, "Incorrect sender");
        require(self.mintable, "Mint is closed");
        require(
            self.totalSupply + msg.mintMessage.amount <= BURN_MAX_SUPPLY_NANO,
            "Mint cap exceeded",
        );

        checkEitherForwardPayload(msg.mintMessage.forwardPayload);

        let ctx = context();
        require(
            ctx.value >
                minTonsForStorage +
                msg.mintMessage.forwardTonAmount +
                ctx.readForwardFee() +
                getForwardFee(walletStateInitCells, walletStateInitBits, false) +
                2 * getComputeFee(gasForTransfer, false),
            "Insufficient gas for mint",
        );

        self.totalSupply += msg.mintMessage.amount;

        deploy(DeployParameters {
            value: 0,
            bounce: true,
            mode: SendRemainingValue | SendBounceIfActionFail,
            body: msg.mintMessage.toCell(),
            init: getBurnJettonWalletInit(msg.receiver),
        });
    }

    receive(msg: CloseMint) {
        require(sender() == self.admin, "Incorrect sender");
        // Irreversible: no receiver ever sets mintable back to true.
        self.mintable = false;
    }

    receive(msg: JettonBurnNotification) {
        let s = parseStdAddress(sender().asSlice());
        let wallet = getBurnJettonBasechainWalletByOwner(msg.sender);
        require(s.workchain == Basechain && s.address == wallet.hash!!, "Unauthorized burn");

        self.totalSupply -= msg.amount;

        if (msg.responseDestination != null) {
            message(MessageParameters {
                to: msg.responseDestination!!,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
                value: 0,
                bounce: false,
                mode: SendRemainingValue | SendIgnoreErrors,
            });
        }
    }

    receive(msg: JettonUpdateContent) {
        require(sender() == self.admin, "Incorrect sender");
        self.content = msg.content;
    }

    /// Admin handover; also the admin-revocation path — transferring ownership
    /// to a deliberately inaccessible address makes the master immutable forever.
    receive(msg: ChangeOwner) {
        require(sender() == self.admin, "Incorrect sender");
        self.admin = msg.newOwner;
    }

    bounced(msg: bounced<JettonTransferInternal>) {
        self.totalSupply -= msg.amount;
    }

    get fun get_jetton_data(): BurnJettonMasterState {
        return BurnJettonMasterState {
            totalSupply: self.totalSupply,
            mintable: self.mintable,
            adminAddress: self.admin,
            jettonContent: self.content,
            jettonWalletCode: codeOf BurnJettonWallet,
        };
    }

    get fun get_wallet_address(ownerAddress: Address): Address {
        return getBurnJettonWalletByOwner(ownerAddress);
    }
}

inline fun getBurnJettonWalletInit(address: Address): StateInit {
    return initOf BurnJettonWallet(address, myAddress(), 0);
}

inline fun getBurnJettonWalletByOwner(jettonWalletOwner: Address): Address {
    return contractAddress(getBurnJettonWalletInit(jettonWalletOwner));
}

inline fun getBurnJettonBasechainWalletByOwner(jettonWalletOwner: Address): BasechainAddress {
    return contractBasechainAddress(getBurnJettonWalletInit(jettonWalletOwner));
}

/// TEP-89 TakeWalletAddress body: addr_none when owner workchain is not basechain.
inline fun makeTep89TakeWalletAddressMsg(walletResolvable: Bool, msg: ProvideWalletAddress): Cell {
    let b = beginCell()
        .storeUint(TakeWalletAddress.opcode(), 32)
        .storeUint(msg.queryId, 64);
    if (walletResolvable) {
        b = b.storeBasechainAddress(getBurnJettonBasechainWalletByOwner(msg.ownerAddress));
    } else {
        b = b.storeUint(0, 2);
    }
    return b
        .storeMaybeRef(msg.includeAddress ? beginCell().storeAddress(msg.ownerAddress).endCell() : null)
        .endCell();
}
