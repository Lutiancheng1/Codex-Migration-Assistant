import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { ImportResult } from "../protocol/messages";
import { ErrorCode } from "../protocol/errors";
import { AUTH_FILES } from "./constants";
import { copyFileIfExists, ensureDir, statSafe } from "./fileTree";
import { mergeHistoryJsonl } from "./historyMerge";
import { discoverLocalEditorSource, resolveBackupLayout, resolveCompatSourceDir } from "./layout";
import { mergeDirectoryDetailed } from "./merger";
import { replaceStateFiles } from "./stateReplace";
import { timestampLocal } from "../util/time";
import { extractZipToDirectory } from "./zip";

export async function runImport(params: {
  codexHome: string;
  backupZip: string;
  replaceState: boolean;
  importAuth: boolean;
  mode: "core" | "enhanced";
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
  const warnings: string[] = [];

  try {
    await extractZipToDirectory(backupZip, extractRoot);
    const layout = await resolveBackupLayout(extractRoot);
    const sessionsSource = await resolveCompatSourceDir(layout.coreRoot, "sessions");
    const rulesSource = await resolveCompatSourceDir(layout.coreRoot, "rules");
    const skillsSource = await resolveCompatSourceDir(layout.coreRoot, "skills");

    const sessionsResult = await mergeDirectoryDetailed(sessionsSource, path.join(codexHome, "sessions"), stamp);
    const rulesResult = await mergeDirectoryDetailed(rulesSource, path.join(codexHome, "rules"), stamp);
    const skillsResult = await mergeDirectoryDetailed(skillsSource, path.join(codexHome, "skills"), stamp);
    const historyBase = await mergeHistoryJsonl(path.join(layout.coreRoot, "history.jsonl"), path.join(codexHome, "history.jsonl"));
    const sessionIndex = await mergeHistoryJsonl(
      path.join(layout.coreRoot, "session_index.jsonl"),
      path.join(codexHome, "session_index.jsonl")
    );
    const history = {
      appended: historyBase.appended + sessionIndex.appended,
      same: historyBase.same + sessionIndex.same
    };
    const editorConflictSamples: string[] = [];
    const editorLockedSamples: string[] = [];

    const sourceConfig = path.join(layout.coreRoot, "config.toml");
    const targetConfig = path.join(codexHome, "config.toml");
    if ((await statSafe(sourceConfig))?.isFile()) {
      if ((await statSafe(targetConfig))?.isFile()) {
        warnings.push("目标目录已存在 config.toml，已跳过覆盖。");
      } else {
        await copyFileIfExists(sourceConfig, targetConfig);
      }
    }

    if (params.replaceState) {
      const stateMessage = await replaceStateFiles(layout.coreRoot, codexHome, stamp);
      warnings.push(stateMessage);
    }

    if (params.importAuth) {
      let importedAuthCount = 0;
      for (const fileName of AUTH_FILES) {
        const copied = await copyFileIfExists(path.join(layout.coreRoot, fileName), path.join(codexHome, fileName));
        if (copied) {
          importedAuthCount += 1;
        }
      }
      if (importedAuthCount === 0) {
        warnings.push("已启用 auth 导入，但备份中未发现 auth.json/cap_sid。");
      }
    }

    if (params.mode === "enhanced") {
      if (layout.editors.length === 0) {
        warnings.push("已启用增强模式，但备份中未检测到编辑器状态数据。");
      } else {
        const localEditor = await discoverLocalEditorSource();
        for (const sourceEditor of layout.editors) {
          const targetEditor = localEditor.editors.find((item) => item.editorId === sourceEditor.editorId);
          if (!targetEditor) {
            warnings.push(`备份包含 ${sourceEditor.editorLabel} 编辑器状态，但本机未发现对应用户目录。`);
            continue;
          }

          if (sourceEditor.globalStorageDir && targetEditor.globalStorageDir) {
            const merged = await mergeDirectoryDetailed(sourceEditor.globalStorageDir, targetEditor.globalStorageDir, stamp);
            for (const sample of merged.conflictSamples) {
              if (editorConflictSamples.length < 60) {
                editorConflictSamples.push(`${sourceEditor.editorId}/globalStorage/${sample}`);
              }
            }
            for (const sample of merged.lockedSamples) {
              if (editorLockedSamples.length < 60) {
                editorLockedSamples.push(`${sourceEditor.editorId}/globalStorage/${sample}`);
              }
            }
          } else if (sourceEditor.globalStorageDir) {
            warnings.push(`${sourceEditor.editorLabel} 的 globalStorage 备份存在，但本机目录未找到。`);
          }

          if (sourceEditor.workspaceStorageDir && targetEditor.workspaceStorageDir) {
            const merged = await mergeDirectoryDetailed(sourceEditor.workspaceStorageDir, targetEditor.workspaceStorageDir, stamp);
            for (const sample of merged.conflictSamples) {
              if (editorConflictSamples.length < 60) {
                editorConflictSamples.push(`${sourceEditor.editorId}/workspaceStorage/${sample}`);
              }
            }
            for (const sample of merged.lockedSamples) {
              if (editorLockedSamples.length < 60) {
                editorLockedSamples.push(`${sourceEditor.editorId}/workspaceStorage/${sample}`);
              }
            }
          } else if (sourceEditor.workspaceStorageDir) {
            warnings.push(`${sourceEditor.editorLabel} 的 workspaceStorage 备份存在，但本机目录未找到。`);
          }
        }
      }
    }

    return {
      codexHome,
      backupZip,
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
