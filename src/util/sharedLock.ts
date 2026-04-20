import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { deriveSharedLockPath } from "./sharedData";

type SharedWriteOwner = "vscode-extension";

type LockRecord = {
  schemaVersion: 1;
  owner: SharedWriteOwner;
  pid: number;
  createdAt: string;
};

async function readLock(lockPath: string): Promise<LockRecord | undefined> {
  try {
    return JSON.parse(await fs.readFile(lockPath, "utf8")) as LockRecord;
  } catch {
    return undefined;
  }
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
    createdAt: new Date().toISOString()
  };

  try {
    const handle = await fs.open(lockPath, "wx");
    try {
      await handle.writeFile(JSON.stringify(payload, null, 2), "utf8");
    } finally {
      await handle.close();
    }
  } catch {
    const current = await readLock(lockPath);
    const holder = current ? `${current.owner} pid=${current.pid}` : "unknown";
    throw new Error(`共享数据正在被其它客户端写入，请稍后重试（lock: ${holder}）。`);
  }

  try {
    return await action();
  } finally {
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export function currentMachineLabel(): string {
  return `${os.hostname()}#${process.pid}`;
}
