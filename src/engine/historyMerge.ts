import * as fs from "fs/promises";
import * as path from "path";
import { statSafe } from "./fileTree";

export type HistoryStats = {
  appended: number;
  same: number;
};

function splitLines(content: string): string[] {
  if (!content) {
    return [];
  }
  return content.split(/\r?\n/).filter((line) => line.length > 0);
}

export async function previewHistoryMerge(sourceFile: string, targetFile: string): Promise<HistoryStats> {
  const sourceStat = await statSafe(sourceFile);
  if (!sourceStat?.isFile()) {
    return { appended: 0, same: 0 };
  }

  const sourceLines = splitLines(await fs.readFile(sourceFile, "utf8"));
  const targetStat = await statSafe(targetFile);
  if (!targetStat?.isFile()) {
    return { appended: sourceLines.length, same: 0 };
  }

  const targetLines = new Set(splitLines(await fs.readFile(targetFile, "utf8")));
  let appended = 0;
  let same = 0;
  for (const line of sourceLines) {
    if (targetLines.has(line)) {
      same += 1;
    } else {
      appended += 1;
      targetLines.add(line);
    }
  }

  return { appended, same };
}

export async function mergeHistoryJsonl(sourceFile: string, targetFile: string): Promise<HistoryStats> {
  const sourceStat = await statSafe(sourceFile);
  if (!sourceStat?.isFile()) {
    return { appended: 0, same: 0 };
  }

  const sourceLines = splitLines(await fs.readFile(sourceFile, "utf8"));
  await fs.mkdir(path.dirname(targetFile), { recursive: true });

  const targetStat = await statSafe(targetFile);
  if (!targetStat?.isFile()) {
    const payload = sourceLines.length > 0 ? `${sourceLines.join("\n")}\n` : "";
    await fs.writeFile(targetFile, payload, "utf8");
    return { appended: sourceLines.length, same: 0 };
  }

  const existing = new Set(splitLines(await fs.readFile(targetFile, "utf8")));
  const appendLines: string[] = [];
  let same = 0;

  for (const line of sourceLines) {
    if (existing.has(line)) {
      same += 1;
      continue;
    }
    existing.add(line);
    appendLines.push(line);
  }

  if (appendLines.length > 0) {
    await fs.appendFile(targetFile, `${appendLines.join("\n")}\n`, "utf8");
  }

  return { appended: appendLines.length, same };
}
