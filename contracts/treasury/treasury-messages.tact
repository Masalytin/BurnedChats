// SPDX-License-Identifier: MIT
// Treasury spend message layout (timelock-delivered execution). Contract shell in P5-3-2-1.

message(0x5a050001) TreasurySpend {
    queryId: Int as uint64;
    recipient: Address;
    amount: Int as coins;
    reason: Cell;
}
