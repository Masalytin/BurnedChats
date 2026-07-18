import type { CheckResult } from '../types';

export function check(name: string, ok: boolean, message: string): CheckResult {
    return { ok, name, message };
}

export function allChecksPass(checks: CheckResult[]): boolean {
    return checks.length > 0 && checks.every((c) => c.ok);
}

export function failedChecks(checks: CheckResult[]): CheckResult[] {
    return checks.filter((c) => !c.ok);
}
