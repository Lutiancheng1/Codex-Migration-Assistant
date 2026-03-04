import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseLsofProcessOutput, formatBusyProcessSummary } = require("../dist/engine/processGuard.js");

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
