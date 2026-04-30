// SPDX-License-Identifier: MIT
// BURN Jetton wallet (TEP-74). Base transfer/mint/burn only; fees in P5-1-2-1.

const gasForBurn: Int = 6700;
const gasForTransfer: Int = 10500;
const minTonsForStorage: Int = ton("0.01");
const perInternalDeployTon: Int = ton("0.55");
const Basechain: Int = 0;
const walletStateInitCells: Int = 30;
const walletStateInitBits: Int = 20000;
/// Max excluded owner addresses on the exclusion list (gas bounded scan on transfer).
const MAX_EXCLUDED_ADDRESSES: Int = 64;

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

/// Admin updates global fee BPS on master (see burn-jetton-master).
message(0x1a72d4e2) SetFeeParams {
    queryId: Int as uint64;
    burn_rate_bps: Int;
    staking_rate_bps: Int;
    treasury_rate_bps: Int;
}

/// Admin sets staking pool and treasury owner addresses on master (their jetton wallets receive fee shares).
message(0x2b59c1a7) SetFeeDestinations {
    queryId: Int as uint64;
    staking_pool: Address;
    treasury: Address;
}

/// Admin: push cached fee config from master to one holder's jetton wallet.
message(0x3c8f9013) SyncFeeConfigToWallet {
    queryId: Int as uint64;
    owner: Address;
}

/// Master-only: update fee parameters and destination owner addresses on a wallet.
message(0x4d7e2bc4) JettonUpdateFeeConfig {
    queryId: Int as uint64;
    burn_rate_bps: Int;
    staking_rate_bps: Int;
    treasury_rate_bps: Int;
    staking_pool: Address;
    treasury: Address;
    dynamic_burn_enabled: Bool;
    large_tx_threshold: Int as coins;
    activity_threshold: Int;
    max_burn_rate_bps: Int;
    tx_count_snapshot: Int;
    activity_hour_bucket: Int;
    low_supply_mode: Bool;
    excluded_count: Int;
    excluded_head: Cell;
}

/// Admin: add holder address to the excluded-from-fees list (TEP owner address, not jetton wallet).
message(0x5a1c8f01) AddExcluded {
    queryId: Int as uint64;
    address: Address;
}

/// Admin: remove holder address from the excluded-from-fees list.
message(0x5a1c8f02) RemoveExcluded {
    queryId: Int as uint64;
    address: Address;
}

/// Admin: toggle dynamic burn bonuses (large tx + activity snapshot).
message(0x5a1c8f03) SetDynamicBurnEnabled {
    queryId: Int as uint64;
    enabled: Bool;
}

/// Admin: thresholds for dynamic burn (BPS bonuses are fixed: +25 large tx, +12 activity).
message(0x5a1c8f04) SetDynamicBurnThresholds {
    queryId: Int as uint64;
    large_tx_threshold: Int as coins;
    activity_threshold: Int;
}

/// Admin: low-supply auto fee reduction parameters.
message(0x5a1c8f05) SetAutoReduceParams {
    queryId: Int as uint64;
    threshold: Int as coins;
    low_burn_bps: Int;
    low_staking_bps: Int;
    low_treasury_bps: Int;
}

struct FeeParts {
    burn: Int;
    staking: Int;
    treasury: Int;
    net: Int;
}

/// Single empty cell for all wallets at deploy so address depends only on (owner, master, balance).
inline fun jettonWalletEmptyFeeConfig(): Cell {
    return beginCell().endCell();
}

struct DecodedFeeConfig {
    active: Bool;
    burnBps: Int;
    stakeBps: Int;
    treasBps: Int;
    poolOwner: Address;
    treasuryOwner: Address;
    dynamicBurnEnabled: Bool;
    largeTxThreshold: Int;
    activityThreshold: Int;
    maxBurnRateBps: Int;
    txCountSnapshot: Int;
    activityHourBucket: Int;
    lowSupplyMode: Bool;
    excludedCount: Int;
    excludedHead: Cell;
}

inline fun emptyExcludedHead(): Cell {
    return beginCell().endCell();
}

inline fun isExcludedChainEmpty(head: Cell): Bool {
    let s = head.beginParse();
    return s.bits() == 0 && s.refs() == 0;
}

fun isInExcludedChain(addr: Address, head: Cell): Bool {
    if (isExcludedChainEmpty(head)) {
        return false;
    }
    let s = head.beginParse();
    let a = s.loadAddress();
    if (a == addr) {
        return true;
    }
    if (s.refs() == 0) {
        return false;
    }
    return isInExcludedChain(addr, s.loadRef());
}

inline fun isExcludedMember(addr: Address, head: Cell, count: Int): Bool {
    if (count == 0 || isExcludedChainEmpty(head)) {
        return false;
    }
    return isInExcludedChain(addr, head);
}

fun excludedChainPrepend(head: Cell, addr: Address): Cell {
    return beginCell().storeAddress(addr).storeRef(head).endCell();
}

fun excludedChainRemove(addr: Address, head: Cell): Cell {
    if (isExcludedChainEmpty(head)) {
        return head;
    }
    let s = head.beginParse();
    let a = s.loadAddress();
    let tail = s.loadRef();
    if (a == addr) {
        return tail;
    }
    let newTail = excludedChainRemove(addr, tail);
    return beginCell().storeAddress(a).storeRef(newTail).endCell();
}

inline fun computeDynamicBurnBps(cfg: DecodedFeeConfig, amount: Int): Int {
    if (cfg.lowSupplyMode || !cfg.dynamicBurnEnabled) {
        return cfg.burnBps;
    }
    let bps0 = cfg.burnBps;
    let bps1 = amount > cfg.largeTxThreshold ? bps0 + 25 : bps0;
    let bps2 = cfg.txCountSnapshot > cfg.activityThreshold ? bps1 + 12 : bps1;
    return bps2 > cfg.maxBurnRateBps ? cfg.maxBurnRateBps : bps2;
}

inline fun decodeFeeConfig(cfg: Cell): DecodedFeeConfig {
    let s = cfg.beginParse();
    if (s.bits() == 0) {
        return DecodedFeeConfig {
            active: false,
            burnBps: 0,
            stakeBps: 0,
            treasBps: 0,
            poolOwner: newAddress(0, 0),
            treasuryOwner: newAddress(0, 0),
            dynamicBurnEnabled: false,
            largeTxThreshold: 0,
            activityThreshold: 100,
            maxBurnRateBps: 100,
            txCountSnapshot: 0,
            activityHourBucket: 0,
            lowSupplyMode: false,
            excludedCount: 0,
            excludedHead: emptyExcludedHead(),
        };
    }
    let active = s.loadUint(1) == 1;
    let b = s.loadUint(16);
    let st = s.loadUint(16);
    let tr = s.loadUint(16);
    let p = s.loadAddress();
    let t = s.loadAddress();
    if (s.refs() == 0) {
        return DecodedFeeConfig {
            active: active,
            burnBps: b,
            stakeBps: st,
            treasBps: tr,
            poolOwner: p,
            treasuryOwner: t,
            dynamicBurnEnabled: false,
            largeTxThreshold: 10 * pow(10, 9),
            activityThreshold: 100,
            maxBurnRateBps: 100,
            txCountSnapshot: 0,
            activityHourBucket: 0,
            lowSupplyMode: false,
            excludedCount: 0,
            excludedHead: emptyExcludedHead(),
        };
    }
    let ext = s.loadRef().beginParse();
    let dynamicBurnEnabled = ext.loadBit();
    let largeTxThreshold = ext.loadCoins();
    let activityThreshold = ext.loadUint(32);
    let maxBurnRateBps = ext.loadUint(16);
    let txCountSnapshot = ext.loadUint(32);
    let activityHourBucket = ext.loadUint(32);
    let lowSupplyMode = ext.loadBit();
    let excludedCount = ext.loadUint(16);
    let excludedHead = ext.loadRef();
    return DecodedFeeConfig {
        active: active,
        burnBps: b,
        stakeBps: st,
        treasBps: tr,
        poolOwner: p,
        treasuryOwner: t,
        dynamicBurnEnabled: dynamicBurnEnabled,
        largeTxThreshold: largeTxThreshold,
        activityThreshold: activityThreshold,
        maxBurnRateBps: maxBurnRateBps,
        txCountSnapshot: txCountSnapshot,
        activityHourBucket: activityHourBucket,
        lowSupplyMode: lowSupplyMode,
        excludedCount: excludedCount,
        excludedHead: excludedHead,
    };
}

inline fun packFeeConfigExtension(
    dynamicBurnEnabled: Bool,
    largeTxThreshold: Int,
    activityThreshold: Int,
    maxBurnRateBps: Int,
    txCountSnapshot: Int,
    activityHourBucket: Int,
    lowSupplyMode: Bool,
    excludedCount: Int,
    excludedHead: Cell,
): Cell {
    return beginCell()
        .storeBit(dynamicBurnEnabled)
        .storeCoins(largeTxThreshold)
        .storeUint(activityThreshold, 32)
        .storeUint(maxBurnRateBps, 16)
        .storeUint(txCountSnapshot, 32)
        .storeUint(activityHourBucket, 32)
        .storeBit(lowSupplyMode)
        .storeUint(excludedCount, 16)
        .storeRef(excludedHead)
        .endCell();
}

inline fun packFeeConfigCell(
    burnBps: Int,
    stakeBps: Int,
    treasBps: Int,
    poolOwner: Address,
    treasuryOwner: Address,
    ext: Cell,
): Cell {
    return beginCell()
        .storeUint(1, 1)
        .storeUint(burnBps, 16)
        .storeUint(stakeBps, 16)
        .storeUint(treasBps, 16)
        .storeAddress(poolOwner)
        .storeAddress(treasuryOwner)
        .storeRef(ext)
        .endCell();
}

inline fun computeFeeParts(amount: Int, burnBps: Int, stakeBps: Int, treasBps: Int): FeeParts {
    let b = amount * burnBps / 10000;
    let s = amount * stakeBps / 10000;
    let t = amount * treasBps / 10000;
    let n = amount - b - s - t;
    return FeeParts { burn: b, staking: s, treasury: t, net: n };
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
    feeConfig: Cell,
) {
    receive(msg: JettonUpdateFeeConfig) {
        require(sender() == self.master, "Incorrect sender");
        require(
            msg.burn_rate_bps + msg.staking_rate_bps + msg.treasury_rate_bps <= 10000,
            "Invalid fee bps",
        );
        let ext = packFeeConfigExtension(
            msg.dynamic_burn_enabled,
            msg.large_tx_threshold,
            msg.activity_threshold,
            msg.max_burn_rate_bps,
            msg.tx_count_snapshot,
            msg.activity_hour_bucket,
            msg.low_supply_mode,
            msg.excluded_count,
            msg.excluded_head,
        );
        self.feeConfig = packFeeConfigCell(
            msg.burn_rate_bps,
            msg.staking_rate_bps,
            msg.treasury_rate_bps,
            msg.staking_pool,
            msg.treasury,
            ext,
        );
    }

    receive(msg: JettonTransfer) {
        forceBasechain(msg.destination);
        require(sender() == self.owner, "Incorrect sender");
        require(msg.amount > 0, "Amount must be positive");

        let cfg = decodeFeeConfig(self.feeConfig);
        require(cfg.active, "Fee destinations not configured");
        forceBasechain(cfg.poolOwner);
        forceBasechain(cfg.treasuryOwner);

        let excludedTransfer = isExcludedMember(
            self.owner,
            cfg.excludedHead,
            cfg.excludedCount,
        ) || isExcludedMember(msg.destination, cfg.excludedHead, cfg.excludedCount);

        if (excludedTransfer) {
            self.balance -= msg.amount;
            require(self.balance >= 0, "Incorrect balance after send");
            checkEitherForwardPayload(msg.forwardPayload);

            let ctx = context();
            let fwd = ctx.readForwardFee();
            let recipientForwards = 1 + sign(msg.forwardTonAmount);
            require(
                ctx.value > msg.forwardTonAmount + recipientForwards * fwd + ton("2.1"),
                "Insufficient amount of TON attached",
            );

            let emptyCfg = jettonWalletEmptyFeeConfig();
            deploy(DeployParameters {
                value: perInternalDeployTon,
                bounce: true,
                mode: SendPayGasSeparately,
                body: JettonTransferInternal {
                    queryId: msg.queryId,
                    amount: msg.amount,
                    sender: self.owner,
                    responseDestination: msg.responseDestination,
                    forwardTonAmount: msg.forwardTonAmount,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
                init: initOf BurnJettonWallet(msg.destination, self.master, 0, emptyCfg),
            });
            return;
        }

        let burnBps = computeDynamicBurnBps(cfg, msg.amount);
        let parts = computeFeeParts(msg.amount, burnBps, cfg.stakeBps, cfg.treasBps);
        require(parts.burn + parts.staking + parts.treasury + parts.net == msg.amount, "Fee split invariant");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");
        checkEitherForwardPayload(msg.forwardPayload);

        let ctx = context();
        let fwd = ctx.readForwardFee();
        let deployPart =
            getForwardFee(walletStateInitCells, walletStateInitBits, false) +
            2 * getComputeFee(gasForTransfer, false) +
            minTonsForStorage;
        let recipientForwards = 1 + sign(msg.forwardTonAmount);
        require(
            ctx.value > msg.forwardTonAmount + recipientForwards * fwd + ton("2.1"),
            "Insufficient amount of TON attached",
        );

        let emptyCfg = jettonWalletEmptyFeeConfig();
        let poolWalletInit = initOf BurnJettonWallet(cfg.poolOwner, self.master, 0, emptyCfg);
        let treasWalletInit = initOf BurnJettonWallet(cfg.treasuryOwner, self.master, 0, emptyCfg);

        deploy(DeployParameters {
            value: perInternalDeployTon,
            bounce: true,
            mode: SendPayGasSeparately,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: parts.net,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            init: initOf BurnJettonWallet(msg.destination, self.master, 0, emptyCfg),
        });

        deploy(DeployParameters {
            value: perInternalDeployTon,
            bounce: true,
            mode: SendPayGasSeparately,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: parts.staking,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: 0,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            }.toCell(),
            init: poolWalletInit,
        });

        deploy(DeployParameters {
            value: perInternalDeployTon,
            bounce: true,
            mode: SendPayGasSeparately,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: parts.treasury,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: 0,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            }.toCell(),
            init: treasWalletInit,
        });

        message(MessageParameters {
            to: self.master,
            value: ton("0.06"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: JettonBurnNotification {
                queryId: msg.queryId,
                amount: parts.burn,
                sender: self.owner,
                responseDestination: msg.responseDestination,
            }.toCell(),
        });
    }

    receive(msg: JettonTransferInternal) {
        self.balance += msg.amount;

        let wallet: StateInit = initOf BurnJettonWallet(msg.sender, self.master, 0, jettonWalletEmptyFeeConfig());
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

    /// Whether master pushed fee config (for tests / off-chain reads).
    get fun get_fee_config_active(): Bool {
        return decodeFeeConfig(self.feeConfig).active;
    }
}
