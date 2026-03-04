import * as fs from "fs/promises";
import * as path from "path";
import type { Stats } from "../protocol/messages";
import { sha256File } from "./hash";
import { ensureDir, listFilesRecursive, statSafe } from "./fileTree";

export type MergeOutcome = {
  stats: Stats;
  conflictSamples: string[];
  lockedSamples: string[];
};

const SAMPLE_LIMIT = 60;

function zeroOutcome(): MergeOutcome {
  return {
    stats: {
      newCount: 0,
      sameCount: 0,
      conflictCount: 0,
      lockedCount: 0
    },
    conflictSamples: [],
    lockedSamples: []
  };
}

function isLockError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const code = (err as { code?: string }).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function compareFile(source: string, dest: string): Promise<"same" | "different" | "locked"> {
  try {
    const [srcHash, destHash] = await Promise.all([sha256File(source), sha256File(dest)]);
    return srcHash === destHash ? "same" : "different";
  } catch (err) {
    if (isLockError(err)) {
      return "locked";
    }
    throw err;
  }
}

export async function scanDirectoryDiff(sourceDir: string, targetDir: string): Promise<Stats> {
  const result = await scanDirectoryDiffDetailed(sourceDir, targetDir);
  return result.stats;
}

export async function scanDirectoryDiffDetailed(sourceDir: string, targetDir: string): Promise<MergeOutcome> {
  const out = zeroOutcome();
  if (!(await statSafe(sourceDir))?.isDirectory()) {
    return out;
  }

  const files = await listFilesRecursive(sourceDir);
  for (const sourceFile of files) {
    const rel = path.relative(sourceDir, sourceFile);
    const destFile = path.join(targetDir, rel);
    const destStat = await statSafe(destFile);
    const relPosix = rel.split(path.sep).join(path.posix.sep);

    if (!destStat?.isFile()) {
      out.stats.newCount += 1;
      continue;
    }

    const comparison = await compareFile(sourceFile, destFile);
    if (comparison === "locked") {
      out.stats.lockedCount += 1;
      if (out.lockedSamples.length < SAMPLE_LIMIT) {
        out.lockedSamples.push(relPosix);
      }
      continue;
    }
    if (comparison === "same") {
      out.stats.sameCount += 1;
      continue;
    }
    out.stats.conflictCount += 1;
    if (out.conflictSamples.length < SAMPLE_LIMIT) {
      out.conflictSamples.push(relPosix);
    }
  }

  return out;
}

export async function mergeDirectory(sourceDir: string, targetDir: string, stamp: string): Promise<Stats> {
  const result = await mergeDirectoryDetailed(sourceDir, targetDir, stamp);
  return result.stats;
}

export async function mergeDirectoryDetailed(sourceDir: string, targetDir: string, stamp: string): Promise<MergeOutcome> {
  const out = zeroOutcome();
  if (!(await statSafe(sourceDir))?.isDirectory()) {
    return out;
  }

  const files = await listFilesRecursive(sourceDir);
  for (const sourceFile of files) {
    const rel = path.relative(sourceDir, sourceFile);
    const destFile = path.join(targetDir, rel);
    const relPosix = rel.split(path.sep).join(path.posix.sep);
    await ensureDir(path.dirname(destFile));

    const destStat = await statSafe(destFile);
    if (!destStat?.isFile()) {
      try {
        await fs.copyFile(sourceFile, destFile);
        out.stats.newCount += 1;
      } catch (err) {
        if (isLockError(err)) {
          out.stats.lockedCount += 1;
          if (out.lockedSamples.length < SAMPLE_LIMIT) {
            out.lockedSamples.push(relPosix);
          }
          continue;
        }
        throw err;
      }
      continue;
    }

    const comparison = await compareFile(sourceFile, destFile);
    if (comparison === "locked") {
      out.stats.lockedCount += 1;
      if (out.lockedSamples.length < SAMPLE_LIMIT) {
        out.lockedSamples.push(relPosix);
      }
      continue;
    }

    if (comparison === "same") {
      out.stats.sameCount += 1;
      continue;
    }

    const parsed = path.parse(destFile);
    let conflictPath = path.join(parsed.dir, `${parsed.name}-imported-${stamp}${parsed.ext}`);
    let index = 1;
    while ((await statSafe(conflictPath))?.isFile()) {
      conflictPath = path.join(parsed.dir, `${parsed.name}-imported-${stamp}-${index}${parsed.ext}`);
      index += 1;
    }

    try {
      await fs.copyFile(sourceFile, conflictPath);
      out.stats.conflictCount += 1;
      if (out.conflictSamples.length < SAMPLE_LIMIT) {
        out.conflictSamples.push(relPosix);
      }
    } catch (err) {
      if (isLockError(err)) {
        out.stats.lockedCount += 1;
        if (out.lockedSamples.length < SAMPLE_LIMIT) {
          out.lockedSamples.push(relPosix);
        }
        continue;
      }
      throw err;
    }
  }

  return out;
}
