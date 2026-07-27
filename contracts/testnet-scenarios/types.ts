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
    /** Pre-IMP-MNAUD-F01 stacks only — post-F01 deploys mint the staking allocation to the pool. */
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

/**
 * Declared TON attach budget for a live scenario (IMP-TNFS-F10).
 * V5R1 wallets SILENTLY SKIP an action whose attach exceeds the balance
 * (external accepted, seqno grows, internal never sent) — the runner
 * preflights the signer's live TON balance against `minTon` and returns
 * N/A `insufficient-sender-ton` instead of an inscrutable downstream FAIL.
 */
export type ScenarioBudget = {
    /** Which wallet is expected to fund the attaches ('actor' = Actor A, 'deploy' = deploy/governor wallet). */
    signer: 'actor' | 'deploy';
    /** Minimum live TON balance (nano) the signer must hold before the scenario runs. */
    minTon: bigint;
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
    /** Declared attach budget — runner preflights signer TON balance (IMP-TNFS-F10). */
    budget?: ScenarioBudget;
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
    /** Take over a live single-runner lock (IMP-TNFS-F10). */
    forceLock: boolean;
    manifest: ManifestKind;
    /** Raw argv included --mainnet (hard-fail before run). */
    requestedMainnet: boolean;
};
