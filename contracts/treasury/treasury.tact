// SPDX-License-Identifier: MIT
// Treasury — BURN fee sink; spend only via Timelock (governance) — P5-3-2-1.

import "../jetton/burn-jetton-wallet";

struct SpendRecord {
    recipient: Address;
    amount: Int as coins;
    reason: String;
    timestamp: Int as uint64;
    proposalId: Int as uint64;
}

/// Timelock sends this body as `queueArgs` after a Treasury Spend proposal executes.
message(0x5a1c9010) TreasurySpend {
    queryId: Int as uint64;
    recipient: Address;
    amount: Int as coins;
    reason: String;
    proposalId: Int as uint64;
}

contract Treasury(
    timelock: Address,
    jetton_master: Address,
    total_received: Int as coins,
    total_spent: Int as coins,
    spending_log: map<Int, SpendRecord>,
    spending_count: Int,
) {
    receive() {
        cashback(sender());
    }

    receive(msg: JettonNotification) {
        let wallet = contractAddress(initOf BurnJettonWallet(myAddress(), self.jetton_master, 0, jettonWalletEmptyFeeConfig()));
        require(sender() == wallet, "Only treasury jetton wallet");
        self.total_received += msg.amount;
    }

    receive(msg: TreasurySpend) {
        require(sender() == self.timelock, "Only timelock");
        require(msg.amount > 0, "Zero amount");

        let avail = self.total_received - self.total_spent;
        require(msg.amount <= avail, "Insufficient tracked balance");

        let idx = self.spending_count;
        self.spending_log.set(
            idx,
            SpendRecord {
                recipient: msg.recipient,
                amount: msg.amount,
                reason: msg.reason,
                timestamp: now(),
                proposalId: msg.proposalId,
            },
        );
        self.spending_count = idx + 1;
        self.total_spent += msg.amount;

        let wallet = contractAddress(initOf BurnJettonWallet(myAddress(), self.jetton_master, 0, jettonWalletEmptyFeeConfig()));
        message(MessageParameters {
            to: wallet,
            value: ton("0.18"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: JettonTransfer {
                queryId: msg.queryId,
                amount: msg.amount,
                destination: msg.recipient,
                responseDestination: myAddress(),
                customPayload: null,
                forwardTonAmount: 0,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            }.toCell(),
        });
    }

    /// Jetton wallet bounced `JettonTransfer` (e.g. insufficient jetton balance) — roll back accounting.
    bounced(msg: bounced<JettonTransfer>) {
        require(self.spending_count > 0, "Unexpected bounce");
        let idx = self.spending_count - 1;
        let recOpt = self.spending_log.get(idx);
        require(recOpt != null, "Unexpected bounce log");
        let rec = recOpt!!;
        require(rec.amount == msg.amount, "Bounce amount mismatch");
        self.spending_log.del(idx);
        self.spending_count = idx;
        self.total_spent -= rec.amount;
    }

    get fun get_timelock(): Address {
        return self.timelock;
    }

    get fun get_jetton_master(): Address {
        return self.jetton_master;
    }

    get fun get_total_received(): Int {
        return self.total_received;
    }

    get fun get_total_spent(): Int {
        return self.total_spent;
    }

    get fun get_spending_count(): Int {
        return self.spending_count;
    }

    get fun get_spending_history(): map<Int, SpendRecord> {
        return self.spending_log;
    }

    /// `total_received - total_spent` from on-notification accounting; use jetton wallet for exact balance.
    get fun get_accounted_balance(): Int {
        return self.total_received - self.total_spent;
    }
}
