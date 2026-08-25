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
        /** Timelock.init governor address (deployer EOA or TIMELOCK_GOVERNOR multisig). */
        timelockGovernor?: string;
        /** IMP-MNAUD-F05: MAINNET_FINALIZE stage applied — mintable=false, jetton admin revoked. */
        supplyFinalized?: boolean;
    };
};

export type MintAllocation = {
    label: string;
    burnAmount: bigint;
    /** `stakingPool` mints straight to the pool jetton wallet (emission reserve, IMP-MNAUD-F01). */
    receiver:
        | 'vestingDeveloper'
        | 'vestingEcosystem'
        | 'vestingReserve'
        | 'stakingPool'
        | 'airdropHolder'
        | 'liquidityHolder';
};
