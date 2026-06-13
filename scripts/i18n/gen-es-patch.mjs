#!/usr/bin/env node
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

const ES = JSON.parse(readFileSync(join(__dirname, "es-translations-flat.json"), "utf8"));
const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf8"));
const es = JSON.parse(readFileSync(join(LOCALES, "es.json"), "utf8"));
const esFlat = flatten(es);
const enFlat = flatten(en);

const missing = Object.keys(enFlat).filter((k) => !(k in esFlat)).sort();
const patch = {};
let missingEs = 0;

for (const key of missing) {
  const val = ES[key];
  if (val === undefined) {
    console.error("Missing ES translation:", key);
    missingEs++;
    continue;
  }
  setNested(patch, key, val);
}

if (missingEs) {
  console.error(`ERROR: ${missingEs} keys without Spanish translation`);
  process.exit(1);
}

writeFileSync(
  join(__dirname, "es-remaining-patch.json"),
  JSON.stringify(patch, null, 2) + "\n",
  "utf8"
);
console.log("Wrote", missing.length, "keys to es-remaining-patch.json");
