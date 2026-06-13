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
 * The result is written as a structured JSON report intended to be consumed by
 * another AI agent that auto-fills the gaps.
 *
 * Usage:
 *   node scripts/i18n/check-i18n.mjs
 *   node scripts/i18n/check-i18n.mjs --out i18n-report.json
 *   node scripts/i18n/check-i18n.mjs --pretty --strict
 *
 * Flags:
 *   --out <path>   Output report path (default: i18n-report.json in repo root)
 *   --pretty       Pretty-print JSON (default: on)
 *   --compact      Minified JSON output
 *   --strict       Exit with code 1 if any missing key or empty value is found
 *   --quiet        Suppress the human-readable console summary
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const FRONTEND_DIR = join(REPO_ROOT, "frontend", "src", "i18n", "locales");
const BACKEND_DIR = join(REPO_ROOT, "backend", "src", "main", "resources", "i18n");

/**
 * Language code aliasing across platforms.
 * Frontend uses BCP-47-ish codes (e.g. "zh-CN"), backend uses Spring suffixes (e.g. "zh").
 * The map normalizes both sides to a single canonical code for cross-platform comparison.
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

/**
 * i18next / CLDR plural-category suffixes. Different languages use different
 * categories (English: one/other; Russian/Ukrainian: one/few/many/other), so a
 * per-category key must NOT be reported as "missing" in a language whose plural
 * rules don't use that category. Keys are grouped into a base "family" instead.
 */
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

const OUT_PATH = join(REPO_ROOT, flagValue("--out", "i18n-report.json"));
const PRETTY = !args.includes("--compact");
const STRICT = args.includes("--strict");
const QUIET = args.includes("--quiet");
const NO_PLURAL_GROUPING = args.includes("--no-plural-grouping");

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
  // numbers / booleans are considered non-empty leaves
  return false;
}

function sortedUnique(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
}

/**
 * Reduce a concrete key to its logical "family":
 *   - a plural-category key (e.g. "x.count_few") -> { family: "x.count", isPlural: true }
 *   - any other key                              -> { family: key,       isPlural: false }
 * When plural grouping is disabled, every key is its own family.
 */
function keyFamily(key) {
  if (!NO_PLURAL_GROUPING && PLURAL_SUFFIX_RE.test(key)) {
    return { family: key.replace(PLURAL_SUFFIX_RE, ""), isPlural: true };
  }
  return { family: key, isPlural: false };
}

/**
 * Flatten a nested JSON object into a flat map of dot-delimited keys -> leaf value.
 * Arrays are indexed (key.0, key.1, ...).
 */
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
  // leaf
  out.set(prefix, obj);
  return out;
}

/**
 * Parse a Java .properties file into a Map of key -> value.
 * Handles:
 *   - comment lines (# or !)
 *   - separators '=', ':', or whitespace
 *   - line continuations (trailing odd number of backslashes)
 *   - leading whitespace trimming
 * Unicode escapes (\\uXXXX) inside values are left as-is; only emptiness matters for values.
 */
function parseProperties(content) {
  const map = new Map();
  const rawLines = content.split(/\r?\n/);

  // Merge physical lines into logical lines via backslash continuation.
  const logicalLines = [];
  let buffer = "";
  for (let line of rawLines) {
    if (buffer === "") {
      // strip leading whitespace only for fresh logical lines
      line = line.replace(/^\s+/, "");
      // skip standalone comment/blank lines (only when not continuing)
      if (line === "" || line.startsWith("#") || line.startsWith("!")) {
        continue;
      }
    }
    const combined = buffer + line;
    const trailingBackslashes = (combined.match(/\\*$/)?.[0] ?? "").length;
    if (trailingBackslashes % 2 === 1) {
      // continuation: drop the final backslash, trim leading ws of next physical line later
      buffer = combined.slice(0, -1);
    } else {
      logicalLines.push(combined);
      buffer = "";
    }
  }
  if (buffer !== "") logicalLines.push(buffer);

  for (const logical of logicalLines) {
    const { key, value } = splitPropertyLine(logical);
    if (key !== null && key.length > 0) {
      map.set(key, value);
    }
  }
  return map;
}

/** Split a single logical properties line into key/value at the first unescaped separator. */
function splitPropertyLine(line) {
  let key = "";
  let i = 0;
  // accumulate key until first unescaped '=', ':' or whitespace
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      key += line[i + 1] ?? "";
      i++;
      continue;
    }
    if (ch === "=" || ch === ":" || ch === " " || ch === "\t" || ch === "\f") {
      break;
    }
    key += ch;
  }
  // skip whitespace, then a single '=' or ':' separator, then trailing whitespace
  while (i < line.length && /[ \t\f]/.test(line[i])) i++;
  if (i < line.length && (line[i] === "=" || line[i] === ":")) {
    i++;
    while (i < line.length && /[ \t\f]/.test(line[i])) i++;
  }
  const value = line.slice(i);
  return { key: key.trim(), value };
}

// --------------------------------------------------------------------------
// Loaders
// --------------------------------------------------------------------------

/**
 * @returns {{ langs: Record<string, Map<string,unknown>>, files: Record<string,string>, errors: string[] }}
 *   langs keyed by canonical language code -> flat key/value map
 */
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

/**
 * @returns same shape as loadFrontend()
 */
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

/**
 * Analyze one platform: build a plural-aware reference of key families, then per
 * language compute missing families and empty values.
 *
 * Missing detection works at the family level so a language is never flagged for
 * lacking a plural category (e.g. "_few") it legitimately doesn't use. A family is
 * reported missing only when the language has no concrete key for that family.
 */
function analyzePlatform(platform) {
  const { langs } = platform;
  const languageCodes = Object.keys(langs).sort();

  // Every concrete key seen anywhere (informational) and every logical family.
  const referenceKeys = new Set();
  const referenceFamilies = new Set();
  const pluralFamilies = new Set();

  // Per-language set of families the language actually has at least one key for.
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
    _referenceKeys: referenceKeys, // internal, stripped before serialization
  };
}

/**
 * Cross-platform check: which keys are shared by both platforms (same logical name),
 * and per shared language, where one side is missing the key.
 */
function analyzeCrossPlatform(frontend, backend) {
  const feKeys = frontend._referenceKeys;
  const beKeys = backend._referenceKeys;

  const shared_keys = sortedUnique([...feKeys].filter((k) => beKeys.has(k)));

  const feLangs = new Set(frontend.languages);
  const beLangs = new Set(backend.languages.filter((l) => l !== BACKEND_DEFAULT_LANG));
  const commonLangs = sortedUnique([...feLangs].filter((l) => beLangs.has(l)));

  // For shared keys, report per-language presence gaps between the platforms.
  const mismatches = {};
  for (const lang of commonLangs) {
    const fe = frontend && frontendHasLang(frontend, lang);
    const be = backend && backendHasLang(backend, lang);
    const onlyFrontend = [];
    const onlyBackend = [];
    for (const key of shared_keys) {
      const inFe = fe?.has(key) && !isEmptyValue(fe.get(key));
      const inBe = be?.has(key) && !isEmptyValue(be.get(key));
      if (inFe && !inBe) onlyBackend.push(key); // missing on backend side
      else if (!inFe && inBe) onlyFrontend.push(key); // missing on frontend side
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

function frontendHasLang(platform, lang) {
  return platform.__langsRef?.[lang];
}
function backendHasLang(platform, lang) {
  return platform.__langsRef?.[lang];
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function main() {
  const feRaw = loadFrontend();
  const beRaw = loadBackend();

  const frontend = analyzePlatform(feRaw);
  const backend = analyzePlatform(beRaw);
  // attach language maps for cross-platform value lookups
  frontend.__langsRef = feRaw.langs;
  backend.__langsRef = beRaw.langs;

  const cross_platform = analyzeCrossPlatform(frontend, backend);

  const report = {
    generated_at: new Date().toISOString(),
    summary: buildSummary(frontend, backend, cross_platform, feRaw, beRaw),
    frontend: stripInternal(frontend),
    backend: stripInternal(backend),
    cross_platform,
    parse_errors: {
      frontend: feRaw.errors,
      backend: beRaw.errors,
    },
  };

  const json = JSON.stringify(report, null, PRETTY ? 2 : 0);
  writeFileSync(OUT_PATH, json + (PRETTY ? "\n" : ""), "utf8");

  if (!QUIET) printSummary(report, OUT_PATH);

  const hasIssues =
    report.summary.total_missing_keys > 0 ||
    report.summary.total_empty_values > 0 ||
    feRaw.errors.length > 0 ||
    beRaw.errors.length > 0;

  if (STRICT && hasIssues) process.exit(1);
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

function printSummary(report, outPath) {
  const s = report.summary;
  const line = (label, val) => console.log(`  ${label.padEnd(28)} ${val}`);
  console.log("\ni18n integrity report");
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
      const miss = platform.missing_keys[lang].length;
      const emp = platform.empty_values[lang].length;
      if (miss || emp) {
        console.log(`  ${platformName}/${lang}: ${miss} missing, ${emp} empty`);
      }
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

main();
