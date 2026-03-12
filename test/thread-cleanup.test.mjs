import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");
const {
  previewThreadCleanup,
  executeThreadCleanup,
  __internal
} = require("../dist/engine/threadCleanup.js");

let sqlPromise;
async function getSql() {
  if (!sqlPromise) {
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    sqlPromise = initSqlJs({
      locateFile: () => wasmPath
    });
  }
  return sqlPromise;
}

function queryCount(db, table, whereClause, params = []) {
  const stmt = db.prepare(`SELECT COUNT(1) AS count FROM ${table} ${whereClause}`);
  try {
    if (params.length > 0) {
      stmt.bind(params);
    }
    if (!stmt.step()) {
      return 0;
    }
    const row = stmt.getAsObject();
    return Number(row.count ?? 0);
  } finally {
    stmt.free();
  }
}

async function readDb(codexHome) {
  const SQL = await getSql();
  const dbPath = path.join(codexHome, "state_5.sqlite");
  const bytes = await fs.readFile(dbPath);
  const db = new SQL.Database(new Uint8Array(bytes));
  return { db, dbPath };
}

async function createFixture() {
  const SQL = await getSql();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "thread-cleanup-test-"));
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(path.join(codexHome, "sessions"), { recursive: true });
  await fs.mkdir(path.join(codexHome, "archived_sessions"), { recursive: true });

  const dbPath = path.join(codexHome, "state_5.sqlite");
  const alphaRollout = path.join(codexHome, "sessions", "rollout-2026-03-05T22-33-54-thread_alpha.jsonl");
  const betaRollout = path.join(codexHome, "archived_sessions", "rollout-2026-03-05T22-47-18-thread_beta.jsonl");
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, archived INTEGER, rollout_path TEXT);
    CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT, payload TEXT);
    CREATE TABLE thread_dynamic_tools (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT, payload TEXT);
  `);
  db.run("INSERT INTO threads (id, title, archived, rollout_path) VALUES (?, ?, ?, ?)", ["thread_alpha", "Alpha", 0, alphaRollout]);
  db.run("INSERT INTO threads (id, title, archived, rollout_path) VALUES (?, ?, ?, ?)", ["thread_beta", "Beta", 1, betaRollout]);
  db.run("INSERT INTO logs (thread_id, payload) VALUES (?, ?)", ["thread_alpha", "log-a"]);
  db.run("INSERT INTO logs (thread_id, payload) VALUES (?, ?)", ["thread_beta", "log-b"]);
  db.run("INSERT INTO thread_dynamic_tools (thread_id, payload) VALUES (?, ?)", ["thread_alpha", "tool-a"]);
  const exported = Buffer.from(db.export());
  db.close();
  await fs.writeFile(dbPath, exported);

  await fs.writeFile(alphaRollout, "{}\n", "utf8");
  await fs.writeFile(betaRollout, "{}\n", "utf8");

  await fs.writeFile(
    path.join(codexHome, ".codex-global-state.json"),
    JSON.stringify(
      {
        "electron-persisted-atom-state": {
          "thread-titles": {
            titles: {
              thread_alpha: "Alpha",
              thread_beta: "Beta"
            },
            order: ["thread_alpha", "thread_beta"]
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return { root, codexHome, dbPath };
}

test("splitAndNormalizeThreadIds parses comma/newline values and de-duplicates", () => {
  const output = __internal.splitAndNormalizeThreadIds(["thread_a, thread_b", "thread_b\nthread_c", "   "]);
  assert.deepEqual(output, ["thread_a", "thread_b", "thread_c"]);
});

test("splitAndNormalizeThreadIds strips wrapper chars and extracts UUID from pasted text", () => {
  const output = __internal.splitAndNormalizeThreadIds(["`id: 019cbe6b-6140-7a62-9ce7-ed24424e4864`"]);
  assert.deepEqual(output, ["019cbe6b-6140-7a62-9ce7-ed24424e4864"]);
});

test("preview + execute removes thread rows/files/global state and writes backup manifest", async () => {
  const fixture = await createFixture();
  let backupPath;
  try {
    const preview = await previewThreadCleanup({
      codexHome: fixture.codexHome,
      threadIds: ["thread_alpha", "thread_missing"],
      scope: "all",
      detectBusyProcesses: async () => []
    });

    assert.equal(preview.totalMatchedThreads, 1);
    assert.equal(preview.totalMatchedFiles, 1);
    assert.equal(preview.notFoundThreadIds.includes("thread_missing"), true);

    const result = await executeThreadCleanup({
      codexHome: fixture.codexHome,
      threadIds: ["thread_alpha", "thread_missing"],
      scope: "all",
      backupEnabled: true,
      applyMode: "restartLater",
      detectBusyProcesses: async () => []
    });

    backupPath = result.backupPath;
    assert.equal(result.profiles.length, 1);
    assert.equal(result.profiles[0].errors.length, 0);
    assert.equal(result.profiles[0].verification.clean, true);
    assert.ok(backupPath);

    const manifestPath = path.join(backupPath, "manifest.json");
    const manifestStat = await fs.stat(manifestPath);
    assert.equal(manifestStat.isFile(), true);

    const { db } = await readDb(fixture.codexHome);
    const threadCount = queryCount(db, "threads", "WHERE id = ?", ["thread_alpha"]);
    const logCount = queryCount(db, "logs", "WHERE thread_id = ?", ["thread_alpha"]);
    const toolCount = queryCount(db, "thread_dynamic_tools", "WHERE thread_id = ?", ["thread_alpha"]);
    db.close();

    assert.equal(threadCount, 0);
    assert.equal(logCount, 0);
    assert.equal(toolCount, 0);

    const rolloutStat = await fs.stat(path.join(fixture.codexHome, "sessions", "rollout-2026-03-05T22-33-54-thread_alpha.jsonl")).catch(() => undefined);
    assert.equal(Boolean(rolloutStat), false);

    const globalStateRaw = await fs.readFile(path.join(fixture.codexHome, ".codex-global-state.json"), "utf8");
    const globalState = JSON.parse(globalStateRaw);
    assert.equal(globalState["electron-persisted-atom-state"]["thread-titles"].titles.thread_alpha, undefined);
  } finally {
    if (backupPath) {
      await fs.rm(backupPath, { recursive: true, force: true });
    }
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("restartLater marks profile locked and killNow can continue", async () => {
  const fixture = await createFixture();
  try {
    const busy = [{ pid: 99999, command: "codex.exe" }];
    await fs.chmod(fixture.dbPath, 0o444);

    const restartResult = await executeThreadCleanup({
      codexHome: fixture.codexHome,
      threadIds: ["thread_beta"],
      scope: "all",
      backupEnabled: false,
      applyMode: "restartLater",
      detectBusyProcesses: async () => busy
    });

    assert.equal(restartResult.profiles[0].locked, true);
    assert.equal(restartResult.profiles[0].errors.length > 0, true);

    let chmodReleased = false;
    const killNowResult = await executeThreadCleanup({
      codexHome: fixture.codexHome,
      threadIds: ["thread_beta"],
      scope: "all",
      backupEnabled: false,
      applyMode: "killNow",
      detectBusyProcesses: async () => busy,
      killProcesses: async () => {
        if (!chmodReleased) {
          await fs.chmod(fixture.dbPath, 0o666);
          chmodReleased = true;
        }
        return { killedCount: 1 };
      }
    });

    assert.equal(killNowResult.profiles[0].errors.length, 0);
    const { db } = await readDb(fixture.codexHome);
    const threadCount = queryCount(db, "threads", "WHERE id = ?", ["thread_beta"]);
    db.close();
    assert.equal(threadCount, 0);
  } finally {
    await fs.chmod(fixture.dbPath, 0o666).catch(() => undefined);
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("execute is compatible when thread_dynamic_tools table is missing", async () => {
  const fixture = await createFixture();
  try {
    const { db } = await readDb(fixture.codexHome);
    db.run("DROP TABLE thread_dynamic_tools;");
    const exported = Buffer.from(db.export());
    db.close();
    await fs.writeFile(fixture.dbPath, exported);

    const result = await executeThreadCleanup({
      codexHome: fixture.codexHome,
      threadIds: ["thread_alpha"],
      scope: "all",
      backupEnabled: false,
      applyMode: "restartLater",
      detectBusyProcesses: async () => []
    });

    assert.equal(result.profiles[0].errors.length, 0);
    assert.equal(result.profiles[0].deleted.dynamicTools, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("execute still removes rollout/global state when sqlite is malformed", async () => {
  const fixture = await createFixture();
  try {
    await fs.writeFile(fixture.dbPath, Buffer.from("not-a-sqlite-db"));

    const result = await executeThreadCleanup({
      codexHome: fixture.codexHome,
      threadIds: ["thread_alpha"],
      scope: "all",
      backupEnabled: false,
      applyMode: "restartLater",
      detectBusyProcesses: async () => []
    });

    assert.equal(result.profiles[0].deleted.files, 1);
    assert.equal(result.profiles[0].deleted.globalStateTitles, 1);
    assert.equal(result.profiles[0].verification.fileResidual, 0);
    assert.equal(result.profiles[0].verification.globalStateResidual, 0);
    assert.equal(result.profiles[0].verification.clean, false);
    assert.equal(result.profiles[0].errors.some((item) => item.includes("state_5.sqlite")), true);

    const rolloutStat = await fs.stat(path.join(fixture.codexHome, "sessions", "rollout-2026-03-05T22-33-54-thread_alpha.jsonl")).catch(() => undefined);
    assert.equal(Boolean(rolloutStat), false);

    const globalStateRaw = await fs.readFile(path.join(fixture.codexHome, ".codex-global-state.json"), "utf8");
    const globalState = JSON.parse(globalStateRaw);
    assert.equal(globalState["electron-persisted-atom-state"]["thread-titles"].titles.thread_alpha, undefined);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
