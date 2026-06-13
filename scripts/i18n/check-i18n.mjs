#!/usr/bin/env node
/**
 * i18n integrity checker for Burned Chats.
 *
 * Scans frontend (nested JSON) and backend (flat .properties) translation files,
 * builds a per-language key snapshot for each platform, and reports:
 *   - missing_keys : keys present in the platform's reference set but absent in a language
 *   - empty_values : keys present in a language but whose value is empty / whitespace-only
 *   - cross_platform: keys shared between frontend and backend (same logical name) and
 *                     any per-language gaps between the two platforms
 *
 * Full report — audit / CI. Compact task report — small JSON for AI agents.
 *
 * Usage:
 *   node scripts/i18n/check-i18n.mjs
 *   node scripts/i18n/check-i18n.mjs --out reports/i18n-full.json
 *   node scripts/i18n/check-i18n.mjs --summary-only --out reports/i18n-summary.json
 *
 * Compact task for one agent batch:
 *   node scripts/i18n/check-i18n.mjs --task --platform frontend --lang ru --limit 20 \
 *     --out reports/i18n-task-frontend-ru.json
 *
 * Emit task files for every language with gaps:
 *   node scripts/i18n/check-i18n.mjs --emit-tasks --langs en,ru --limit 20 \
 *     --task-dir reports/i18n-tasks
 *
 * Flags:
 *   --out <path>        Output path (default: i18n-report.json in repo root)
 *   --task              Write compact agent task JSON instead of full report
 *   --emit-tasks        Write one compact task file per platform/language with gaps
 *   --task-dir <path>   Directory for --emit-tasks (default: reports/i18n-tasks)
 *   --platform <name>   frontend | backend (required with --task)
 *   --lang <code>       Target language for --task (e.g. ru, en, default)
 *   --langs <a,b,c>     Filter languages for --emit-tasks or --summary-only stats
 *   --limit <n>         Max keys per task batch (default: 20)
 *   --prefix <dot.path> Only include keys whose family/path starts with this prefix
 *   --summary-only      Full report without key arrays — counts only (small context)
 *   --pretty            Pretty-print JSON (default: on)
 *   --compact           Minified JSON output
 *   --strict            Exit with code 1 if any missing key or empty value is found
 *   --quiet             Suppress the human-readable console summary
 *   --no-plural-grouping  Disable plural-family grouping (debug)
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { join, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const FRONTEND_DIR = join(REPO_ROOT, "frontend", "src", "i18n", "locales");
const BACKEND_DIR = join(REPO_ROOT, "backend", "src", "main", "resources", "i18n");

const FRONTEND_SOURCE = "frontend/src/i18n/locales/en.json";
const BACKEND_SOURCE = "backend/src/main/resources/i18n/messages.properties";

/** Default language priority when auto-picking batches for agents. */
const LANG_PRIORITY = ["en", "ru", "uk", "de", "fr", "es", "ar", "zh", "default"];

/**
 * Language code aliasing across platforms.
 * Frontend uses BCP-47-ish codes (e.g. "zh-CN"), backend uses Spring suffixes (e.g. "zh").
 */
const LANG_ALIASES = {
  "zh-cn": "zh",
  "zh-hans": "zh",
  "pt-br": "pt",
  "en-us": "en",
  "en-gb": "en",
};

/** Backend default bundle (messages.properties) is treated as this pseudo-language. */
const BACKEND_DEFAULT_LANG = "default";

const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other|plural)$/;

// --------------------------------------------------------------------------
// CLI args
// --------------------------------------------------------------------------

const args = process.argv.slice(2);

function flagValue(name, fallback) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

function parseLangList(raw) {
  if (!raw) return null;
  return sortedUnique(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(canonicalLang),
  );
}

const OUT_PATH = join(REPO_ROOT, flagValue("--out", "i18n-report.json"));
const TASK_DIR = join(REPO_ROOT, flagValue("--task-dir", "reports/i18n-tasks"));
const PRETTY = !args.includes("--compact");
const STRICT = args.includes("--strict");
const QUIET = args.includes("--quiet");
const NO_PLURAL_GROUPING = args.includes("--no-plural-grouping");
const TASK_MODE = args.includes("--task");
const EMIT_TASKS = args.includes("--emit-tasks");
const SUMMARY_ONLY = args.includes("--summary-only");
const PLATFORM = flagValue("--platform", null);
const TASK_LANG = flagValue("--lang", null);
const LANG_FILTER = parseLangList(flagValue("--langs", null));
const KEY_PREFIX = flagValue("--prefix", null);
const TASK_LIMIT = Math.max(1, parseInt(flagValue("--limit", "20"), 10) || 20);

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function canonicalLang(lang) {
  const lower = String(lang).toLowerCase();
  return LANG_ALIASES[lower] ?? lower;
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

function sortedUnique(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
}

function sortLangs(langs) {
  return [...langs].sort((a, b) => {
    const ai = LANG_PRIORITY.indexOf(a);
    const bi = LANG_PRIORITY.indexOf(b);
    const ar = ai === -1 ? 999 : ai;
    const br = bi === -1 ? 999 : bi;
    if (ar !== br) return ar - br;
    return a.localeCompare(b);
  });
}

function keyFamily(key) {
  if (!NO_PLURAL_GROUPING && PLURAL_SUFFIX_RE.test(key)) {
    return { family: key.replace(PLURAL_SUFFIX_RE, ""), isPlural: true };
  }
  return { family: key, isPlural: false };
}

function matchesPrefix(key, prefix) {
  if (!prefix) return true;
  return key === prefix || key.startsWith(`${prefix}.`);
}

function flattenJson(obj, prefix = "", out = new Map()) {
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => flattenJson(item, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  if (obj !== null && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  out.set(prefix, obj);
  return out;
}

function parseProperties(content) {
  const map = new Map();
  const rawLines = content.split(/\r?\n/);
  const logicalLines = [];
  let buffer = "";
  for (let line of rawLines) {
    if (buffer === "") {
      line = line.replace(/^\s+/, "");
      if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    }
    const combined = buffer + line;
    const trailingBackslashes = (combined.match(/\\*$/)?.[0] ?? "").length;
    if (trailingBackslashes % 2 === 1) {
      buffer = combined.slice(0, -1);
    } else {
      logicalLines.push(combined);
      buffer = "";
    }
  }
  if (buffer !== "") logicalLines.push(buffer);

  for (const logical of logicalLines) {
    const { key, value } = splitPropertyLine(logical);
    if (key !== null && key.length > 0) map.set(key, value);
  }
  return map;
}

function splitPropertyLine(line) {
  let key = "";
  let i = 0;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      key += line[i + 1] ?? "";
      i++;
      continue;
    }
    if (ch === "=" || ch === ":" || ch === " " || ch === "\t" || ch === "\f") break;
    key += ch;
  }
  while (i < line.length && /[ \t\f]/.test(line[i])) i++;
  if (i < line.length && (line[i] === "=" || line[i] === ":")) {
    i++;
    while (i < line.length && /[ \t\f]/.test(line[i])) i++;
  }
  return { key: key.trim(), value: line.slice(i) };
}

function writeJson(path, data) {
  const json = JSON.stringify(data, null, PRETTY ? 2 : 0);
  writeFileSync(path, json + (PRETTY ? "\n" : ""), "utf8");
}

function platformTargetPath(platform, lang, files) {
  if (platform === "frontend") {
    const file = files[lang] ?? `${lang}.json`;
    return `frontend/src/i18n/locales/${file}`;
  }
  if (lang === BACKEND_DEFAULT_LANG) {
    return "backend/src/main/resources/i18n/messages.properties";
  }
  const file = files[lang] ?? `messages_${lang}.properties`;
  return `backend/src/main/resources/i18n/${file}`;
}

function platformSourcePath(platform) {
  return platform === "frontend" ? FRONTEND_SOURCE : BACKEND_SOURCE;
}

// --------------------------------------------------------------------------
// Loaders
// --------------------------------------------------------------------------

function loadFrontend() {
  const langs = {};
  const files = {};
  const errors = [];
  if (!existsSync(FRONTEND_DIR)) {
    errors.push(`Frontend i18n dir not found: ${FRONTEND_DIR}`);
    return { langs, files, errors };
  }
  for (const file of readdirSync(FRONTEND_DIR)) {
    if (!file.endsWith(".json")) continue;
    const lang = canonicalLang(basename(file, ".json"));
    const full = join(FRONTEND_DIR, file);
    try {
      const json = JSON.parse(readFileSync(full, "utf8"));
      langs[lang] = flattenJson(json);
      files[lang] = file;
    } catch (e) {
      errors.push(`Failed to parse ${file}: ${e.message}`);
    }
  }
  return { langs, files, errors };
}

function loadBackend() {
  const langs = {};
  const files = {};
  const errors = [];
  if (!existsSync(BACKEND_DIR)) {
    errors.push(`Backend i18n dir not found: ${BACKEND_DIR}`);
    return { langs, files, errors };
  }
  for (const file of readdirSync(BACKEND_DIR)) {
    const m = file.match(/^messages(?:_([A-Za-z0-9-]+))?\.properties$/);
    if (!m) continue;
    const lang = m[1] ? canonicalLang(m[1]) : BACKEND_DEFAULT_LANG;
    const full = join(BACKEND_DIR, file);
    try {
      langs[lang] = parseProperties(readFileSync(full, "utf8"));
      files[lang] = file;
    } catch (e) {
      errors.push(`Failed to parse ${file}: ${e.message}`);
    }
  }
  return { langs, files, errors };
}

// --------------------------------------------------------------------------
// Analysis
// --------------------------------------------------------------------------

function analyzePlatform(platform) {
  const { langs } = platform;
  const languageCodes = Object.keys(langs).sort();
  const referenceKeys = new Set();
  const referenceFamilies = new Set();
  const pluralFamilies = new Set();
  const langFamilies = {};

  for (const lang of languageCodes) {
    const present = new Set();
    for (const key of langs[lang].keys()) {
      referenceKeys.add(key);
      const { family, isPlural } = keyFamily(key);
      referenceFamilies.add(family);
      if (isPlural) pluralFamilies.add(family);
      present.add(family);
    }
    langFamilies[lang] = present;
  }

  const missing_keys = {};
  const empty_values = {};
  const stats = {};

  for (const lang of languageCodes) {
    const keyMap = langs[lang];
    const have = langFamilies[lang];
    const missing = [];
    for (const family of referenceFamilies) {
      if (!have.has(family)) missing.push(family);
    }
    const empty = [];
    for (const [key, value] of keyMap.entries()) {
      if (isEmptyValue(value)) empty.push(key);
    }
    missing_keys[lang] = sortedUnique(missing);
    empty_values[lang] = sortedUnique(empty);
    stats[lang] = {
      total_keys: keyMap.size,
      missing_count: missing_keys[lang].length,
      empty_count: empty_values[lang].length,
    };
  }

  return {
    languages: languageCodes,
    files: platform.files,
    reference_key_count: referenceKeys.size,
    reference_family_count: referenceFamilies.size,
    plural_families: sortedUnique([...pluralFamilies]),
    missing_keys,
    empty_values,
    stats,
    _referenceKeys: referenceKeys,
  };
}

function analyzeCrossPlatform(frontend, backend) {
  const feKeys = frontend._referenceKeys;
  const beKeys = backend._referenceKeys;
  const shared_keys = sortedUnique([...feKeys].filter((k) => beKeys.has(k)));
  const feLangs = new Set(frontend.languages);
  const beLangs = new Set(backend.languages.filter((l) => l !== BACKEND_DEFAULT_LANG));
  const commonLangs = sortedUnique([...feLangs].filter((l) => beLangs.has(l)));

  const mismatches = {};
  for (const lang of commonLangs) {
    const fe = frontend.__langsRef?.[lang];
    const be = backend.__langsRef?.[lang];
    const onlyFrontend = [];
    const onlyBackend = [];
    for (const key of shared_keys) {
      const inFe = fe?.has(key) && !isEmptyValue(fe.get(key));
      const inBe = be?.has(key) && !isEmptyValue(be.get(key));
      if (inFe && !inBe) onlyBackend.push(key);
      else if (!inFe && inBe) onlyFrontend.push(key);
    }
    mismatches[lang] = {
      missing_on_frontend: sortedUnique(onlyFrontend),
      missing_on_backend: sortedUnique(onlyBackend),
    };
  }

  return {
    shared_languages: commonLangs,
    shared_key_count: shared_keys.length,
    shared_keys,
    mismatches,
  };
}

function stripInternal(platform) {
  const { _referenceKeys, __langsRef, ...rest } = platform;
  return rest;
}

function buildSummary(frontend, backend, cross, feRaw, beRaw) {
  const sumPlatform = (p) => {
    let missing = 0;
    let empty = 0;
    for (const lang of p.languages) {
      missing += p.missing_keys[lang].length;
      empty += p.empty_values[lang].length;
    }
    return { missing, empty };
  };
  const fe = sumPlatform(frontend);
  const be = sumPlatform(backend);
  return {
    frontend_languages: frontend.languages,
    backend_languages: backend.languages,
    frontend_reference_keys: frontend.reference_key_count,
    backend_reference_keys: backend.reference_key_count,
    total_missing_keys: fe.missing + be.missing,
    total_empty_values: fe.empty + be.empty,
    shared_keys: cross.shared_key_count,
    parse_errors: feRaw.errors.length + beRaw.errors.length,
  };
}

function buildReport() {
  const feRaw = loadFrontend();
  const beRaw = loadBackend();
  const frontend = analyzePlatform(feRaw);
  const backend = analyzePlatform(beRaw);
  frontend.__langsRef = feRaw.langs;
  backend.__langsRef = beRaw.langs;
  const cross_platform = analyzeCrossPlatform(frontend, backend);

  return {
    generated_at: new Date().toISOString(),
    summary: buildSummary(frontend, backend, cross_platform, feRaw, beRaw),
    frontend: stripInternal(frontend),
    backend: stripInternal(backend),
    cross_platform,
    parse_errors: { frontend: feRaw.errors, backend: beRaw.errors },
  };
}

// --------------------------------------------------------------------------
// Compact task reports (for AI agents)
// --------------------------------------------------------------------------

function filterKeys(keys, prefix) {
  if (!prefix) return keys;
  return keys.filter((k) => matchesPrefix(k, prefix));
}

/**
 * Pick up to `limit` keys for one agent batch.
 * Priority: empty_values first (quick wins), then missing_keys alphabetically.
 */
function pickBatchKeys(emptyAll, missingAll, limit, prefix) {
  const empty = filterKeys(emptyAll, prefix);
  const missing = filterKeys(missingAll, prefix);

  const batchEmpty = empty.slice(0, limit);
  const remaining = limit - batchEmpty.length;
  const batchMissing = remaining > 0 ? missing.slice(0, remaining) : [];

  return {
    empty_values: batchEmpty,
    missing_keys: batchMissing,
    totals: {
      empty: empty.length,
      missing: missing.length,
    },
    truncated: batchEmpty.length + batchMissing.length < empty.length + missing.length,
    remaining: {
      empty: Math.max(0, empty.length - batchEmpty.length),
      missing: Math.max(0, missing.length - batchMissing.length),
    },
  };
}

function pluralFamiliesInBatch(keys, pluralFamilies) {
  const pluralSet = new Set(pluralFamilies);
  return sortedUnique(keys.filter((k) => pluralSet.has(k)));
}

function buildTaskReport(report, platformName, lang, options = {}) {
  const { limit = TASK_LIMIT, prefix = KEY_PREFIX } = options;
  const platform = report[platformName];
  if (!platform) throw new Error(`Unknown platform: ${platformName}`);

  const langCode = canonicalLang(lang);
  if (!platform.languages.includes(langCode)) {
    throw new Error(
      `Language "${langCode}" not found in ${platformName}. Available: ${platform.languages.join(", ")}`,
    );
  }

  const batch = pickBatchKeys(
    platform.empty_values[langCode] ?? [],
    platform.missing_keys[langCode] ?? [],
    limit,
    prefix,
  );

  const allBatchKeys = [...batch.empty_values, ...batch.missing_keys];

  return {
    task: "fill-i18n",
    generated_at: report.generated_at,
    platform: platformName,
    language: langCode,
    source: platformSourcePath(platformName),
    target: platformTargetPath(platformName, langCode, platform.files),
    limit,
    prefix: prefix ?? null,
    truncated: batch.truncated,
    remaining: batch.remaining,
    totals: batch.totals,
    missing_keys: batch.missing_keys,
    empty_values: batch.empty_values,
    plural_families: pluralFamiliesInBatch(allBatchKeys, platform.plural_families),
    agent_notes: [
      "Fill empty_values first, then missing_keys.",
      "Use source file as reference text; preserve {{placeholders}} and HTML tags.",
      "For plural_families, add only plural categories valid for the target language (i18next).",
      "After edits run: node scripts/i18n/check-i18n.mjs --task --platform ... --lang ...",
    ],
    parse_errors: report.parse_errors[platformName] ?? [],
  };
}

function langsWithGaps(platform, langFilter) {
  const langs = sortLangs(platform.languages).filter((lang) => {
    if (langFilter && !langFilter.includes(lang)) return false;
    const miss = platform.missing_keys[lang]?.length ?? 0;
    const empty = platform.empty_values[lang]?.length ?? 0;
    return miss > 0 || empty > 0;
  });
  return langs;
}

function shrinkFullReport(report, langFilter) {
  if (!SUMMARY_ONLY && !langFilter) return report;

  const shrinkPlatform = (platform) => {
    const langs = langFilter
      ? platform.languages.filter((l) => langFilter.includes(l))
      : platform.languages;

    const missing_keys = {};
    const empty_values = {};
    const stats = {};
    for (const lang of langs) {
      stats[lang] = platform.stats[lang];
      if (!SUMMARY_ONLY) {
        missing_keys[lang] = platform.missing_keys[lang];
        empty_values[lang] = platform.empty_values[lang];
      }
    }

    return {
      languages: langs,
      files: Object.fromEntries(langs.map((l) => [l, platform.files[l]])),
      reference_key_count: platform.reference_key_count,
      reference_family_count: platform.reference_family_count,
      ...(SUMMARY_ONLY ? {} : { plural_families: platform.plural_families }),
      ...(SUMMARY_ONLY ? {} : { missing_keys, empty_values }),
      stats,
    };
  };

  return {
    ...report,
    mode: SUMMARY_ONLY ? "summary-only" : "filtered",
    ...(langFilter ? { lang_filter: langFilter } : {}),
    frontend: shrinkPlatform(report.frontend),
    backend: shrinkPlatform(report.backend),
  };
}

// --------------------------------------------------------------------------
// Output / console
// --------------------------------------------------------------------------

function printSummary(report, outPath, extra = "") {
  const s = report.summary;
  const line = (label, val) => console.log(`  ${label.padEnd(28)} ${val}`);
  console.log("\ni18n integrity report");
  if (extra) console.log(extra);
  console.log("─".repeat(48));
  line("Frontend languages:", s.frontend_languages.join(", "));
  line("Backend languages:", s.backend_languages.join(", "));
  line("Frontend ref. keys:", s.frontend_reference_keys);
  line("Backend ref. keys:", s.backend_reference_keys);
  line("Total missing keys:", s.total_missing_keys);
  line("Total empty values:", s.total_empty_values);
  line("Shared keys (cross):", s.shared_keys);
  line("Parse errors:", s.parse_errors);

  const detail = (platformName, platform) => {
    for (const lang of platform.languages) {
      const miss = platform.missing_keys[lang]?.length ?? platform.stats[lang]?.missing_count ?? 0;
      const emp = platform.empty_values[lang]?.length ?? platform.stats[lang]?.empty_count ?? 0;
      if (miss || emp) console.log(`  ${platformName}/${lang}: ${miss} missing, ${emp} empty`);
    }
  };
  console.log("─".repeat(48));
  detail("frontend", report.frontend);
  detail("backend", report.backend);
  console.log("─".repeat(48));
  console.log(`Report written to: ${outPath}`);
  if (s.total_missing_keys === 0 && s.total_empty_values === 0 && s.parse_errors === 0) {
    console.log("All translation sets are consistent.");
  }
  console.log("");
}

function printTaskSummary(task, outPath) {
  console.log("\ni18n agent task");
  console.log("─".repeat(48));
  console.log(`  Platform:                   ${task.platform}`);
  console.log(`  Language:                   ${task.language}`);
  console.log(`  Target:                     ${task.target}`);
  console.log(`  Batch missing:              ${task.missing_keys.length} / ${task.totals.missing}`);
  console.log(`  Batch empty:                ${task.empty_values.length} / ${task.totals.empty}`);
  console.log(`  Truncated:                  ${task.truncated ? "yes (run again for next batch)" : "no"}`);
  if (task.prefix) console.log(`  Prefix filter:              ${task.prefix}`);
  console.log("─".repeat(48));
  console.log(`Task written to: ${outPath}`);
  console.log("");
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function validateTaskArgs() {
  if (!PLATFORM || !["frontend", "backend"].includes(PLATFORM)) {
    console.error("Error: --task requires --platform frontend|backend");
    process.exit(2);
  }
  if (!TASK_LANG) {
    console.error("Error: --task requires --lang <code> (e.g. ru, en, default)");
    process.exit(2);
  }
}

function runTaskMode(report) {
  validateTaskArgs();
  const task = buildTaskReport(report, PLATFORM, TASK_LANG, {
    limit: TASK_LIMIT,
    prefix: KEY_PREFIX,
  });
  writeJson(OUT_PATH, task);
  if (!QUIET) printTaskSummary(task, OUT_PATH);

  const hasBatchWork =
    task.missing_keys.length > 0 ||
    task.empty_values.length > 0 ||
    task.parse_errors.length > 0;
  if (STRICT && hasBatchWork) process.exit(1);
}

function runEmitTasksMode(report) {
  mkdirSync(TASK_DIR, { recursive: true });
  const written = [];

  for (const platformName of ["frontend", "backend"]) {
    const platform = report[platformName];
    for (const lang of langsWithGaps(platform, LANG_FILTER)) {
      const task = buildTaskReport(report, platformName, lang, {
        limit: TASK_LIMIT,
        prefix: KEY_PREFIX,
      });
      if (task.missing_keys.length === 0 && task.empty_values.length === 0) continue;

      const suffix = KEY_PREFIX ? `-${KEY_PREFIX.replace(/\./g, "-")}` : "";
      const fileName = `${platformName}-${lang}${suffix}.json`;
      const filePath = join(TASK_DIR, fileName);
      writeJson(filePath, task);
      written.push(relative(REPO_ROOT, filePath));
    }
  }

  if (!QUIET) {
    console.log("\ni18n agent tasks emitted");
    console.log("─".repeat(48));
    console.log(`  Directory:                  ${relative(REPO_ROOT, TASK_DIR)}`);
    console.log(`  Limit per task:             ${TASK_LIMIT}`);
    console.log(`  Lang filter:                ${LANG_FILTER?.join(", ") ?? "all with gaps"}`);
    console.log(`  Files written:              ${written.length}`);
    for (const f of written) console.log(`    ${f}`);
    console.log("─".repeat(48));
    if (written.length === 0) console.log("No gaps found for selected languages.");
    console.log("");
  }

  if (STRICT && written.length > 0) process.exit(1);
}

function main() {
  const report = buildReport();

  if (TASK_MODE) {
    runTaskMode(report);
    return;
  }

  if (EMIT_TASKS) {
    runEmitTasksMode(report);
    return;
  }

  const output = shrinkFullReport(report, LANG_FILTER);
  writeJson(OUT_PATH, output);

  if (!QUIET) {
    const modeNote = SUMMARY_ONLY
      ? "(summary-only — no key arrays)"
      : LANG_FILTER
        ? `(filtered langs: ${LANG_FILTER.join(", ")})`
        : "";
    printSummary(output, OUT_PATH, modeNote);
  }

  const hasIssues =
    report.summary.total_missing_keys > 0 ||
    report.summary.total_empty_values > 0 ||
    report.parse_errors.frontend.length > 0 ||
    report.parse_errors.backend.length > 0;

  if (STRICT && hasIssues) process.exit(1);
}

main();
