export type DeploymentFile = {
    network: 'testnet' | 'mainnet';
    deployedAt: string;
    jettonMaster: string;
    /** Nano-string total supply after LP provision burn; null until LP step completes. */
    totalSupplyAfterLpBurn: string | null;
    mintClosed: boolean;
    adminRevoked: boolean;
};

export type MintAllocation = {
    label: string;
    burnAmount: bigint;
    receiver: 'developerHolder' | 'liquidityHolder';
};
