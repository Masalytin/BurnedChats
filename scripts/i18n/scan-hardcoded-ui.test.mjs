import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanSource,
  shouldSkipPath,
  isAllowlistedText,
  matchesPrefix,
  scanTree,
} from "./scan-hardcoded-ui.mjs";

test("jsx text is a hit", () => {
  const hits = scanSource("<h2>Cannot Start App</h2>", "frontend/src/App.tsx");
  assert.ok(hits.some((h) => h.kind === "jsx" && h.text === "Cannot Start App"));
});

test("t() child is not a hit", () => {
  const hits = scanSource("<h2>{t('errors.startTitle')}</h2>", "frontend/src/App.tsx");
  assert.equal(hits.length, 0);
});

test("string attr is a hit", () => {
  const hits = scanSource('<button aria-label="Copy username" />', "frontend/src/pages/HomePage.tsx");
  assert.ok(hits.some((h) => h.kind === "attr" && h.text === "Copy username"));
});

test("toast literal is a hit", () => {
  const hits = scanSource("toast.success('Connected to server');", "frontend/src/App.tsx");
  assert.ok(hits.some((h) => h.kind === "toast" && h.text === "Connected to server"));
});

test("toast t() is not a hit", () => {
  const hits = scanSource("toast.success(t('toast.connected'));", "frontend/src/App.tsx");
  assert.equal(hits.filter((h) => h.kind === "toast").length, 0);
});

test("DebugPanel path is skipped", () => {
  assert.equal(shouldSkipPath("frontend/src/components/DebugPanel/DebugPanel.tsx"), true);
});

test("test file path is skipped", () => {
  assert.equal(shouldSkipPath("frontend/src/App.debugPanelMount.test.tsx"), true);
});

test("brand allowlist", () => {
  assert.equal(isAllowlistedText("BURN"), true);
  assert.equal(isAllowlistedText("Burned Chats"), true);
  assert.equal(isAllowlistedText("Cannot Start App"), false);
});

test("prefix matches file and directory", () => {
  assert.equal(matchesPrefix("frontend/src/App.tsx", "frontend/src/App.tsx"), true);
  assert.equal(matchesPrefix("frontend/src/components/Landing/HeroSection.tsx", "frontend/src/components/Landing"), true);
  assert.equal(matchesPrefix("frontend/src/App.tsx", "frontend/src/components/Landing"), false);
});

test("scanTree honors prefix and skips tests", () => {
  const root = mkdtempSync(join(tmpdir(), "i18n-scan-"));
  const src = join(root, "frontend", "src");
  mkdirSync(join(src, "components", "Landing"), { recursive: true });
  writeFileSync(join(src, "App.tsx"), "<h1>Hello World Title</h1>\n");
  writeFileSync(join(src, "App.test.tsx"), "<h1>Should Ignore Test</h1>\n");
  writeFileSync(join(src, "components", "Landing", "Hero.tsx"), "<p>Landing Copy Here</p>\n");
  try {
    const appHits = scanTree({
      prefix: "frontend/src/App.tsx",
      root: src,
      repoRoot: root,
    });
    assert.ok(appHits.some((h) => h.text === "Hello World Title"));
    assert.ok(!appHits.some((h) => h.file.includes("Landing")));

    const landHits = scanTree({
      prefix: "frontend/src/components/Landing",
      root: src,
      repoRoot: root,
    });
    assert.ok(landHits.some((h) => h.text === "Landing Copy Here"));
    assert.ok(!landHits.some((h) => h.file.endsWith("App.tsx")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
