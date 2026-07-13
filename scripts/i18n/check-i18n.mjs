#!/usr/bin/env node
/**
 * i18n integrity checker for Burned Chats.
 *
 * Compares each locale against a **reference locale** (default: frontend `en`,
 * backend `default` / messages.properties). Also reports empty values, extra
 * keys not in the reference, optional plural-variant gaps, and cross-platform
 * overlaps.
 *
 * Usage:
 *   node scripts/i18n/check-i18n.mjs
 *   node scripts/i18n/check-i18n.mjs --prefix help --strict
 *   node scripts/i18n/check-i18n.mjs --check-help
 *   node scripts/i18n/check-i18n.mjs --out reports/i18n-full.json
 *   node scripts/i18n/check-i18n.mjs --reference union          # legacy union mode
 *   node scripts/i18n/check-i18n.mjs --task --platform frontend --lang zh-CN --limit 20
 *   node scripts/i18n/check-i18n.mjs --emit-tasks --langs en,ru --task-dir reports/i18n-tasks
 *
 * Exit codes: 0 = ok, 1 = gaps (--strict) or emit-tasks with work, 2 = usage error
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { join, basename, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const FRONTEND_DIR = join(REPO_ROOT, "frontend", "src", "i18n", "locales");
const BACKEND_DIR = join(REPO_ROOT, "backend", "src", "main", "resources", "i18n");

const FRONTEND_SOURCE = "frontend/src/i18n/locales/en.json";
const BACKEND_SOURCE = "backend/src/main/resources/i18n/messages.properties";

const LANG_PRIORITY = ["en", "ru", "uk", "de", "fr", "es", "ar", "zh", "default"];

const LANG_ALIASES = {
  "zh-cn": "zh",
  "zh-hans": "zh",
  "pt-br": "pt",
  "en-us": "en",
  "en-gb": "en",
};

const BACKEND_DEFAULT_LANG = "default";

const PLATFORM_REFERENCE_DEFAULTS = {
  frontend: "en",
  backend: BACKEND_DEFAULT_LANG,
};

const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other|plural)$/;

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

const args = process.argv.slice(2);

function flagValue(name, fallback) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const CHECK_HELP = hasFlag("--check-help");
const SHOW_HELP = hasFlag("--help") || hasFlag("-h");

const OUT_PATH = join(REPO_ROOT, flagValue("--out", "i18n-report.json"));
const TASK_DIR = join(REPO_ROOT, flagValue("--task-dir", "reports/i18n-tasks"));
const PRETTY = !hasFlag("--compact");
const STRICT = hasFlag("--strict") || CHECK_HELP;
const STRICT_PLURALS = hasFlag("--strict-plurals");
const QUIET = hasFlag("--quiet");
const NO_PLURAL_GROUPING = hasFlag("--no-plural-grouping");
const TASK_MODE = hasFlag("--task");
const EMIT_TASKS = hasFlag("--emit-tasks");
const SUMMARY_ONLY = hasFlag("--summary-only");
const SKIP_CROSS = hasFlag("--skip-cross");
const PLATFORM = flagValue("--platform", null);
const TASK_LANG = flagValue("--lang", null);
const KEY_PREFIX = CHECK_HELP ? "help" : flagValue("--prefix", null);
const TASK_LIMIT = Math.max(1, parseInt(flagValue("--limit", "20"), 10) || 20);

const REFERENCE_RAW = flagValue("--reference", null);
const REFERENCE_MODE = REFERENCE_RAW === "union" ? "union" : "locale";
const REFERENCE_OVERRIDE =
  REFERENCE_RAW && REFERENCE_RAW !== "union" ? canonicalLang(REFERENCE_RAW) : null;

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

const LANG_FILTER = parseLangList(flagValue("--langs", null));

function printHelp() {
  console.log(`i18n integrity checker — Burned Chats

Usage:
  node scripts/i18n/check-i18n.mjs [options]

Common gates:
  node scripts/i18n/check-i18n.mjs --check-help
  node scripts/i18n/check-i18n.mjs --prefix help --strict
  node scripts/i18n/check-i18n.mjs --prefix governance --strict

Full audit:
  node scripts/i18n/check-i18n.mjs --out reports/i18n-full.json
  node scripts/i18n/check-i18n.mjs --summary-only --strict

Translation batches:
  node scripts/i18n/check-i18n.mjs --task --platform frontend --lang zh-CN --limit 20
  node scripts/i18n/check-i18n.mjs --emit-tasks --langs ar,de --task-dir reports/i18n-tasks

Options:
  --out <path>           Output JSON path (creates parent dirs)
  --reference <code>     Reference locale: en, default, zh, … (default per platform)
  --reference union      Legacy: union of all locales as reference set
  --prefix <dot.path>    Scope keys to a namespace (also scopes --strict)
  --strict               Exit 1 on missing/empty gaps (scoped by --prefix)
  --strict-plurals       Also fail on missing exact plural variants from reference
  --check-help           Shorthand: --prefix help --strict
  --summary-only         Counts only, omit key arrays
  --langs <a,b,c>        Filter languages in report / emit-tasks
  --task                 Compact task JSON for one platform/lang
  --emit-tasks           One task file per platform/lang with gaps
  --platform frontend|backend   Required with --task
  --lang <code>          Target locale (accepts zh-CN, default, …)
  --limit <n>            Max keys per task batch (default: 20)
  --task-dir <path>      Output dir for --emit-tasks
  --no-plural-grouping   Compare raw keys instead of plural families
  --skip-cross           Omit cross_platform section when empty
  --compact              Minified JSON
  --quiet                No console summary
  --help, -h             Show this help

Reference defaults: frontend=en.json, backend=messages.properties (default).
`);
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function canonicalLang(lang) {
  const lower = String(lang).toLowerCase();
  return LANG_ALIASES[lower] ?? lower;
}

function resolveLangArg(lang, platform) {
  const canonical = canonicalLang(lang);
  if (platform.languages.includes(canonical)) return canonical;
  const byLabel = Object.entries(platform.lang_codes ?? {}).find(
    ([, label]) => label.toLowerCase() === String(lang).toLowerCase(),
  );
  if (byLabel) return byLabel[0];
  return canonical;
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

function displayLang(platform, canonical) {
  return platform.lang_codes?.[canonical] ?? canonical;
}

function keyFamily(key) {
  if (!NO_PLURAL_GROUPING && PLURAL_SUFFIX_RE.test(key)) {
    return { family: key.replace(PLURAL_SUFFIX_RE, ""), isPlural: true, variant: key };
  }
  return { family: key, isPlural: false, variant: key };
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
  mkdirSync(dirname(path), { recursive: true });
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

function platformSourcePath(platform, referenceLang, files) {
  if (platform === "frontend") {
    const file = files?.[referenceLang] ?? "en.json";
    return `frontend/src/i18n/locales/${file}`;
  }
  if (referenceLang === BACKEND_DEFAULT_LANG) {
    return BACKEND_SOURCE;
  }
  const file = files?.[referenceLang] ?? `messages_${referenceLang}.properties`;
  return `backend/src/main/resources/i18n/${file}`;
}

function referenceLangFor(platformName) {
  return REFERENCE_OVERRIDE ?? PLATFORM_REFERENCE_DEFAULTS[platformName];
}

// --------------------------------------------------------------------------
// Loaders
// --------------------------------------------------------------------------

function loadLocaleDir(dir, parseFile, matchFile) {
  const langs = {};
  const files = {};
  const lang_codes = {};
  const errors = [];
  const warnings = [];

  if (!existsSync(dir)) {
    errors.push(`i18n dir not found: ${dir}`);
    return { langs, files, lang_codes, errors, warnings };
  }

  for (const file of readdirSync(dir)) {
    const spec = matchFile(file);
    if (!spec) continue;

    const { canonical, label } = spec;
    const full = join(dir, file);
    try {
      const map = parseFile(readFileSync(full, "utf8"));
      if (langs[canonical]) {
        warnings.push(
          `Duplicate canonical locale "${canonical}": kept ${file}, dropped ${files[canonical]}`,
        );
      }
      langs[canonical] = map;
      files[canonical] = file;
      lang_codes[canonical] = label;
    } catch (e) {
      errors.push(`Failed to parse ${file}: ${e.message}`);
    }
  }

  return { langs, files, lang_codes, errors, warnings };
}

function loadFrontend() {
  return loadLocaleDir(
    FRONTEND_DIR,
    (content) => flattenJson(JSON.parse(content)),
    (file) => {
      if (!file.endsWith(".json")) return null;
      const label = basename(file, ".json");
      return { canonical: canonicalLang(label), label };
    },
  );
}

function loadBackend() {
  return loadLocaleDir(
    BACKEND_DIR,
    parseProperties,
    (file) => {
      const m = file.match(/^messages(?:_([A-Za-z0-9-]+))?\.properties$/);
      if (!m) return null;
      const label = m[1] ?? BACKEND_DEFAULT_LANG;
      return { canonical: m[1] ? canonicalLang(m[1]) : BACKEND_DEFAULT_LANG, label };
    },
  );
}

// --------------------------------------------------------------------------
// Analysis
// --------------------------------------------------------------------------

function buildReferenceSets(platformRaw, platformName) {
  const { langs } = platformRaw;
  const referenceLang = referenceLangFor(platformName);
  const referenceKeys = new Set();
  const referenceFamilies = new Set();
  const pluralFamilies = new Set();
  const referencePluralKeys = new Set();
  const warnings = [...(platformRaw.warnings ?? [])];

  if (REFERENCE_MODE === "union") {
    for (const lang of Object.keys(langs)) {
      for (const key of langs[lang].keys()) {
        referenceKeys.add(key);
        const { family, isPlural } = keyFamily(key);
        referenceFamilies.add(family);
        if (isPlural) {
          pluralFamilies.add(family);
          referencePluralKeys.add(key);
        }
      }
    }
    return {
      referenceLang: null,
      referenceKeys,
      referenceFamilies,
      pluralFamilies,
      referencePluralKeys,
      warnings,
    };
  }

  const refMap = langs[referenceLang];
  if (!refMap) {
    warnings.push(
      `${platformName}: reference locale "${referenceLang}" not found — falling back to union`,
    );
    return buildReferenceSetsUnion(langs, warnings);
  }

  for (const key of refMap.keys()) {
    referenceKeys.add(key);
    const { family, isPlural } = keyFamily(key);
    referenceFamilies.add(family);
    if (isPlural) {
      pluralFamilies.add(family);
      referencePluralKeys.add(key);
    }
  }

  return {
    referenceLang,
    referenceKeys,
    referenceFamilies,
    pluralFamilies,
    referencePluralKeys,
    warnings,
  };
}

function buildReferenceSetsUnion(langs, warnings = []) {
  const referenceKeys = new Set();
  const referenceFamilies = new Set();
  const pluralFamilies = new Set();
  const referencePluralKeys = new Set();

  for (const lang of Object.keys(langs)) {
    for (const key of langs[lang].keys()) {
      referenceKeys.add(key);
      const { family, isPlural } = keyFamily(key);
      referenceFamilies.add(family);
      if (isPlural) {
        pluralFamilies.add(family);
        referencePluralKeys.add(key);
      }
    }
  }

  return {
    referenceLang: null,
    referenceKeys,
    referenceFamilies,
    pluralFamilies,
    referencePluralKeys,
    warnings,
  };
}

function analyzePlatform(platformRaw, platformName) {
  const { langs } = platformRaw;
  const languageCodes = sortLangs(Object.keys(langs));
  const ref = buildReferenceSets(platformRaw, platformName);
  const {
    referenceLang,
    referenceKeys,
    referenceFamilies,
    pluralFamilies,
    referencePluralKeys,
    warnings,
  } = ref;

  const langFamilies = {};
  for (const lang of languageCodes) {
    const present = new Set();
    for (const key of langs[lang].keys()) {
      present.add(keyFamily(key).family);
    }
    langFamilies[lang] = present;
  }

  const missing_keys = {};
  const empty_values = {};
  const extra_keys = {};
  const plural_variant_gaps = {};
  const stats = {};

  for (const lang of languageCodes) {
    const keyMap = langs[lang];
    const haveFamilies = langFamilies[lang];
    const isReference = REFERENCE_MODE === "locale" && lang === referenceLang;

    const missing = [];
    if (!isReference) {
      for (const family of referenceFamilies) {
        if (!haveFamilies.has(family)) missing.push(family);
      }
    }
    missing_keys[lang] = sortedUnique(missing);

    const extra = [];
    if (!isReference) {
      for (const key of keyMap.keys()) {
        if (!referenceKeys.has(key)) extra.push(key);
      }
    }
    extra_keys[lang] = sortedUnique(extra);

    const pluralGaps = [];
    if (!isReference) {
      for (const refKey of referencePluralKeys) {
        if (!keyMap.has(refKey)) pluralGaps.push(refKey);
      }
    }
    plural_variant_gaps[lang] = sortedUnique(pluralGaps);

    const empty = [];
    for (const [key, value] of keyMap.entries()) {
      if (isEmptyValue(value)) empty.push(key);
    }
    empty_values[lang] = sortedUnique(empty);

    stats[lang] = {
      total_keys: keyMap.size,
      missing_count: missing_keys[lang].length,
      empty_count: empty_values[lang].length,
      extra_count: extra_keys[lang].length,
      plural_variant_gap_count: plural_variant_gaps[lang].length,
    };
  }

  return {
    platform: platformName,
    reference_mode: REFERENCE_MODE,
    reference_locale: referenceLang,
    reference_source: platformSourcePath(platformName, referenceLang, platformRaw.files),
    languages: languageCodes,
    lang_codes: platformRaw.lang_codes,
    files: platformRaw.files,
    reference_key_count: referenceKeys.size,
    reference_family_count: referenceFamilies.size,
    plural_families: sortedUnique([...pluralFamilies]),
    missing_keys,
    empty_values,
    extra_keys,
    plural_variant_gaps,
    stats,
    warnings,
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
    const missingOnFrontend = [];
    const missingOnBackend = [];
    for (const key of shared_keys) {
      const inFe = fe?.has(key) && !isEmptyValue(fe.get(key));
      const inBe = be?.has(key) && !isEmptyValue(be.get(key));
      if (inFe && !inBe) missingOnBackend.push(key);
      else if (!inFe && inBe) missingOnFrontend.push(key);
    }
    mismatches[lang] = {
      missing_on_frontend: sortedUnique(missingOnFrontend),
      missing_on_backend: sortedUnique(missingOnBackend),
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

const METRIC_STAT_FIELDS = {
  missing_keys: "missing_count",
  empty_values: "empty_count",
  extra_keys: "extra_count",
  plural_variant_gaps: "plural_variant_gap_count",
};

function sumPlatformMetric(platform, field) {
  const statField = METRIC_STAT_FIELDS[field];
  let total = 0;
  for (const lang of platform.languages) {
    total += platform[field]?.[lang]?.length ?? platform.stats[lang]?.[statField] ?? 0;
  }
  return total;
}

function buildSummary(frontend, backend, cross, feRaw, beRaw) {
  const sumPlatform = (p) => ({
    missing: sumPlatformMetric(p, "missing_keys"),
    empty: sumPlatformMetric(p, "empty_values"),
    extra: sumPlatformMetric(p, "extra_keys"),
    plural_gaps: sumPlatformMetric(p, "plural_variant_gaps"),
  });
  const fe = sumPlatform(frontend);
  const be = sumPlatform(backend);
  const warnings =
    (frontend.warnings?.length ?? 0) +
    (backend.warnings?.length ?? 0) +
    feRaw.errors.length +
    beRaw.errors.length;

  return {
    reference_mode: REFERENCE_MODE,
    frontend_reference: frontend.reference_locale ?? "union",
    backend_reference: backend.reference_locale ?? "union",
    frontend_languages: frontend.languages.map((l) => displayLang(frontend, l)),
    backend_languages: backend.languages.map((l) => displayLang(backend, l)),
    frontend_reference_keys: frontend.reference_key_count,
    backend_reference_keys: backend.reference_key_count,
    total_missing_keys: fe.missing + be.missing,
    total_empty_values: fe.empty + be.empty,
    total_extra_keys: fe.extra + be.extra,
    total_plural_variant_gaps: fe.plural_gaps + be.plural_gaps,
    shared_keys: cross.shared_key_count,
    parse_errors: feRaw.errors.length + beRaw.errors.length,
    warnings: warnings - feRaw.errors.length - beRaw.errors.length,
  };
}

function buildReport() {
  const feRaw = loadFrontend();
  const beRaw = loadBackend();
  const frontend = analyzePlatform(feRaw, "frontend");
  const backend = analyzePlatform(beRaw, "backend");
  frontend.__langsRef = feRaw.langs;
  backend.__langsRef = beRaw.langs;
  const cross_platform = analyzeCrossPlatform(frontend, backend);

  const report = {
    generated_at: new Date().toISOString(),
    summary: buildSummary(frontend, backend, cross_platform, feRaw, beRaw),
    frontend: stripInternal(frontend),
    backend: stripInternal(backend),
    parse_errors: { frontend: feRaw.errors, backend: beRaw.errors },
  };

  if (!(SKIP_CROSS || (cross_platform.shared_key_count === 0 && SUMMARY_ONLY))) {
    report.cross_platform = cross_platform;
  }

  return report;
}

// --------------------------------------------------------------------------
// Task reports
// --------------------------------------------------------------------------

function filterKeys(keys, prefix) {
  if (!prefix) return keys;
  return keys.filter((k) => matchesPrefix(k, prefix));
}

function pickBatchKeys(emptyAll, missingAll, limit, prefix) {
  const empty = filterKeys(emptyAll, prefix);
  const missing = filterKeys(missingAll, prefix);

  const batchEmpty = empty.slice(0, limit);
  const remaining = limit - batchEmpty.length;
  const batchMissing = remaining > 0 ? missing.slice(0, remaining) : [];

  return {
    empty_values: batchEmpty,
    missing_keys: batchMissing,
    totals: { empty: empty.length, missing: missing.length },
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

function buildTaskReport(report, platformName, langArg, options = {}) {
  const { limit = TASK_LIMIT, prefix = KEY_PREFIX } = options;
  const platform = report[platformName];
  if (!platform) throw new Error(`Unknown platform: ${platformName}`);

  const langCode = resolveLangArg(langArg, platform);
  if (!platform.languages.includes(langCode)) {
    const available = platform.languages
      .map((l) => displayLang(platform, l))
      .join(", ");
    throw new Error(
      `Language "${langArg}" not found in ${platformName}. Available: ${available}`,
    );
  }

  const batch = pickBatchKeys(
    platform.empty_values[langCode] ?? [],
    platform.missing_keys[langCode] ?? [],
    limit,
    prefix,
  );

  const allBatchKeys = [...batch.empty_values, ...batch.missing_keys];
  const display = displayLang(platform, langCode);

  return {
    task: "fill-i18n",
    generated_at: report.generated_at,
    platform: platformName,
    language: display,
    language_canonical: langCode,
    reference_mode: platform.reference_mode,
    reference_locale: platform.reference_locale,
    source: platform.reference_source ?? platformSourcePath(platformName, referenceLangFor(platformName), platform.files),
    target: platformTargetPath(platformName, langCode, platform.files),
    limit,
    prefix: prefix ?? null,
    truncated: batch.truncated,
    remaining: batch.remaining,
    totals: batch.totals,
    missing_keys: batch.missing_keys,
    empty_values: batch.empty_values,
    plural_families: pluralFamiliesInBatch(allBatchKeys, platform.plural_families),
    task_notes: [
      "Fill empty_values first, then missing_keys.",
      "Use source (reference locale) as reference text; preserve {{placeholders}} and HTML tags.",
      "For plural_families, add plural categories required by the target language (i18next).",
      "Do not add extra_keys unless product requires locale-specific variants.",
      "After edits run: node scripts/i18n/check-i18n.mjs --task --platform ... --lang ...",
    ],
    parse_errors: report.parse_errors[platformName] ?? [],
    warnings: platform.warnings ?? [],
  };
}

function langsWithGaps(platform, langFilter) {
  return sortLangs(platform.languages).filter((lang) => {
    if (langFilter && !langFilter.includes(lang)) return false;
    const refLocale = platform.reference_locale;
    if (refLocale && lang === refLocale) return false;
    const miss = platform.missing_keys[lang]?.length ?? 0;
    const empty = platform.empty_values[lang]?.length ?? 0;
    return miss > 0 || empty > 0;
  });
}

function shrinkFullReport(report, langFilter) {
  if (!SUMMARY_ONLY && !langFilter) return report;

  const shrinkPlatform = (platform) => {
    const langs = langFilter
      ? platform.languages.filter((l) => langFilter.includes(l))
      : platform.languages;

    const pick = (field) => {
      const out = {};
      for (const lang of langs) out[lang] = platform[field][lang];
      return out;
    };

    const stats = {};
    for (const lang of langs) stats[lang] = platform.stats[lang];

    return {
      reference_mode: platform.reference_mode,
      reference_locale: platform.reference_locale,
      reference_source: platform.reference_source,
      languages: langs,
      lang_codes: Object.fromEntries(langs.map((l) => [l, platform.lang_codes[l]])),
      files: Object.fromEntries(langs.map((l) => [l, platform.files[l]])),
      reference_key_count: platform.reference_key_count,
      reference_family_count: platform.reference_family_count,
      warnings: platform.warnings,
      ...(SUMMARY_ONLY
        ? {}
        : {
            plural_families: platform.plural_families,
            missing_keys: pick("missing_keys"),
            empty_values: pick("empty_values"),
            extra_keys: pick("extra_keys"),
            plural_variant_gaps: pick("plural_variant_gaps"),
          }),
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
// Console / strict checks
// --------------------------------------------------------------------------

function printSummary(report, outPath, extra = "") {
  const s = report.summary;
  const line = (label, val) => console.log(`  ${label.padEnd(30)} ${val}`);
  console.log("\ni18n integrity report");
  if (extra) console.log(extra);
  console.log("─".repeat(52));
  line("Reference mode:", s.reference_mode);
  line("Frontend reference:", `${s.frontend_reference} (${report.frontend.reference_source})`);
  line("Backend reference:", `${s.backend_reference} (${report.backend.reference_source})`);
  line("Frontend languages:", s.frontend_languages.join(", "));
  line("Backend languages:", s.backend_languages.join(", "));
  line("Frontend ref. keys:", s.frontend_reference_keys);
  line("Backend ref. keys:", s.backend_reference_keys);
  line("Total missing keys:", s.total_missing_keys);
  line("Total empty values:", s.total_empty_values);
  line("Total extra keys:", s.total_extra_keys);
  line("Plural variant gaps:", s.total_plural_variant_gaps);
  line("Shared keys (cross):", s.shared_keys);
  line("Parse errors:", s.parse_errors);
  if (s.warnings > 0) line("Warnings:", s.warnings);

  const detail = (platformName, platform) => {
    for (const lang of platform.languages) {
      const label = displayLang(platform, lang);
      const miss =
        platform.missing_keys?.[lang]?.length ?? platform.stats[lang]?.missing_count ?? 0;
      const emp =
        platform.empty_values?.[lang]?.length ?? platform.stats[lang]?.empty_count ?? 0;
      const extra =
        platform.extra_keys?.[lang]?.length ?? platform.stats[lang]?.extra_count ?? 0;
      if (miss || emp || extra) {
        const parts = [];
        if (miss) parts.push(`${miss} missing`);
        if (emp) parts.push(`${emp} empty`);
        if (extra) parts.push(`${extra} extra`);
        console.log(`  ${platformName}/${label}: ${parts.join(", ")}`);
      }
    }
    for (const w of platform.warnings ?? []) {
      console.log(`  warn ${platformName}: ${w}`);
    }
  };

  console.log("─".repeat(52));
  detail("frontend", report.frontend);
  detail("backend", report.backend);
  console.log("─".repeat(52));
  console.log(`Report written to: ${outPath}`);
  if (
    s.total_missing_keys === 0 &&
    s.total_empty_values === 0 &&
    s.parse_errors === 0 &&
    s.warnings === 0
  ) {
    console.log("All translation sets are consistent with their reference locales.");
  }
  console.log("");
}

function keysMatchingPrefix(keys, prefix) {
  return keys.some((k) => matchesPrefix(k, prefix));
}

function hasScopedIssues(report, prefix) {
  const checkKeys = (keys) => (prefix ? keys.filter((k) => matchesPrefix(k, prefix)) : keys);

  if (report.parse_errors.frontend.length > 0 || report.parse_errors.backend.length > 0) {
    return true;
  }

  for (const platformName of ["frontend", "backend"]) {
    const platform = report[platformName];
    for (const lang of platform.languages) {
      if (platform.reference_locale && lang === platform.reference_locale) continue;

      const missing = checkKeys(platform.missing_keys[lang] ?? []);
      const empty = checkKeys(platform.empty_values[lang] ?? []);
      if (missing.length > 0 || empty.length > 0) return true;

      if (STRICT_PLURALS) {
        const pluralGaps = checkKeys(platform.plural_variant_gaps?.[lang] ?? []);
        if (pluralGaps.length > 0) return true;
      }
    }
  }

  return false;
}

function printTaskSummary(task, outPath) {
  console.log("\ni18n translation task");
  console.log("─".repeat(52));
  console.log(`  Platform:                     ${task.platform}`);
  console.log(`  Language:                     ${task.language}`);
  console.log(`  Reference:                    ${task.reference_locale} (${task.source})`);
  console.log(`  Target:                       ${task.target}`);
  console.log(`  Batch missing:                ${task.missing_keys.length} / ${task.totals.missing}`);
  console.log(`  Batch empty:                  ${task.empty_values.length} / ${task.totals.empty}`);
  console.log(
    `  Truncated:                    ${task.truncated ? "yes (run again for next batch)" : "no"}`,
  );
  if (task.prefix) console.log(`  Prefix filter:                ${task.prefix}`);
  console.log("─".repeat(52));
  console.log(`Task written to: ${outPath}`);
  console.log("");
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function validateCli() {
  if (SHOW_HELP) {
    printHelp();
    process.exit(0);
  }
  if (TASK_MODE && EMIT_TASKS) {
    console.error("Error: --task and --emit-tasks are mutually exclusive");
    process.exit(2);
  }
}

function validateTaskArgs() {
  if (!PLATFORM || !["frontend", "backend"].includes(PLATFORM)) {
    console.error("Error: --task requires --platform frontend|backend");
    process.exit(2);
  }
  if (!TASK_LANG) {
    console.error("Error: --task requires --lang <code> (e.g. ru, en, zh-CN, default)");
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

      const display = task.language;
      const suffix = KEY_PREFIX ? `-${KEY_PREFIX.replace(/\./g, "-")}` : "";
      const fileName = `${platformName}-${display}${suffix}.json`;
      const filePath = join(TASK_DIR, fileName);
      writeJson(filePath, task);
      written.push(relative(REPO_ROOT, filePath));
    }
  }

  if (!QUIET) {
    console.log("\ni18n translation tasks emitted");
    console.log("─".repeat(52));
    console.log(`  Directory:                    ${relative(REPO_ROOT, TASK_DIR)}`);
    console.log(`  Reference mode:               ${REFERENCE_MODE}`);
    console.log(`  Limit per task:               ${TASK_LIMIT}`);
    console.log(`  Lang filter:                  ${LANG_FILTER?.join(", ") ?? "all with gaps"}`);
    console.log(`  Files written:                ${written.length}`);
    for (const f of written) console.log(`    ${f}`);
    console.log("─".repeat(52));
    if (written.length === 0) console.log("No gaps found for selected languages.");
    console.log("");
  }

  if (STRICT && written.length > 0) process.exit(1);
}

function main() {
  validateCli();
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
    const modeNote = [
      SUMMARY_ONLY ? "summary-only" : null,
      LANG_FILTER ? `langs: ${LANG_FILTER.join(", ")}` : null,
      CHECK_HELP ? "check-help gate" : null,
      KEY_PREFIX && !CHECK_HELP ? `prefix: ${KEY_PREFIX}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    printSummary(output, OUT_PATH, modeNote ? `(${modeNote})` : "");
  }

  if (STRICT && hasScopedIssues(report, KEY_PREFIX)) process.exit(1);
}

main();
