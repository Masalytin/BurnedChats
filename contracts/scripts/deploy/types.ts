export type DeploymentAddresses = {
    jettonMaster: string;
    developerHolder: string;
    liquidityHolder: string;
};

export type DeploymentFile = {
    network: 'testnet' | 'mainnet';
    deployedAt: string;
    deployer: string;
    metadataUri: string;
    addresses: DeploymentAddresses;
};

export type MintAllocation = {
    label: string;
    burnAmount: bigint;
    receiver: 'developerHolder' | 'liquidityHolder';
};
