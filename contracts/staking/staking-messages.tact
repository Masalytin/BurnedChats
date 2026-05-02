// SPDX-License-Identifier: MIT
// Shared opcodes between StakingPool and StakingMaster

// TEP-74 Jetton transfer — opcode MUST match burn-jetton-wallet.tact JettonTransfer
message(0xf8a7ea5) JettonTransferOut {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address?;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

/// Forward payload attached to jetton transfer notifying stake intent (TEP-74 forward_payload ref).
message(0x5a020010) StakeForward {
    tier: Int as uint8;
}

message(0x5a010010) IncrementTotalStake {
    queryId: Int as uint64;
    tier: Int as uint8;
    delta: Int as coins;
}

message(0x5a010011) DecrementTotalStake {
    queryId: Int as uint64;
    tier: Int as uint8;
    delta: Int as coins;
}

message(0x5a010012) PayRewards {
    queryId: Int as uint64;
    recipient: Address;
    amount: Int as coins;
}

message(0x5a010013) CreditPoolBalance {
    queryId: Int as uint64;
    delta: Int as coins;
}

message(0x5a010014) WireStakingMaster {
    queryId: Int as uint64;
    stakingMaster: Address;
}

/// Staking Master relays to Pool → Pool notifies Master (`StakeFeeRewardsAccrue`) so `sender()==pool`.
message(0x5a010015) RelayStakeFeeAccrual {
    queryId: Int as uint64;
    feeAmount: Int as coins;
}

message(0x5a010016) StakeFeeRewardsAccrue {
    queryId: Int as uint64;
    feeAmount: Int as coins;
}
