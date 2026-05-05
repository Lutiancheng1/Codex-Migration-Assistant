import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { withSharedWriteLock } = require("../dist/util/sharedLock.js");

function lockPathFor(codexHome) {
  return path.join(path.dirname(codexHome), `${path.basename(codexHome)}-profiles`, ".shared-write.lock.json");
}

async function writeLock(codexHome, record) {
  const lockPath = lockPathFor(codexHome);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify(record, null, 2), "utf8");
  return lockPath;
}

test("shared write lock rejects a live recent lock", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shared-lock-test-"));
  const codexHome = path.join(root, ".codex");
  const now = new Date().toISOString();

  try {
    await writeLock(codexHome, {
      schemaVersion: 1,
      owner: "vscode-extension",
      pid: process.pid,
      createdAt: now,
      updatedAt: now
    });

    await assert.rejects(
      withSharedWriteLock(codexHome, "vscode-extension", async () => "locked"),
      /共享数据正在被其它客户端写入/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("shared write lock clears stale live-pid lock and retries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shared-lock-test-"));
  const codexHome = path.join(root, ".codex");
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  try {
    const lockPath = await writeLock(codexHome, {
      schemaVersion: 1,
      owner: "vscode-extension",
      pid: process.pid,
      createdAt: stale,
      updatedAt: stale
    });

    const result = await withSharedWriteLock(codexHome, "vscode-extension", async () => {
      const active = JSON.parse(await fs.readFile(lockPath, "utf8"));
      assert.equal(active.pid, process.pid);
      return "acquired";
    });

    assert.equal(result, "acquired");
    await assert.rejects(fs.access(lockPath));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("shared write lock does not remove a lock that was replaced by another owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shared-lock-test-"));
  const codexHome = path.join(root, ".codex");

  try {
    const lockPath = lockPathFor(codexHome);
    const replacement = {
      schemaVersion: 1,
      owner: "vscode-extension",
      pid: process.pid,
      lockId: "replacement-lock",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await withSharedWriteLock(codexHome, "vscode-extension", async () => {
      await fs.writeFile(lockPath, JSON.stringify(replacement, null, 2), "utf8");
      return "replaced";
    });

    const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
    assert.equal(current.lockId, "replacement-lock");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
