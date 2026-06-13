#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const LOCALES = join(ROOT, "frontend", "src", "i18n", "locales");
const ZH_FILE = join(LOCALES, "zh-CN.json");

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

const ZH = JSON.parse(readFileSync(join(__dirname, "zh-translations-flat.json"), "utf8"));
const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf8"));
const zh = JSON.parse(readFileSync(ZH_FILE, "utf8"));
const zhFlat = flatten(zh);
const enFlat = flatten(en);

const missing = Object.keys(enFlat).filter((k) => !(k in zhFlat)).sort();
const patch = {};
let missingZh = 0;

for (const key of missing) {
  const val = ZH[key];
  if (val === undefined) {
    console.error("Missing ZH translation:", key);
    missingZh++;
    continue;
  }
  setNested(patch, key, val);
}

if (missingZh) {
  console.error(`ERROR: ${missingZh} keys without Chinese translation`);
  process.exit(1);
}

writeFileSync(
  join(__dirname, "zh-remaining-patch.json"),
  JSON.stringify(patch, null, 2) + "\n",
  "utf8"
);
console.log("Wrote", missing.length, "keys to zh-remaining-patch.json");
