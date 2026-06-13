#!/usr/bin/env node
/**
 * Generate uk-remaining-patch.json from ru reference + Ukrainian translations.
 * Run: node scripts/i18n/gen-uk-patch.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const LOCALES = join(ROOT, "frontend", "src", "i18n", "locales");

function flatten(o, p = "") {
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(r, flatten(v, key));
    else r[key] = v;
  }
  return r;
}

function setNested(obj, path, val) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

function extractMissingSubtree(source, ukFlat, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = extractMissingSubtree(v, ukFlat, key);
      if (Object.keys(nested).length) out[k] = nested;
    } else if (!(key in ukFlat)) {
      out[k] = v;
    }
  }
  return out;
}

/** Ukrainian translations keyed by dot-path (591 keys). */
const UK = JSON.parse(readFileSync(join(__dirname, "uk-translations-flat.json"), "utf8"));

const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf8"));
const uk = JSON.parse(readFileSync(join(LOCALES, "uk.json"), "utf8"));
const ukFlat = flatten(uk);
const enFlat = flatten(en);

const missing = Object.keys(enFlat).filter((k) => !(k in ukFlat)).sort();
const patch = {};
let missingUk = 0;

for (const key of missing) {
  const val = UK[key];
  if (val === undefined) {
    console.error("Missing UK translation:", key);
    missingUk++;
    continue;
  }
  setNested(patch, key, val);
}

if (missingUk) {
  console.error(`ERROR: ${missingUk} keys without Ukrainian translation`);
  process.exit(1);
}

writeFileSync(
  join(__dirname, "uk-remaining-patch.json"),
  JSON.stringify(patch, null, 2) + "\n",
  "utf8"
);
console.log("Wrote", missing.length, "keys to uk-remaining-patch.json");
