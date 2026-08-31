#!/usr/bin/env node
/**
 * Scan frontend/src for user-facing hardcoded strings that bypass i18n.
 *
 * Usage:
 *   node scripts/i18n/scan-hardcoded-ui.mjs
 *   node scripts/i18n/scan-hardcoded-ui.mjs --prefix frontend/src/App.tsx --strict
 *   node scripts/i18n/scan-hardcoded-ui.mjs --out reports/i18n-hardcoded.json
 *
 * Exit: 0 = ok (or hits without --strict), 1 = hits with --strict, 2 = usage
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SRC_ROOT = join(REPO_ROOT, "frontend", "src");

const ATTR_NAMES = "title|placeholder|aria-label|alt|label";
const TOAST_FNS = "success|error|warning|info";

const SKIP_PATH_RES = [
  /(?:^|[\\/])DebugPanel(?:[\\/]|$)/,
  /\.(test|spec)\.(tsx?|jsx?)$/i,
  /(?:^|[\\/])workers(?:[\\/]|$)/,
];

const BRAND_EXACT = new Set([
  "BurnedChats",
  "Burned Chats",
  "BURN",
  "TON",
  "Telegram",
  "GitHub",
  "Web App",
  "Jetton Master",
  "Signal",
  "WhatsApp",
  "Alice",
  "Bob",
  "Server",
  "sharedSecret",
  "??? blob",
  "session",
  "from",
  "to",
  "payload",
  "ttl",
  "user_928471",
  "user_382910",
  "ECDH P-256",
  "AES-256-GCM",
  "Web Crypto API",
  "React",
  "Spring Boot",
  "Redis",
  "TypeScript",
  "Java 21",
  "const",
  "await",
  "deriveBits",
  "name",
  "public",
  "ECDH",
  "peerPublicKey",
  "myPrivateKey",
]);

const SKIP_LINE_RES = [/debugLog\s*\(/, /console\.(log|warn|error|debug|info)\s*\(/];

export function posixRel(rel) {
  return rel.split(sep).join("/");
}

export function shouldSkipPath(relPosix) {
  return SKIP_PATH_RES.some((re) => re.test(relPosix));
}

export function isAllowlistedText(raw) {
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (t.length < 2) return true;
  if (BRAND_EXACT.has(t)) return true;
  if (/^EQ[A-Za-z0-9_-]{2,}$/.test(t) || t === "EQ…") return true;
  if (/^0x[0-9a-fA-F]+$/.test(t)) return true;
  if (/^[0-9a-f]{6,16}$/i.test(t)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(t)) return true;
  if (/^[\d.\s,%]+$/.test(t)) return true;
  if (/^[{}[\]().,;:!?#/\\|_+=*@&$]+$/.test(t)) return true;
  if (/^publicKey$/i.test(t)) return true;
  if (/^status$/i.test(t)) return true;
  if (/^ACTIVE$/i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^t\.me\//i.test(t)) return true;
  if (/^[A-Z]{2,6}$/.test(t) && t !== "PAUSED") return true;
  return false;
}

function hasLetter(s) {
  return /[\p{L}]/u.test(s);
}

function looksUserFacing(s) {
  if (!hasLetter(s)) return false;
  if (isAllowlistedText(s)) return false;
  return true;
}

function lineOf(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function skipLine(content, index) {
  const lineStart = content.lastIndexOf("\n", index) + 1;
  const lineEnd = content.indexOf("\n", index);
  const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  return SKIP_LINE_RES.some((re) => re.test(line));
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function scanSource(content, fileRel) {
  const hits = [];
  const src = stripComments(content);
  const isTsx = /\.tsx$/i.test(fileRel);

  const push = (kind, text, index) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!looksUserFacing(trimmed)) return;
    if (skipLine(src, index)) return;
    hits.push({
      file: fileRel,
      line: lineOf(src, index),
      kind,
      text: trimmed.slice(0, 200),
    });
  };

  const toastRe = new RegExp(
    `toast\\.(${TOAST_FNS})\\(\\s*(["'\`])((?:\\\\.|(?!\\2).)*)\\2`,
    "g",
  );
  for (const m of src.matchAll(toastRe)) {
    push("toast", m[3], m.index ?? 0);
  }

  if (!isTsx) return hits;

  const attrRe = new RegExp(
    `(?:${ATTR_NAMES})\\s*=\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`,
    "gi",
  );
  for (const m of src.matchAll(attrRe)) {
    push("attr", m[2], m.index ?? 0);
  }

  // Require a closing tag so TypeScript generics (`useRef<T>(`) are not hits.
  const jsxRe = />([^<>{}][^<>]*)<\//g;
  for (const m of src.matchAll(jsxRe)) {
    const inner = m[1];
    if (/^\s*$/.test(inner)) continue;
    if (/\{/.test(inner)) continue;
    if (!/^[\p{L}]/u.test(inner.trim())) continue;
    if (/===|\?\.|split\(/.test(inner)) continue;
    push("jsx", inner, m.index ?? 0);
  }

  return hits;
}

function walkTsx(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsx(full, acc);
      continue;
    }
    if (/\.(tsx|ts|jsx|js)$/.test(name)) acc.push(full);
  }
  return acc;
}

export function matchesPrefix(relPosix, prefix) {
  if (!prefix) return true;
  const p = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
  return relPosix === p || relPosix.startsWith(`${p}/`);
}

export function scanTree(options = {}) {
  const { prefix = null, root = SRC_ROOT, repoRoot = REPO_ROOT } = options;
  const files = walkTsx(root);
  const hits = [];
  for (const full of files) {
    const rel = posixRel(relative(repoRoot, full));
    if (shouldSkipPath(rel)) continue;
    if (!matchesPrefix(rel, prefix)) continue;
    const content = readFileSync(full, "utf8");
    hits.push(...scanSource(content, rel));
  }
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return hits;
}

function flagValue(args, name, fallback) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

function printHelp() {
  console.log(`Scan frontend/src for hardcoded UI strings

Usage:
  node scripts/i18n/scan-hardcoded-ui.mjs [options]

Options:
  --prefix <path>   Scope to file or directory (repo-relative, posix)
  --strict          Exit 1 when any hit remains
  --out <path>      Write JSON report (default: reports/i18n-hardcoded.json)
  --quiet           No console table
  --help, -h
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const prefix = flagValue(argv, "--prefix", null);
  const strict = argv.includes("--strict");
  const quiet = argv.includes("--quiet");
  const outArg = flagValue(argv, "--out", "reports/i18n-hardcoded.json");
  const outPath = join(REPO_ROOT, outArg);

  const hits = scanTree({ prefix });
  const report = {
    generated_at: new Date().toISOString(),
    prefix,
    hit_count: hits.length,
    hits,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  if (!quiet) {
    console.log(`\nhardcoded UI scan`);
    console.log("─".repeat(52));
    if (prefix) console.log(`  Prefix:                       ${prefix}`);
    console.log(`  Hits:                         ${hits.length}`);
    const byDir = {};
    for (const h of hits) {
      const top = h.file.split("/").slice(0, 4).join("/");
      byDir[top] = (byDir[top] ?? 0) + 1;
    }
    for (const [k, n] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${k}`);
    }
    console.log("─".repeat(52));
    console.log(`Report: ${outArg}\n`);
  }

  if (strict && hits.length > 0) return 1;
  return 0;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);

if (invoked || process.argv[1]?.endsWith("scan-hardcoded-ui.mjs")) {
  process.exit(main());
}

export { main };
