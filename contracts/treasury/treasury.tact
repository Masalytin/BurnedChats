// SPDX-License-Identifier: MIT
// Treasury — BURN fee sink; spend only via Timelock (governance).

import "../jetton/burn-jetton-wallet";

/// Lower bound on TON that must accompany a `TreasurySpend` so the outgoing
/// `JettonTransfer` clears the jetton-wallet excluded-path gate end-to-end
/// (gate ~0.58 + recipient wallet deploy 0.55 + fee-config sync 0.05 + fwd/gas).
/// Treasury is on the master excluded list (bootstrap), so the cheaper excluded
/// path applies, but it still needs ~1 TON of headroom. The actual forwarded
/// value is relayed from the inbound Timelock message (`SendRemainingValue`),
/// not from this constant or from Treasury's own (storage-only) balance.
const MIN_SPEND_FORWARD: Int = ton("1.0");

struct SpendRecord {
    recipient: Address;
    amount: Int as coins;
    reason: String;
    timestamp: Int as uint64;
    proposalId: Int as uint64;
    /// Outbound `JettonTransfer.queryId` — bounce rollback key (IMP-MNAUD-F12).
    /// Post-F08 Timelock rewrites high-value args queryId to proposalId before
    /// dispatch, so for Timelock-delivered spends queryId == proposalId.
    queryId: Int as uint64;
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
    /// Plain TON from Timelock (governance relay) or the treasury jetton wallet must not
    /// bounce back — that would ping-pong with Timelock's generic receive() (RC-A / IMP-RELAY-04).
    /// External senders still get terminal cashback (Treasury is not a TON sink).
    inline fun treasury_jetton_wallet(): Address {
        return contractAddress(initOf BurnJettonWallet(myAddress(), self.jetton_master, 0, jettonWalletEmptyFeeConfig()));
    }

    receive() {
        let s = sender();
        if (s != self.timelock && s != self.treasury_jetton_wallet()) {
            cashback(s);
        }
    }

    receive(msg: JettonNotification) {
        let wallet = self.treasury_jetton_wallet();
        require(sender() == wallet, "Only treasury jetton wallet");
        self.total_received += msg.amount;
    }

    receive(msg: TreasurySpend) {
        require(sender() == self.timelock, "Only timelock");
        require(msg.amount > 0, "Zero amount");

        let avail = self.total_received - self.total_spent;
        require(msg.amount <= avail, "Insufficient tracked balance");

        /// Fail loudly (before any accounting mutation) if Timelock under-funds the
        /// spend: a too-small forward would bounce at the jetton-wallet gate and the
        /// payout would be silently lost. Aborting here leaves `total_spent`/
        /// `spending_log` untouched, so the proposal "Executed" / treasury "no spend"
        /// mismatch is auditable rather than a corrupted record. See
        /// See docs/specs/TOKENOMICS.md (treasury spend relay gas budget).
        require(context().value >= MIN_SPEND_FORWARD, "Insufficient gas for spend");

        // Ambiguous bounce rollback if two open spends share a queryId.
        let scan: Int = 0;
        while (scan < self.spending_count) {
            let existingOpt = self.spending_log.get(scan);
            if (existingOpt != null) {
                require(existingOpt!!.queryId != msg.queryId, "Duplicate spend queryId");
            }
            scan += 1;
        }

        let idx = self.spending_count;
        self.spending_log.set(
            idx,
            SpendRecord {
                recipient: msg.recipient,
                amount: msg.amount,
                reason: msg.reason,
                timestamp: now(),
                proposalId: msg.proposalId,
                queryId: msg.queryId,
            },
        );
        self.spending_count = idx + 1;
        self.total_spent += msg.amount;

        let wallet = self.treasury_jetton_wallet();
        // Relay the inbound TON budget straight into the jetton transfer
        // (`SendRemainingValue`): the forwarded value is derived from the Timelock
        // message, never from a hardcoded constant or Treasury's storage balance.
        // Surplus left after the wallet deploy/sync is returned to the grant
        // `recipient` (responseDestination) so it never bounces back to Treasury,
        // which has no `JettonExcesses` handler.
        message(MessageParameters {
            to: wallet,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonTransfer {
                queryId: msg.queryId,
                amount: msg.amount,
                destination: msg.recipient,
                responseDestination: msg.recipient,
                customPayload: null,
                forwardTonAmount: 0,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            }.toCell(),
        });
    }

    /// Jetton wallet bounced `JettonTransfer` (e.g. insufficient jetton balance) — roll back accounting.
    /// Match by `queryId` (not LIFO): interleaved spends must not roll back the wrong entry
    /// or throw on amount mismatch and permanently inflate `total_spent` (IMP-MNAUD-F12).
    bounced(msg: bounced<JettonTransfer>) {
        require(self.spending_count > 0, "Unexpected bounce");
        let found: Int = -1;
        let i: Int = 0;
        while (i < self.spending_count) {
            let candOpt = self.spending_log.get(i);
            if (candOpt != null) {
                if (candOpt!!.queryId == msg.queryId) {
                    found = i;
                }
            }
            i += 1;
        }
        require(found >= 0, "Bounce queryId unknown");
        let recOpt = self.spending_log.get(found);
        require(recOpt != null, "Unexpected bounce log");
        let rec = recOpt!!;
        require(rec.amount == msg.amount, "Bounce amount mismatch");

        // Swap-remove to keep indices dense: [0 .. spending_count) with no holes
        // so getters/`spending_count` stay coherent after arbitrary-index delete.
        let lastIdx = self.spending_count - 1;
        if (found != lastIdx) {
            let lastOpt = self.spending_log.get(lastIdx);
            require(lastOpt != null, "Unexpected bounce log");
            self.spending_log.set(found, lastOpt!!);
        }
        self.spending_log.del(lastIdx);
        self.spending_count = lastIdx;
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
