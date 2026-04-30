// SPDX-License-Identifier: MIT
// Shared opcodes between StakingPool and StakingMaster

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
