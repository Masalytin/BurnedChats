// SPDX-License-Identifier: MIT
// BURN Jetton wallet (TEP-74). Base transfer/mint/burn only; fees in P5-1-2-1.

const gasForBurn: Int = 6700;
const gasForTransfer: Int = 10500;
const minTonsForStorage: Int = ton("0.01");
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

inline fun makeTakeWalletAddressMsg(targetJettonWallet: BasechainAddress, msg: ProvideWalletAddress): Cell {
    return beginCell()
        .storeUint(TakeWalletAddress.opcode(), 32)
        .storeUint(msg.queryId, 64)
        .storeBasechainAddress(targetJettonWallet)
        .storeMaybeRef(msg.includeAddress ? beginCell().storeAddress(msg.ownerAddress).endCell() : null)
        .endCell();
}

contract BurnJettonWallet(
    owner: Address,
    master: Address,
    balance: Int as coins,
) {
    receive(msg: JettonTransfer) {
        forceBasechain(msg.destination);
        require(sender() == self.owner, "Incorrect sender");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");
        checkEitherForwardPayload(msg.forwardPayload);

        let ctx = context();
        let fwdCount = 1 + sign(msg.forwardTonAmount);
        require(
            ctx.value >
                msg.forwardTonAmount +
                fwdCount * ctx.readForwardFee() +
                getForwardFee(walletStateInitCells, walletStateInitBits, false) +
                (2 * getComputeFee(gasForTransfer, false) + minTonsForStorage),
            "Insufficient amount of TON attached",
        );

        deploy(DeployParameters {
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            init: initOf BurnJettonWallet(msg.destination, self.master, 0),
        });
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

    get fun get_wallet_data(): BurnJettonWalletData {
        return BurnJettonWalletData {
            balance: self.balance,
            owner: self.owner,
            minter: self.master,
            code: myCode(),
        };
    }
}
