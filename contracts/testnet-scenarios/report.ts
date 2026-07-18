import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report, ScenarioRunResult } from './types';

const SECRET_KEY_PATTERN = /mnemonic|api[_-]?key|secret|private[_-]?key|wallet_mnemonic/i;

function assertNoSecrets(value: unknown, path = 'report'): void {
    if (typeof value === 'string') {
        if (SECRET_KEY_PATTERN.test(value) && value.split(/\s+/).length >= 12) {
            throw new Error(`Refusing to write report: possible secret at ${path}`);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, i) => assertNoSecrets(item, `${path}[${i}]`));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (SECRET_KEY_PATTERN.test(key)) {
                throw new Error(`Refusing to write report: secret field "${key}" at ${path}`);
            }
            assertNoSecrets(child, `${path}.${key}`);
        }
    }
}

function sanitizeFilterLabel(filter: string): string {
    return filter.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'run';
}

export function buildReport(input: {
    network: string;
    master: string;
    fingerprint: string;
    filter: string;
    started: string;
    finished: string;
    scenarios: ScenarioRunResult[];
}): Report {
    return {
        network: input.network,
        master: input.master,
        fingerprint: input.fingerprint,
        filter: input.filter,
        started: input.started,
        finished: input.finished,
        scenarios: input.scenarios,
    };
}

/** Write JSON report under reports/; never writes Markdown. */
export function writeReportJson(reportsDir: string, report: Report): string {
    assertNoSecrets(report);
    mkdirSync(reportsDir, { recursive: true });
    const ts = report.started.replace(/[:.]/g, '-');
    const fileName = `${ts}-${sanitizeFilterLabel(report.filter)}.json`;
    const filePath = join(reportsDir, fileName);
    writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return filePath;
}

export function printStdoutSummary(report: Report, reportPath: string): void {
    const pass = report.scenarios.filter((s) => s.status === 'pass').length;
    const fail = report.scenarios.filter((s) => s.status === 'fail' || s.status === 'error').length;
    const skip = report.scenarios.filter((s) => s.status === 'skip').length;
    console.log('');
    console.log('[testnet-scenarios] summary');
    console.log(`  network=${report.network} master=${report.master}`);
    console.log(`  filter=${report.filter} fingerprint=${report.fingerprint}`);
    console.log(`  pass=${pass} fail=${fail} skip=${skip} total=${report.scenarios.length}`);
    for (const s of report.scenarios) {
        const err = s.error ? ` — ${s.error}` : '';
        console.log(`  [${s.status}] ${s.id} (${s.durationMs}ms)${err}`);
    }
    console.log(`  report=${reportPath}`);
    console.log('  note: single-runner only — concurrent writers of skip-state are unsupported');
}
