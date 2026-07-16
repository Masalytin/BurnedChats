import type { DeploymentFile } from './types';

export const PENDING_JETTON_MASTER = 'PENDING_POST_DEPLOY';

type LegacyDeployment = {
    network?: 'testnet' | 'mainnet';
    deployedAt?: string;
    addresses?: { jettonMaster?: string };
    jettonMaster?: string;
    totalSupplyAfterLpBurn?: string | null;
    mintClosed?: boolean;
    adminRevoked?: boolean;
};

export function buildBootstrapManifest(opts: {
    network: 'testnet' | 'mainnet';
    jettonMaster: string;
    deployedAt?: string;
}): DeploymentFile {
    return {
        network: opts.network,
        deployedAt: opts.deployedAt ?? new Date().toISOString().slice(0, 10),
        jettonMaster: opts.jettonMaster,
        totalSupplyAfterLpBurn: null,
        mintClosed: false,
        adminRevoked: false,
    };
}

export function parseDeploymentFile(raw: unknown): DeploymentFile | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const obj = raw as LegacyDeployment;
    const jettonMaster = obj.jettonMaster?.trim() || obj.addresses?.jettonMaster?.trim();
    if (!jettonMaster) {
        return null;
    }
    const network = obj.network === 'mainnet' ? 'mainnet' : 'testnet';
    return {
        network,
        deployedAt: obj.deployedAt ?? new Date().toISOString().slice(0, 10),
        jettonMaster,
        totalSupplyAfterLpBurn: obj.totalSupplyAfterLpBurn ?? null,
        mintClosed: obj.mintClosed === true,
        adminRevoked: obj.adminRevoked === true,
    };
}

export function resolveJettonMaster(deployment: DeploymentFile): string {
    const addr = deployment.jettonMaster.trim();
    if (!addr || addr === PENDING_JETTON_MASTER) {
        throw new Error(
            `deployments/${deployment.network}.json jettonMaster is pending — run bootstrap deploy first`,
        );
    }
    return addr;
}

export function updateManifestFlags(
    current: DeploymentFile,
    patch: Partial<Pick<DeploymentFile, 'totalSupplyAfterLpBurn' | 'mintClosed' | 'adminRevoked'>>,
): DeploymentFile {
    return {
        ...current,
        ...patch,
    };
}
