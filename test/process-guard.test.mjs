import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseLsofProcessOutput, formatBusyProcessSummary, __test } = require("../dist/engine/processGuard.js");

test("parseLsofProcessOutput parses pid and command pairs", () => {
  const raw = [
    "p101",
    "cCode Helper (Extension)",
    "p202",
    "cCodex",
    "p202",
    "cCodex",
    ""
  ].join("\n");

  const parsed = parseLsofProcessOutput(raw);
  assert.deepEqual(parsed, [
    { pid: 101, command: "Code Helper (Extension)" },
    { pid: 202, command: "Codex" }
  ]);
});

test("formatBusyProcessSummary limits rows", () => {
  const list = Array.from({ length: 10 }).map((_, index) => ({ pid: 100 + index, command: `p${index}` }));
  const summary = formatBusyProcessSummary(list);
  assert.equal(summary.includes("p8(108)"), false);
  assert.equal(summary.includes("p7(107)"), true);
});

test("guessClientFromCommand differentiates codex and code", () => {
  assert.equal(__test.guessClientFromCommand("Codex"), "codex");
  assert.equal(__test.guessClientFromCommand("code"), "vscode");
  assert.equal(__test.guessClientFromCommand("Code Helper (Renderer)"), "vscode");
  assert.equal(__test.guessClientFromCommand("code-insiders"), "vscode-insiders");
});

test("resolveMacAppCandidates recognizes antigravity helper process", () => {
  const apps = __test.resolveMacAppCandidates("Antigravity Helper (Plugin)");
  assert.deepEqual(apps, ["Antigravity"]);
});

test("resolveWindowsProcessCandidates maps known clients", () => {
  assert.deepEqual(__test.resolveWindowsProcessCandidates("cursor"), ["Cursor.exe", "cursor.exe"]);
  assert.deepEqual(__test.resolveWindowsProcessCandidates("Code - Insiders"), ["Code - Insiders.exe", "code-insiders.exe"]);
});
