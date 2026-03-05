import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { ClientProvider, ImportResult } from "../protocol/messages";
import { ErrorCode } from "../protocol/errors";
import { AUTH_FILES } from "./constants";
import { copyFileIfExists, ensureDir, statSafe } from "./fileTree";
import { mergeHistoryJsonl } from "./historyMerge";
import { resolveBackupLayout, resolveCompatSourceDir } from "./layout";
import { mergeDirectoryDetailed } from "./merger";
import { getProvider, normalizeSelectedProviders } from "./providers";
import { replaceStateFiles } from "./stateReplace";
import { timestampLocal } from "../util/time";
import { extractZipToDirectory } from "./zip";

export async function runImport(params: {
  codexHome: string;
  backupZip: string;
  selectedProviders?: ClientProvider[];
  replaceState: boolean;
  importAuth: boolean;
  mode: "core";
}): Promise<ImportResult> {
  const backupZip = path.resolve(params.backupZip);
  if (!(await statSafe(backupZip))?.isFile()) {
    const err = new Error(`备份 ZIP 不存在: ${backupZip}`) as Error & { code: ErrorCode };
    err.code = ErrorCode.BackupZipNotFound;
    throw err;
  }

  const codexHome = path.resolve(params.codexHome);
  await ensureDir(codexHome);

  const stamp = timestampLocal();
  const extractRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-import-"));
  const selectedProviders = normalizeSelectedProviders(params.selectedProviders);
  const warnings: string[] = [];

  try {
    await extractZipToDirectory(backupZip, extractRoot);
    const layout = await resolveBackupLayout(extractRoot);
    const codexProviderRoot = path.join(extractRoot, "payload", "providers", "codex", "core");
    const codexRoot = (await statSafe(codexProviderRoot))?.isDirectory() ? codexProviderRoot : layout.coreRoot;
    const sessionsSource = await resolveCompatSourceDir(codexRoot, "sessions");
    const rulesSource = await resolveCompatSourceDir(codexRoot, "rules");
    const skillsSource = await resolveCompatSourceDir(codexRoot, "skills");

    const emptyStats = { newCount: 0, sameCount: 0, conflictCount: 0, lockedCount: 0 };
    let sessionsResult = { stats: emptyStats, conflictSamples: [] as string[], lockedSamples: [] as string[] };
    let rulesResult = { stats: emptyStats, conflictSamples: [] as string[], lockedSamples: [] as string[] };
    let skillsResult = { stats: emptyStats, conflictSamples: [] as string[], lockedSamples: [] as string[] };
    let history = { appended: 0, same: 0 };
    const editorConflictSamples: string[] = [];
    const editorLockedSamples: string[] = [];
    if (selectedProviders.includes("codex")) {
      sessionsResult = await mergeDirectoryDetailed(sessionsSource, path.join(codexHome, "sessions"), stamp);
      rulesResult = await mergeDirectoryDetailed(rulesSource, path.join(codexHome, "rules"), stamp);
      skillsResult = await mergeDirectoryDetailed(skillsSource, path.join(codexHome, "skills"), stamp);
      history = await mergeHistoryJsonl(path.join(codexRoot, "history.jsonl"), path.join(codexHome, "history.jsonl"));
    }

    const sourceConfig = path.join(codexRoot, "config.toml");
    const targetConfig = path.join(codexHome, "config.toml");
    if (selectedProviders.includes("codex") && (await statSafe(sourceConfig))?.isFile()) {
      if ((await statSafe(targetConfig))?.isFile()) {
        warnings.push("目标目录已存在 config.toml，已跳过覆盖。");
      } else {
        await copyFileIfExists(sourceConfig, targetConfig);
      }
    }

    if (selectedProviders.includes("codex") && params.replaceState) {
      const stateMessage = await replaceStateFiles(codexRoot, codexHome, stamp);
      warnings.push(stateMessage);
    }

    if (selectedProviders.includes("codex") && params.importAuth) {
      let importedAuthCount = 0;
      for (const fileName of AUTH_FILES) {
        const copied = await copyFileIfExists(path.join(codexRoot, fileName), path.join(codexHome, fileName));
        if (copied) {
          importedAuthCount += 1;
        }
      }
      if (importedAuthCount === 0) {
        warnings.push("已启用 auth 导入，但备份中未发现 auth.json/cap_sid。");
      }
    }

    const extraProviders = selectedProviders.filter((item) => item !== "codex");
    for (const providerId of extraProviders) {
      const provider = getProvider(providerId);
      const targets = provider.resolveTargets(codexHome);
      let hasMerged = false;
      for (const target of targets) {
        const sourceDir = path.join(extractRoot, "payload", "providers", providerId, target.key);
        if (!(await statSafe(sourceDir))?.isDirectory()) {
          continue;
        }
        await ensureDir(target.destinationPath);
        const merged = await mergeDirectoryDetailed(sourceDir, target.destinationPath, stamp);
        hasMerged = true;
        for (const sample of merged.conflictSamples) {
          if (editorConflictSamples.length < 60) {
            editorConflictSamples.push(`${providerId}/${target.key}/${sample}`);
          }
        }
        for (const sample of merged.lockedSamples) {
          if (editorLockedSamples.length < 60) {
            editorLockedSamples.push(`${providerId}/${target.key}/${sample}`);
          }
        }
      }
      if (!hasMerged) {
        warnings.push(`备份中未找到 ${provider.label} 可导入目录。`);
      }
    }

    return {
      codexHome,
      backupZip,
      selectedProviders,
      mode: params.mode,
      sessions: sessionsResult.stats,
      rules: rulesResult.stats,
      skills: skillsResult.stats,
      history,
      conflictSamples: {
        sessions: sessionsResult.conflictSamples,
        rules: rulesResult.conflictSamples,
        skills: skillsResult.conflictSamples,
        editorState: editorConflictSamples
      },
      lockedSamples: {
        sessions: sessionsResult.lockedSamples,
        rules: rulesResult.lockedSamples,
        skills: skillsResult.lockedSamples,
        editorState: editorLockedSamples
      },
      warnings,
      reportPath: path.join(codexHome, "migration-reports", `report-${stamp}.json`)
    };
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true });
  }
}
