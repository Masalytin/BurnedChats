// SPDX-License-Identifier: MIT
// BURN Jetton wallet (TEP-74). Pure burn-on-transfer: hardcoded 1% of every
// transfer is burned (totalSupply decreases), 99% is delivered to the recipient.
// No fee config, no admin-changeable rates — the contract is immutable by design
// (IMP-TOKSIM-01).

/// Hardcoded burn fee in basis points (1%). Compile-time constant: never stored
/// in contract state and not changeable by any message.
const burnBps: Int = 100;

const gasForBurn: Int = 6700;
const gasForTransfer: Int = 10500;
const minTonsForStorage: Int = ton("0.01");
const perInternalDeployTon: Int = ton("0.55");
/// TON attached to the burn-leg JettonBurnNotification toward the master.
const gasBurnNotifyTon: Int = ton("0.06");
/// Compute/forward-fee headroom on the transfer gate (2 out-msgs path).
const gasTransferHeadroom: Int = ton("0.05");
const Basechain: Int = 0;
const walletStateInitCells: Int = 30;
const walletStateInitBits: Int = 20000;

struct BurnJettonData {
    totalSupply: Int;
    mintable: Bool;
    owner: Address;
    content: Cell;
    jettonWalletCode: Cell;
}

struct BurnJettonWalletData {
    balance: Int;
    owner: Address;
    minter: Address;
    code: Cell;
}

message(4) JettonUpdateContent {
    queryId: Int as uint64;
    content: Cell;
}

message(0xf8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address?;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x178d4519) JettonTransferInternal {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x7362d09c) JettonNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}

message(0x595f07bc) JettonBurn {
    queryId: Int as uint64;
    amount: Int as coins;
    responseDestination: Address?;
    customPayload: Cell?;
}

message(0x7bdd97de) JettonBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
}

message(0xd53276db) JettonExcesses {
    queryId: Int as uint64;
}

message(0x2c76b973) ProvideWalletAddress {
    queryId: Int as uint64;
    ownerAddress: Address;
    includeAddress: Bool;
}

message(0xd1735400) TakeWalletAddress {
    queryId: Int as uint64;
    walletAddress: Address;
    ownerAddress: Cell?;
}

message(0x642b7d07) Mint {
    queryId: Int as uint64;
    receiver: Address;
    mintMessage: JettonTransferInternal;
}

message(3) ChangeOwner {
    queryId: Int as uint64;
    newOwner: Address;
}

/// Admin: permanently and irreversibly close minting on the master.
/// There is no inverse message — once closed, `mintable` can never become
/// true again. After bootstrap the admin itself is revoked via `ChangeOwner`
/// to an inaccessible address, making the master fully immutable.
message(0x5a1ca001) CloseMint {
    queryId: Int as uint64;
}

/// Return attach surplus to responseDestination (or owner) after transfer out msgs.
inline fun returnTransferSurplusToOwner(
    queryId: Int,
    responseDestination: Address?,
    owner: Address,
) {
    nativeReserve(minTonsForStorage, ReserveAtMost);
    let dest = responseDestination != null ? responseDestination!! : owner;
    message(MessageParameters {
        to: dest,
        value: 0,
        mode: SendRemainingBalance + SendIgnoreErrors,
        bounce: false,
        body: JettonExcesses { queryId: queryId }.toCell(),
    });
}

inline fun checkEitherForwardPayload(forwardPayload: Slice) {
    if (forwardPayload.preloadUint(1) == 1) {
        let bitsAndRefs = calculateSliceBitsAndRefs(forwardPayload);
        throwUnless(9, (bitsAndRefs.refs == 1) && (bitsAndRefs.bits == 1));
    }
}

struct SliceBitsAndRefs {
    bits: Int;
    refs: Int;
}

asm fun calculateSliceBitsAndRefs(slice: Slice): SliceBitsAndRefs {
    SBITREFS
}

contract BurnJettonWallet(
    owner: Address,
    master: Address,
    balance: Int as coins,
) {
    receive(msg: JettonTransfer) {
        forceBasechain(msg.destination);
        require(sender() == self.owner, "Incorrect sender");
        require(msg.amount > 0, "Amount must be positive");

        checkEitherForwardPayload(msg.forwardPayload);

        // Integer truncation: amounts below 100 nano burn 0 and transfer in full.
        let burn = msg.amount * burnBps / 10000;
        let net = msg.amount - burn;

        let ctx = context();
        let fwd = ctx.readForwardFee();
        let deliverTon = max(
            perInternalDeployTon,
            msg.forwardTonAmount + fwd + minTonsForStorage + ton("0.02"),
        );
        let burnNotifyTon = burn > 0 ? gasBurnNotifyTon : 0;
        require(
            ctx.value > deliverTon + burnNotifyTon + gasTransferHeadroom,
            "Insufficient amount of TON attached",
        );

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");

        deploy(DeployParameters {
            value: deliverTon,
            bounce: true,
            mode: SendPayGasSeparately,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: net,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            init: initOf BurnJettonWallet(msg.destination, self.master, 0),
        });

        if (burn > 0) {
            message(MessageParameters {
                to: self.master,
                value: burnNotifyTon,
                mode: SendPayGasSeparately,
                bounce: true,
                body: JettonBurnNotification {
                    queryId: msg.queryId,
                    amount: burn,
                    sender: self.owner,
                    responseDestination: msg.responseDestination,
                }.toCell(),
            });
        }

        returnTransferSurplusToOwner(msg.queryId, msg.responseDestination, self.owner);
    }

    receive(msg: JettonTransferInternal) {
        self.balance += msg.amount;

        let wallet: StateInit = initOf BurnJettonWallet(msg.sender, self.master, 0);
        if (!wallet.hasSameBasechainAddress(sender())) {
            require(self.master == sender(), "Incorrect sender");
        }

        let ctx: Context = context();
        let msgValue: Int = ctx.value;
        let tonBalanceBeforeMsg = myBalance() - msgValue;

        if (msg.forwardTonAmount > 0) {
            let fwdFee: Int = ctx.readForwardFee();
            msgValue -= msg.forwardTonAmount + fwdFee;
            message(MessageParameters {
                to: self.owner,
                value: msg.forwardTonAmount,
                mode: SendPayGasSeparately,
                bounce: false,
                body: JettonNotification {
                    queryId: msg.queryId,
                    amount: msg.amount,
                    sender: msg.sender,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }
        nativeReserve(max(tonBalanceBeforeMsg, minTonsForStorage), ReserveAtMost);
        if (msg.responseDestination != null && msgValue > 0) {
            message(MessageParameters {
                to: msg.responseDestination!!,
                value: msgValue,
                mode: SendRemainingBalance + SendIgnoreErrors,
                bounce: false,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    receive(msg: JettonBurn) {
        require(sender() == self.owner, "Incorrect sender");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");

        let ctx = context();
        let fwdFee: Int = ctx.readForwardFee();
        require(ctx.value > (fwdFee + 2 * getComputeFee(gasForBurn, false)), "Insufficient amount of TON attached");

        message(MessageParameters {
            to: self.master,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonBurnNotification {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
            }.toCell(),
        });
    }

    bounced(msg: bounced<JettonTransferInternal>) {
        self.balance += msg.amount;
    }

    /// Burn notify to master failed — restore deducted burn leg so wallet balance matches totalSupply.
    bounced(msg: bounced<JettonBurnNotification>) {
        self.balance += msg.amount;
    }

    get fun get_wallet_data(): BurnJettonWalletData {
        return BurnJettonWalletData {
            balance: self.balance,
            owner: self.owner,
            minter: self.master,
            code: myCode(),
        };
    }
}
