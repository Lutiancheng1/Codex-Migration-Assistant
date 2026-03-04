import * as fs from "fs/promises";
import * as path from "path";
import { listFilesRecursive, statSafe } from "./fileTree";

function isStateFile(filePath: string): boolean {
  return /^state_.*\.sqlite(?:-wal|-shm)?$/.test(path.basename(filePath));
}

export async function listStateFilesInDir(dirPath: string): Promise<string[]> {
  if (!(await statSafe(dirPath))?.isDirectory()) {
    return [];
  }
  const files = await listFilesRecursive(dirPath);
  return files.filter((file) => isStateFile(file));
}

export async function replaceStateFiles(sourceRoot: string, codexHome: string, stamp: string): Promise<string> {
  const sourceStateFiles = (await listStateFilesInDir(sourceRoot)).filter((file) => path.dirname(file) === sourceRoot);
  if (sourceStateFiles.length === 0) {
    return "ReplaceState enabled, but no state_*.sqlite* files found in backup.";
  }

  const existing = (await listStateFilesInDir(codexHome)).filter((file) => path.dirname(file) === codexHome);
  if (existing.length > 0) {
    const backupDir = path.join(codexHome, `state-backup-${stamp}`);
    await fs.mkdir(backupDir, { recursive: true });
    for (const file of existing) {
      await fs.rename(file, path.join(backupDir, path.basename(file)));
    }
  }

  for (const sourceFile of sourceStateFiles) {
    const target = path.join(codexHome, path.basename(sourceFile));
    await fs.copyFile(sourceFile, target);
  }

  if (existing.length > 0) {
    return `State replaced. Previous state files moved to state-backup-${stamp}.`;
  }
  return "State replaced.";
}
