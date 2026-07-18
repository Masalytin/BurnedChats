/**
 * Full-stack live testnet scenario harness types (IMP-TNFS-02 / IMP-TNFS-03).
 * Canon: fee 0.5% burn + 0.3% staking + 0.2% treasury — not TOKSIM pure-1%-burn.
 */
import type { NetworkProvider } from '@ton/blueprint';

export type ManifestKind = 'shared' | 'lab';

export type CheckResult = {
    ok: boolean;
    name: string;
    message: string;
};

export type ScenarioStatus = 'pass' | 'fail' | 'skipped' | 'na';

/** Optional code hashes keyed by logical master name (jetton, staking, …). */
export type CodeHashes = Partial<
    Record<'jetton' | 'staking' | 'governor' | 'timelock' | 'treasury' | 'vesting', string>
> &
    Record<string, string | undefined>;

export type FullStackAddresses = {
    jettonMaster: string;
    stakingMaster: string;
    governor: string;
    timelock: string;
    treasury: string;
    vestingDeveloper?: string;
    vestingEcosystem?: string;
    vestingReserve?: string;
    vestingStakingAllocation?: string;
    [key: string]: string | undefined;
};

export type FullStackManifest = {
    network: 'testnet' | 'mainnet';
    role?: string;
    deployedAt?: string;
    deployer?: string;
    metadataUri?: string;
    addresses: FullStackAddresses;
    /** Optional; included in fingerprint when present. */
    codeHashes?: CodeHashes;
    lab?: Record<string, unknown>;
    bootstrap?: Record<string, unknown>;
};

export type ScenarioContext = {
    network: 'testnet';
    contractsRoot: string;
    manifestKind: ManifestKind;
    manifest: FullStackManifest;
    deploymentFingerprint: string;
    /** Blueprint provider — bootstrapped once per runner invocation (IMP-TNFS-03). */
    provider: NetworkProvider;
};

export type Scenario = {
    id: string;
    title: string;
    description: string;
    tags: string[];
    needsLiveTx: boolean;
    /** When true (or tags includes "destructive"), excluded from --all. */
    destructive?: boolean;
    depends_on?: string[];
    /** Return a reason string to mark N/A / skipped without running. */
    naWhen?: (ctx: ScenarioContext) => string | null | undefined | Promise<string | null | undefined>;
    run: (ctx: ScenarioContext) => Promise<CheckResult[]>;
};

export type ScenarioRunResult = {
    id: string;
    title: string;
    status: ScenarioStatus;
    durationMs: number;
    checks: CheckResult[];
    txUrls?: string[];
    error?: string;
    naReason?: string;
    skippedReason?: string;
};

export type Report = {
    network: 'testnet';
    manifestKind: ManifestKind;
    fingerprint: string;
    filter: string;
    started: string;
    finished: string;
    scenarios: ScenarioRunResult[];
};

export type ScenarioStateEntry = {
    status: 'pass' | 'fail';
    ts: string;
    reportPath?: string;
    txHashes?: string[];
};

export type RunnerState = {
    version: 1;
    deploymentFingerprint: string;
    scenarios: Record<string, ScenarioStateEntry>;
};

export type CliFilterMode = 'list' | 'scenario' | 'tag' | 'all' | 'failed-only';

export type CliOptions = {
    mode: CliFilterMode;
    scenarioId?: string;
    tag?: string;
    force: boolean;
    manifest: ManifestKind;
    /** Raw argv included --mainnet (hard-fail before run). */
    requestedMainnet: boolean;
};
