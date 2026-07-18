import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Report, ScenarioRunResult } from './types';

const SECRET_KEY_PATTERN =
    /(mnemonic|seed|private[_-]?key|secret|api[_-]?key|password|passphrase|wallet_mnemonic)/i;

const SECRET_VALUE_PATTERN =
    /\b([a-z]+\s+){11}[a-z]+\b/i; // 12-word mnemonic shape (heuristic)

export function assertReportHasNoSecrets(value: unknown, path = 'report'): void {
    if (value === null || value === undefined) {
        return;
    }
    if (typeof value === 'string') {
        if (SECRET_VALUE_PATTERN.test(value)) {
            throw new Error(`Report must not contain secrets (suspicious string at ${path})`);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => assertReportHasNoSecrets(v, `${path}[${i}]`));
        return;
    }
    if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (SECRET_KEY_PATTERN.test(k)) {
                throw new Error(`Report must not contain secrets (forbidden key "${k}" at ${path})`);
            }
            assertReportHasNoSecrets(v, `${path}.${k}`);
        }
    }
}

export function validateReportSchema(report: Report): void {
    if (report.network !== 'testnet') {
        throw new Error('Report.network must be "testnet"');
    }
    if (!report.fingerprint || typeof report.fingerprint !== 'string') {
        throw new Error('Report.fingerprint required');
    }
    if (!report.filter || typeof report.filter !== 'string') {
        throw new Error('Report.filter required');
    }
    if (!report.started || !report.finished) {
        throw new Error('Report.started/finished required');
    }
    if (!Array.isArray(report.scenarios)) {
        throw new Error('Report.scenarios must be an array');
    }
    for (const s of report.scenarios) {
        if (!s.id || !s.status || typeof s.durationMs !== 'number' || !Array.isArray(s.checks)) {
            throw new Error(`Invalid scenario result for ${s.id ?? '?'}`);
        }
    }
    assertReportHasNoSecrets(report);
}

export function defaultReportsDir(contractsRoot: string): string {
    return resolve(contractsRoot, 'reports');
}

export function buildReportFileName(startedIso: string, filter: string): string {
    const ts = startedIso.replace(/[:.]/g, '-');
    const safeFilter = filter.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    return `${ts}-${safeFilter || 'run'}.json`;
}

export function writeReportJson(reportsDir: string, report: Report): string {
    validateReportSchema(report);
    mkdirSync(reportsDir, { recursive: true });
    const filePath = resolve(reportsDir, buildReportFileName(report.started, report.filter));
    writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return filePath;
}

function statusIcon(status: ScenarioRunResult['status']): string {
    switch (status) {
        case 'pass':
            return 'PASS';
        case 'fail':
            return 'FAIL';
        case 'skipped':
            return 'SKIP';
        case 'na':
            return 'N/A';
        default:
            return status;
    }
}

/** Human stdout summary (no MD file). */
export function formatStdoutSummary(report: Report, reportPath?: string): string {
    const lines: string[] = [];
    lines.push(`network=${report.network} manifest=${report.manifestKind} filter=${report.filter}`);
    lines.push(`fingerprint=${report.fingerprint.slice(0, 16)}…`);
    lines.push(`started=${report.started} finished=${report.finished}`);
    lines.push('');
    for (const s of report.scenarios) {
        const extra = s.naReason ?? s.skippedReason ?? s.error ?? '';
        const suffix = extra ? ` — ${extra}` : '';
        lines.push(`  [${statusIcon(s.status)}] ${s.id} (${s.durationMs}ms)${suffix}`);
        for (const c of s.checks) {
            lines.push(`      ${c.ok ? '✓' : '✗'} ${c.name}: ${c.message}`);
        }
    }
    const counts = report.scenarios.reduce(
        (acc, s) => {
            acc[s.status] = (acc[s.status] ?? 0) + 1;
            return acc;
        },
        {} as Record<string, number>,
    );
    lines.push('');
    lines.push(
        `summary: pass=${counts.pass ?? 0} fail=${counts.fail ?? 0} skipped=${counts.skipped ?? 0} na=${counts.na ?? 0}`,
    );
    if (reportPath) {
        lines.push(`report: ${reportPath}`);
    }
    return lines.join('\n');
}
