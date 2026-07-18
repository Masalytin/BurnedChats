import type { CheckResult } from '../types';

export function assertCheck(ok: boolean, message: string): CheckResult {
    return { ok, message };
}

export function allChecksOk(checks: CheckResult[]): boolean {
    return checks.every((c) => c.ok);
}

export function summarizeChecks(checks: CheckResult[]): { passed: number; failed: number } {
    let passed = 0;
    let failed = 0;
    for (const c of checks) {
        if (c.ok) {
            passed += 1;
        } else {
            failed += 1;
        }
    }
    return { passed, failed };
}
