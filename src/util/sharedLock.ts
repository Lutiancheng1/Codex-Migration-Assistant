import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { deriveSharedLockPath } from "./sharedData";

type SharedWriteOwner = "vscode-extension";

type LockRecord = {
  schemaVersion: 1;
  owner: SharedWriteOwner;
  pid: number;
  lockId?: string;
  createdAt: string;
  updatedAt?: string;
};

async function readLock(lockPath: string): Promise<LockRecord | undefined> {
  try {
    return JSON.parse(await fs.readFile(lockPath, "utf8")) as LockRecord;
  } catch {
    return undefined;
  }
}

const STALE_LOCK_AFTER_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 10 * 1000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isLockTooOld(record: LockRecord, now = Date.now()): boolean {
  const checkedAt = Date.parse(record.updatedAt ?? record.createdAt);
  if (!Number.isFinite(checkedAt)) {
    return true;
  }
  return now - checkedAt > STALE_LOCK_AFTER_MS;
}

export async function withSharedWriteLock<T>(
  codexHome: string,
  owner: SharedWriteOwner,
  action: () => Promise<T>
): Promise<T> {
  const lockPath = deriveSharedLockPath(codexHome);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const payload: LockRecord = {
    schemaVersion: 1,
    owner,
    pid: process.pid,
    lockId: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  let acquired = false;
  const tryAcquire = async () => {
    const handle = await fs.open(lockPath, "wx");
    try {
      await handle.writeFile(JSON.stringify(payload, null, 2), "utf8");
      acquired = true;
    } finally {
      await handle.close();
    }
  };

  try {
    await tryAcquire();
  } catch {
    const current = await readLock(lockPath);
    let isStale = false;

    if (current && typeof current.pid === "number") {
      if (!isProcessAlive(current.pid) || isLockTooOld(current)) {
        isStale = true;
      }
    } else if (current) {
      isStale = true;
    }

    if (isStale) {
      try {
        await fs.rm(lockPath, { force: true });
        await tryAcquire();
      } catch {
        // Fall back to throw below if retry fails
      }
    }

    if (!acquired) {
      const holder = current ? `${current.owner} pid=${current.pid}` : "unknown";
      throw new Error(`共享数据正在被其它客户端写入，请稍后重试（lock: ${holder}）。`);
    }
  }

  let heartbeat: NodeJS.Timeout | undefined;
  try {
    heartbeat = setInterval(() => {
      void (async () => {
        const current = await readLock(lockPath);
        if (current?.lockId !== payload.lockId) {
          return;
        }
        const refreshed = {
          ...payload,
          updatedAt: new Date().toISOString()
        };
        await fs.writeFile(lockPath, JSON.stringify(refreshed, null, 2), "utf8");
      })().catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();
    return await action();
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    const current = await readLock(lockPath);
    if (!current?.lockId || current.lockId === payload.lockId) {
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}

export function currentMachineLabel(): string {
  return `${os.hostname()}#${process.pid}`;
}
