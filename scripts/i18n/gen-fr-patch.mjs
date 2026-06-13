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

const FR = JSON.parse(readFileSync(join(__dirname, "fr-translations-flat.json"), "utf8"));
const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf8"));
const fr = JSON.parse(readFileSync(join(LOCALES, "fr.json"), "utf8"));
const frFlat = flatten(fr);
const enFlat = flatten(en);

const missing = Object.keys(enFlat).filter((k) => !(k in frFlat)).sort();
const patch = {};
let missingFr = 0;

for (const key of missing) {
  const val = FR[key];
  if (val === undefined) {
    console.error("Missing FR translation:", key);
    missingFr++;
    continue;
  }
  setNested(patch, key, val);
}

if (missingFr) {
  console.error(`ERROR: ${missingFr} keys without French translation`);
  process.exit(1);
}

writeFileSync(
  join(__dirname, "fr-remaining-patch.json"),
  JSON.stringify(patch, null, 2) + "\n",
  "utf8"
);
console.log("Wrote", missing.length, "keys to fr-remaining-patch.json");
