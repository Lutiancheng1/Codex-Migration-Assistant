import type { Stats } from "fs";
import * as fs from "fs/promises";
import * as path from "path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function statSafe(filePath: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}

export async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }

  const rootStat = await statSafe(root);
  if (!rootStat?.isDirectory()) {
    return out;
  }

  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

export async function copyFileIfExists(source: string, target: string): Promise<boolean> {
  const sourceStat = await statSafe(source);
  if (!sourceStat?.isFile()) {
    return false;
  }

  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
  return true;
}

export async function copyDirectoryContentIfExists(sourceDir: string, targetDir: string): Promise<boolean> {
  const sourceStat = await statSafe(sourceDir);
  if (!sourceStat?.isDirectory()) {
    return false;
  }

  const files = await listFilesRecursive(sourceDir);
  for (const file of files) {
    const rel = path.relative(sourceDir, file);
    const dst = path.join(targetDir, rel);
    await ensureDir(path.dirname(dst));
    await fs.copyFile(file, dst);
  }
  return true;
}

export async function countLines(filePath: string): Promise<number> {
  const content = await fs.readFile(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/).filter((line) => line.length > 0).length;
}
