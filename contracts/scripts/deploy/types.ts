export type DeploymentAddresses = {
    jettonMaster: string;
    treasury: string;
    treasuryJettonWallet: string;
    stakingPool: string;
    stakingLock: string;
    stakingMaster: string;
    governor: string;
    timelock: string;
    vestingDeveloper: string;
    vestingEcosystem: string;
    vestingReserve: string;
    vestingStakingAllocation: string;
    airdropHolder: string;
    liquidityHolder: string;
};

export type DeploymentFile = {
    network: 'testnet' | 'mainnet';
    deployedAt: string;
    deployer: string;
    metadataUri: string;
    addresses: DeploymentAddresses;
    bootstrap?: {
        jettonTimelockIsDeployer: boolean;
        timelockGovernorIsDeployer: boolean;
        stakingMasterGovernorIsDeployer: boolean;
    };
};

export type MintAllocation = {
    label: string;
    burnAmount: bigint;
    receiver: 'vestingDeveloper' | 'vestingEcosystem' | 'vestingReserve' | 'vestingStakingAllocation' | 'airdropHolder' | 'liquidityHolder';
};
