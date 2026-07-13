#!/usr/bin/env node
/**
 * Extract missing i18n keys from the reference locale (frontend: en) as a nested
 * subtree plus a flat dot-path map for batch translation.
 *
 * Missing families/keys are determined by the same audit as check-i18n.mjs
 * (reference locale mode, plural grouping). check-i18n is invoked as a subprocess
 * because it is a CLI-only module without shared exports — see i18n-audit.mjs note
 * below for the small local helpers duplicated from gen-uk-patch.mjs.
 *
 * Usage:
 *   node scripts/i18n/extract-missing-subtree.mjs --platform frontend --lang uk
 *   node scripts/i18n/extract-missing-subtree.mjs --platform frontend --lang zh-CN --prefix help
 *   node scripts/i18n/extract-missing-subtree.mjs --platform frontend --lang de --out reports
 *
 * Options:
 *   --platform frontend|backend   Required (backend supported when check-i18n covers it)
 *   --lang <code>                 Target locale (zh-CN → canonical zh for file names)
 *   --prefix <dot.path>           Optional namespace filter
 *   --out <dir>                   Output directory (default: reports/)
 *
 * Artifacts (gitignored under reports/):
 *   {lang}-missing-subtree.json   Nested JSON ready for locale merge
 *   {lang}-missing-flat.json      dot-path → en reference value
 *
 * Exit codes: 0 = ok, 1 = no missing keys (still writes empty files), 2 = usage error
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const CHECK_I18N = join(__dirname, "check-i18n.mjs");

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

const SHOW_HELP = hasFlag("--help") || hasFlag("-h");
const PLATFORM = flagValue("--platform", null);
const LANG_ARG = flagValue("--lang", null);
const PREFIX = flagValue("--prefix", null);
const OUT_DIR = join(REPO_ROOT, flagValue("--out", "reports"));

function printHelp() {
  console.log(`Extract missing i18n subtree from reference locale — Burned Chats

Usage:
  node scripts/i18n/extract-missing-subtree.mjs --platform frontend --lang uk

Options:
  --platform frontend|backend   Required
  --lang <code>                 Target locale (zh-CN resolves to zh for filenames)
  --prefix <dot.path>           Optional namespace filter
  --out <dir>                   Output directory (default: reports/)
  --help, -h                    Show this help
`);
}

function usageError(message) {
  console.error(`Error: ${message}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}

// --------------------------------------------------------------------------
// Local helpers (gen-uk-patch.mjs patterns; audit via check-i18n subprocess)
// --------------------------------------------------------------------------

function canonicalLang(lang) {
  const aliases = {
    "zh-cn": "zh",
    "zh-hans": "zh",
    "pt-br": "pt",
    "en-us": "en",
    "en-gb": "en",
  };
  const lower = String(lang).toLowerCase();
  return aliases[lower] ?? lower;
}

function keyFamily(key) {
  if (PLURAL_SUFFIX_RE.test(key)) {
    return key.replace(PLURAL_SUFFIX_RE, "");
  }
  return key;
}

function matchesPrefix(key, prefix) {
  if (!prefix) return true;
  return key === prefix || key.startsWith(`${prefix}.`);
}

function flattenJson(obj, prefix = "", out = new Map()) {
  if (Array.isArray(obj)) {
    obj.forEach((item, i) =>
      flattenJson(item, prefix ? `${prefix}.${i}` : String(i), out),
    );
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
function extractSubtree(source, missingKeys, prefix = "") {
  const missingSet = new Set(missingKeys);
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const nested = extractSubtree(v, missingKeys, key);
      if (Object.keys(nested).length) out[k] = nested;
    } else if (missingSet.has(key)) {
      out[k] = v;
    }
  }
  return out;
}

function collectFlatKeys(subtree, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(subtree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      collectFlatKeys(v, key, out);
    } else {
      out.add(key);
    }
  }
  return out;
}

function resolveLangArg(langArg, platform) {
  const canonical = canonicalLang(langArg);
  if (platform.languages.includes(canonical)) return canonical;
  const byLabel = Object.entries(platform.lang_codes ?? {}).find(
    ([, label]) => label.toLowerCase() === String(langArg).toLowerCase(),
  );
  if (byLabel) return byLabel[0];
  return canonical;
}

function runCheckI18nAudit() {
  const reportRel = "reports/.extract-missing-subtree-audit.json";
  const reportPath = join(REPO_ROOT, reportRel);
  try {
    const result = spawnSync(
      process.execPath,
      [CHECK_I18N, "--out", reportRel, "--compact", "--quiet"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    if (result.status !== 0 && result.status !== 1) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
      throw new Error(`check-i18n.mjs failed (exit ${result.status}): ${detail}`);
    }
    return JSON.parse(readFileSync(reportPath, "utf8"));
  } finally {
    try {
      rmSync(reportPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

function loadReferenceJson(platform, referenceSource) {
  const fullPath = join(REPO_ROOT, referenceSource);
  const content = readFileSync(fullPath, "utf8");
  if (platform === "frontend") {
    return JSON.parse(content);
  }
  throw new Error(`Reference JSON load not implemented for platform: ${platform}`);
}

function expandMissingKeys(enFlat, missingFamilies, prefix) {
  const familySet = new Set(
    missingFamilies.filter((family) => matchesPrefix(family, prefix)),
  );
  const keys = [];
  for (const key of enFlat.keys()) {
    if (familySet.has(keyFamily(key)) && matchesPrefix(key, prefix)) {
      keys.push(key);
    }
  }
  return keys.sort((a, b) => a.localeCompare(b));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function main() {
  if (SHOW_HELP) {
    printHelp();
    process.exit(0);
  }

  if (!PLATFORM || !["frontend", "backend"].includes(PLATFORM)) {
    usageError("--platform frontend|backend is required");
  }
  if (!LANG_ARG) {
    usageError("--lang <code> is required");
  }

  const report = runCheckI18nAudit();
  const platform = report[PLATFORM];
  if (!platform) {
    usageError(`Unknown platform in audit report: ${PLATFORM}`);
  }

  const langCode = resolveLangArg(LANG_ARG, platform);
  if (!platform.languages.includes(langCode)) {
    const available = platform.languages
      .map((l) => platform.lang_codes?.[l] ?? l)
      .join(", ");
    usageError(`Language "${LANG_ARG}" not found in ${PLATFORM}. Available: ${available}`);
  }

  const missingFamilies = platform.missing_keys?.[langCode] ?? [];
  const referenceSource = platform.reference_source;
  const referenceRoot = loadReferenceJson(PLATFORM, referenceSource);
  const enFlat = flattenJson(referenceRoot);
  const missingKeys = expandMissingKeys(enFlat, missingFamilies, PREFIX);

  const subtree = extractSubtree(referenceRoot, missingKeys);
  const flat = {};
  for (const key of missingKeys) {
    flat[key] = enFlat.get(key);
  }

  const subtreeKeys = collectFlatKeys(subtree);
  const uncovered = missingKeys.filter((k) => !subtreeKeys.has(k));
  if (uncovered.length > 0) {
    console.error("Subtree validation failed — flat keys not in nested structure:");
    for (const k of uncovered) console.error(`  ${k}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const fileLang = canonicalLang(LANG_ARG);
  const subtreePath = join(OUT_DIR, `${fileLang}-missing-subtree.json`);
  const flatPath = join(OUT_DIR, `${fileLang}-missing-flat.json`);

  writeJson(subtreePath, subtree);
  writeJson(flatPath, flat);

  console.log(`Missing families: ${missingFamilies.length}${PREFIX ? ` (prefix: ${PREFIX})` : ""}`);
  console.log(`Flat keys:        ${missingKeys.length}`);
  console.log(`Subtree:          ${subtreePath}`);
  console.log(`Flat:             ${flatPath}`);

  if (missingKeys.length === 0) {
    process.exit(1);
  }
}

main();
