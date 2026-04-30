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

contract BurnJettonMaster(
    totalSupply: Int as coins,
    admin: Address,
    content: Cell,
    mintable: Bool,
    burnRateBps: Int,
    stakingRateBps: Int,
    treasuryRateBps: Int,
    stakingPoolOwner: Address,
    treasuryOwner: Address,
    feeDestinationsActive: Bool,
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
        require(sender() == self.admin, "Incorrect sender");
        require(
            msg.burn_rate_bps + msg.staking_rate_bps + msg.treasury_rate_bps <= 10000,
            "Invalid fee bps",
        );
        self.burnRateBps = msg.burn_rate_bps;
        self.stakingRateBps = msg.staking_rate_bps;
        self.treasuryRateBps = msg.treasury_rate_bps;
    }

    receive(msg: SetFeeDestinations) {
        require(sender() == self.admin, "Incorrect sender");
        self.stakingPoolOwner = msg.staking_pool;
        self.treasuryOwner = msg.treasury;
        self.feeDestinationsActive = true;
    }

    receive(msg: SyncFeeConfigToWallet) {
        require(sender() == self.admin, "Incorrect sender");
        require(self.feeDestinationsActive, "Fee destinations not configured on master");

        let ctx = context();
        require(ctx.value > ton("0.03"), "Insufficient TON for sync");

        let cfg = JettonUpdateFeeConfig {
            queryId: msg.queryId,
            burn_rate_bps: self.burnRateBps,
            staking_rate_bps: self.stakingRateBps,
            treasury_rate_bps: self.treasuryRateBps,
            staking_pool: self.stakingPoolOwner,
            treasury: self.treasuryOwner,
        };

        message(MessageParameters {
            body: cfg.toCell(),
            to: getBurnJettonWalletByOwner(msg.owner),
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
