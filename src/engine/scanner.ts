import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { PreviewResult } from "../protocol/messages";
import { ErrorCode } from "../protocol/errors";
import { previewHistoryMerge } from "./historyMerge";
import { discoverLocalEditorSource, resolveBackupLayout, resolveCompatSourceDir } from "./layout";
import { scanDirectoryDiffDetailed } from "./merger";
import { extractZipToDirectory } from "./zip";
import { statSafe } from "./fileTree";

export async function previewImport(params: {
  codexHome: string;
  backupZip: string;
  mode: "core" | "enhanced";
  replaceState: boolean;
  importAuth: boolean;
}): Promise<PreviewResult> {
  const backupZip = path.resolve(params.backupZip);
  if (!(await statSafe(backupZip))?.isFile()) {
    const err = new Error(`备份 ZIP 不存在: ${backupZip}`) as Error & { code: ErrorCode };
    err.code = ErrorCode.BackupZipNotFound;
    throw err;
  }

  const codexHome = path.resolve(params.codexHome);
  const extractRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-preview-"));
  try {
    await extractZipToDirectory(backupZip, extractRoot);
    const layout = await resolveBackupLayout(extractRoot);
    const sessionsSource = await resolveCompatSourceDir(layout.coreRoot, "sessions");
    const rulesSource = await resolveCompatSourceDir(layout.coreRoot, "rules");
    const skillsSource = await resolveCompatSourceDir(layout.coreRoot, "skills");

    const sessionsResult = await scanDirectoryDiffDetailed(sessionsSource, path.join(codexHome, "sessions"));
    const rulesResult = await scanDirectoryDiffDetailed(rulesSource, path.join(codexHome, "rules"));
    const skillsResult = await scanDirectoryDiffDetailed(skillsSource, path.join(codexHome, "skills"));
    const history = await previewHistoryMerge(path.join(layout.coreRoot, "history.jsonl"), path.join(codexHome, "history.jsonl"));
    const editorConflictSamples: string[] = [];
    const editorLockedSamples: string[] = [];

    const warnings: string[] = [];
    if (!(await statSafe(codexHome))?.isDirectory()) {
      warnings.push("目标 Codex 目录不存在，预演统计将按空目录计算。");
    }
    if (params.replaceState) {
      warnings.push("已启用替换 state，现有 state_*.sqlite* 将移动到 state-backup-{timestamp}。");
    }
    if (params.importAuth) {
      warnings.push("已启用 auth 导入，仅建议用于同账号迁移。");
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
            const scanned = await scanDirectoryDiffDetailed(sourceEditor.globalStorageDir, targetEditor.globalStorageDir);
            for (const sample of scanned.conflictSamples) {
              if (editorConflictSamples.length < 60) {
                editorConflictSamples.push(`${sourceEditor.editorId}/globalStorage/${sample}`);
              }
            }
            for (const sample of scanned.lockedSamples) {
              if (editorLockedSamples.length < 60) {
                editorLockedSamples.push(`${sourceEditor.editorId}/globalStorage/${sample}`);
              }
            }
          }

          if (sourceEditor.workspaceStorageDir && targetEditor.workspaceStorageDir) {
            const scanned = await scanDirectoryDiffDetailed(sourceEditor.workspaceStorageDir, targetEditor.workspaceStorageDir);
            for (const sample of scanned.conflictSamples) {
              if (editorConflictSamples.length < 60) {
                editorConflictSamples.push(`${sourceEditor.editorId}/workspaceStorage/${sample}`);
              }
            }
            for (const sample of scanned.lockedSamples) {
              if (editorLockedSamples.length < 60) {
                editorLockedSamples.push(`${sourceEditor.editorId}/workspaceStorage/${sample}`);
              }
            }
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
      warnings
    };
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true });
  }
}
