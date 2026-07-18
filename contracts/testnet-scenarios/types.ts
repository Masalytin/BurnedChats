import type { DeploymentFile } from '../scripts/deploy/types';

/** Single assertion outcome from a scenario (or shared check helper). */
export type CheckResult = {
    ok: boolean;
    message: string;
};

export type ScenarioStatus = 'pass' | 'fail' | 'skip' | 'error';

/**
 * Runtime context passed to scenario `run`.
 * NetworkProvider / TonClient wiring lands with scenario migration (IMP-TNSCEN-02);
 * harness v1 validates env + deployment and exposes deployment metadata.
 */
export type ScenarioContext = {
    contractsRoot: string;
    network: 'testnet';
    jettonMaster: string;
    fingerprint: string;
    deployment: DeploymentFile;
    force: boolean;
};

export type Scenario = {
    id: string;
    title: string;
    description: string;
    /** e.g. 'burn' | 'readonly' | 'destructive' | 'tep89' | 'admin' */
    tags: string[];
    needsLiveTx: boolean;
    run(ctx: ScenarioContext): Promise<CheckResult[]>;
};

export type ScenarioRunResult = {
    id: string;
    status: ScenarioStatus;
    durationMs: number;
    checks: CheckResult[];
    txUrls: string[];
    error?: string;
};

export type Report = {
    network: string;
    master: string;
    fingerprint: string;
    filter: string;
    started: string;
    finished: string;
    scenarios: ScenarioRunResult[];
};

export type CliFilter = {
    list?: boolean;
    scenario?: string;
    tag?: string;
    all?: boolean;
    failedOnly?: boolean;
    force?: boolean;
};

export type SkipEntry = {
    status: 'pass' | 'fail';
    ts: string;
    reportPath?: string;
    txHashes?: string[];
};

export type SkipState = {
    entries: Record<string, SkipEntry>;
};
