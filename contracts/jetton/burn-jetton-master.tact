// SPDX-License-Identifier: MIT
// BURN Jetton master (TEP-74 + TEP-64). Max supply 1000 BURN (9 decimals).

import "./burn-jetton-wallet";

/// 1000 tokens * 10^9 nano
const BURN_MAX_SUPPLY_NANO: Int = 1000 * pow(10, 9);

struct BurnJettonMasterState {
    totalSupply: Int as coins;
    mintable: Bool;
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
}

struct MasterFeeParamsView {
    burnRateBps: Int;
    stakingRateBps: Int;
    treasuryRateBps: Int;
    stakingPoolOwner: Address;
    treasuryOwner: Address;
    feeDestinationsActive: Bool;
}

struct EffectiveFeeParams {
    burnBps: Int;
    stakingBps: Int;
    treasuryBps: Int;
}

contract BurnJettonMaster(
    totalSupply: Int as coins,
    admin: Address,
    timelock: Address,
    content: Cell,
    mintable: Bool,
    burnRateBps: Int,
    stakingRateBps: Int,
    treasuryRateBps: Int,
    stakingPoolOwner: Address,
    treasuryOwner: Address,
    feeDestinationsActive: Bool,
    excludedHead: Cell,
    excludedCount: Int,
    dynamicBurnEnabled: Bool,
    largeTxThreshold: Int as coins,
    activityThreshold: Int,
    maxBurnRateBps: Int,
    txCountLastHour: Int,
    activityHourBucket: Int,
    autoReduceThreshold: Int as coins,
    lowBurnBps: Int,
    lowStakingBps: Int,
    lowTreasuryBps: Int,
) {
    receive() {
        cashback(sender());
    }

    receive(msg: ProvideWalletAddress) {
        let ownerWorkchain: Int = parseStdAddress(msg.ownerAddress.asSlice()).workchain;
        let targetJettonWallet: BasechainAddress = (ownerWorkchain == Basechain)
            ? contractBasechainAddress(getBurnJettonWalletInit(msg.ownerAddress))
            : emptyBasechainAddress();

        message(MessageParameters {
            body: makeTakeWalletAddressMsg(targetJettonWallet, msg),
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

    receive(msg: JettonBurnNotification) {
        let s = parseStdAddress(sender().asSlice());
        let wallet = getBurnJettonBasechainWalletByOwner(msg.sender);
        require(s.workchain == Basechain && s.address == wallet.hash!!, "Unauthorized burn");

        let hour = now() / 3600;
        if (hour != self.activityHourBucket) {
            self.activityHourBucket = hour;
            self.txCountLastHour = 0;
        }
        self.txCountLastHour += 1;

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

    receive(msg: ChangeOwner) {
        require(sender() == self.admin, "Incorrect sender");
        self.admin = msg.newOwner;
    }

    receive(msg: SetFeeParams) {
        require(sender() == self.timelock, "Only timelock");
        require(
            msg.burn_rate_bps + msg.staking_rate_bps + msg.treasury_rate_bps <= 10000,
            "Invalid fee bps",
        );
        self.burnRateBps = msg.burn_rate_bps;
        self.stakingRateBps = msg.staking_rate_bps;
        self.treasuryRateBps = msg.treasury_rate_bps;
    }

    receive(msg: SetFeeDestinations) {
        require(sender() == self.timelock, "Only timelock");
        self.stakingPoolOwner = msg.staking_pool;
        self.treasuryOwner = msg.treasury;
        self.feeDestinationsActive = true;
    }

    receive(msg: AddExcluded) {
        require(sender() == self.timelock, "Only timelock");
        if (!isInExcludedChain(msg.address, self.excludedHead)) {
            require(self.excludedCount < MAX_EXCLUDED_ADDRESSES, "Max excluded");
            self.excludedHead = excludedChainPrepend(self.excludedHead, msg.address);
            self.excludedCount += 1;
        }
    }

    receive(msg: RemoveExcluded) {
        require(sender() == self.timelock, "Only timelock");
        if (isInExcludedChain(msg.address, self.excludedHead)) {
            self.excludedHead = excludedChainRemove(msg.address, self.excludedHead);
            self.excludedCount -= 1;
        }
    }

    receive(msg: SetDynamicBurnEnabled) {
        require(sender() == self.timelock, "Only timelock");
        self.dynamicBurnEnabled = msg.enabled;
    }

    receive(msg: SetDynamicBurnThresholds) {
        require(sender() == self.timelock, "Only timelock");
        self.largeTxThreshold = msg.large_tx_threshold;
        self.activityThreshold = msg.activity_threshold;
    }

    receive(msg: SetAutoReduceParams) {
        require(sender() == self.timelock, "Only timelock");
        require(
            msg.low_burn_bps + msg.low_staking_bps + msg.low_treasury_bps <= 10000,
            "Invalid low fee bps",
        );
        self.autoReduceThreshold = msg.threshold;
        self.lowBurnBps = msg.low_burn_bps;
        self.lowStakingBps = msg.low_staking_bps;
        self.lowTreasuryBps = msg.low_treasury_bps;
    }

    receive(msg: SetTimelock) {
        require(sender() == self.timelock, "Only timelock");
        self.timelock = msg.newTimelock;
    }

    receive(msg: SyncFeeConfigToWallet) {
        require(sender() == self.timelock, "Only timelock");
        require(self.feeDestinationsActive, "Fee destinations not configured on master");

        let ctx = context();
        require(ctx.value > ton("0.03"), "Insufficient TON for sync");

        self.pushFeeConfigToOwner(msg.queryId, msg.owner);
    }

    receive(msg: PropagateFeeConfigToOwner) {
        require(self.feeDestinationsActive, "Fee destinations not configured on master");
        require(getBurnJettonWalletByOwner(msg.sender_owner) == sender(), "Unauthorized jetton wallet");
        self.pushFeeConfigToOwner(msg.queryId, msg.recipient_owner);
    }

    inline fun pushFeeConfigToOwner(queryId: Int, owner: Address) {
        let low = self.totalSupply < self.autoReduceThreshold;
        let effBurn = low ? self.lowBurnBps : self.burnRateBps;
        let effStake = low ? self.lowStakingBps : self.stakingRateBps;
        let effTreas = low ? self.lowTreasuryBps : self.treasuryRateBps;

        let cfg = JettonUpdateFeeConfig {
            queryId: queryId,
            burn_rate_bps: effBurn,
            staking_rate_bps: effStake,
            treasury_rate_bps: effTreas,
            staking_pool: self.stakingPoolOwner,
            treasury: self.treasuryOwner,
            dynamic_burn_enabled: self.dynamicBurnEnabled,
            large_tx_threshold: self.largeTxThreshold,
            activity_threshold: self.activityThreshold,
            max_burn_rate_bps: self.maxBurnRateBps,
            tx_count_snapshot: self.txCountLastHour,
            activity_hour_bucket: self.activityHourBucket,
            low_supply_mode: low,
            excluded_count: self.excludedCount,
            excluded_head: self.excludedHead,
        };

        message(MessageParameters {
            body: cfg.toCell(),
            to: getBurnJettonWalletByOwner(owner),
            value: 0,
            bounce: false,
            mode: SendRemainingValue | SendIgnoreErrors,
        });
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

    get fun get_timelock_address(): Address {
        return self.timelock;
    }

    get fun get_wallet_address(ownerAddress: Address): Address {
        return getBurnJettonWalletByOwner(ownerAddress);
    }

    get fun get_fee_params(): MasterFeeParamsView {
        return MasterFeeParamsView {
            burnRateBps: self.burnRateBps,
            stakingRateBps: self.stakingRateBps,
            treasuryRateBps: self.treasuryRateBps,
            stakingPoolOwner: self.stakingPoolOwner,
            treasuryOwner: self.treasuryOwner,
            feeDestinationsActive: self.feeDestinationsActive,
        };
    }

    get fun get_effective_fee_params(): EffectiveFeeParams {
        let low = self.totalSupply < self.autoReduceThreshold;
        return EffectiveFeeParams {
            burnBps: low ? self.lowBurnBps : self.burnRateBps,
            stakingBps: low ? self.lowStakingBps : self.stakingRateBps,
            treasuryBps: low ? self.lowTreasuryBps : self.treasuryRateBps,
        };
    }

    get fun get_is_excluded(holder: Address): Bool {
        return isInExcludedChain(holder, self.excludedHead);
    }

    /// Treasury TEP-74 owner address (must match `SetFeeDestinations.treasury` — typically the Treasury contract).
    get fun get_treasury_address(): Address {
        return self.treasuryOwner;
    }
}

inline fun getBurnJettonWalletInit(address: Address): StateInit {
    return initOf BurnJettonWallet(address, myAddress(), 0, jettonWalletEmptyFeeConfig());
}

inline fun getBurnJettonWalletByOwner(jettonWalletOwner: Address): Address {
    return contractAddress(getBurnJettonWalletInit(jettonWalletOwner));
}

inline fun getBurnJettonBasechainWalletByOwner(jettonWalletOwner: Address): BasechainAddress {
    return contractBasechainAddress(getBurnJettonWalletInit(jettonWalletOwner));
}
