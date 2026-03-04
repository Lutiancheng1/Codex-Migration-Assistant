import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { ExportResult } from "../protocol/messages";
import { AUTH_FILES, BACKUP_FORMAT, CORE_DIRS, CORE_TEXT_FILES } from "./constants";
import { resolveProfileAuthLabel, toSafeBackupUserLabel } from "./authLabel";
import { copyDirectoryContentIfExists, copyFileIfExists, ensureDir } from "./fileTree";
import { discoverLocalEditorSource } from "./layout";
import { timestampLocal } from "../util/time";
import { createZipFromDirectory } from "./zip";

async function resolveBackupUserLabel(codexHome: string): Promise<string> {
  let fallback = "user";
  try {
    fallback = toSafeBackupUserLabel(os.userInfo().username || "user");
  } catch {
    fallback = "user";
  }

  const authLabel = await resolveProfileAuthLabel(codexHome);
  if (authLabel) {
    return toSafeBackupUserLabel(authLabel);
  }

  return fallback;
}

function isStateFilename(name: string): boolean {
  return /^state_.*\.sqlite(?:-wal|-shm)?$/.test(name);
}

async function listTopLevelStateFiles(codexHome: string): Promise<string[]> {
  const entries = await fs.readdir(codexHome, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isStateFilename(entry.name))
    .map((entry) => path.join(codexHome, entry.name));
}

export async function runExport(params: {
  codexHome: string;
  outputDir: string;
  includeState: boolean;
  includeAuth: boolean;
  mode: "core" | "enhanced";
}): Promise<ExportResult> {
  const stamp = timestampLocal();
  const userLabel = await resolveBackupUserLabel(params.codexHome);
  const outputDir = path.resolve(params.outputDir);
  const zipPath = path.join(outputDir, `codex-backup-${userLabel}-${stamp}.zip`);
  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), `codex-export-${stamp}-`));
  const coreRoot = path.join(stageRoot, "payload", "core");
  const copiedItems: string[] = [];

  try {
    await ensureDir(coreRoot);
    await ensureDir(outputDir);

    for (const name of CORE_TEXT_FILES) {
      const copied = await copyFileIfExists(path.join(params.codexHome, name), path.join(coreRoot, name));
      if (copied) {
        copiedItems.push(name);
      }
    }

    for (const name of CORE_DIRS) {
      const copied = await copyDirectoryContentIfExists(path.join(params.codexHome, name), path.join(coreRoot, name));
      if (copied) {
        copiedItems.push(name);
      }
    }

    if (params.includeState) {
      const stateFiles = await listTopLevelStateFiles(params.codexHome);
      for (const file of stateFiles) {
        await fs.copyFile(file, path.join(coreRoot, path.basename(file)));
      }
      if (stateFiles.length > 0) {
        copiedItems.push("state_*.sqlite*");
      }
    }

    if (params.includeAuth) {
      for (const name of AUTH_FILES) {
        const copied = await copyFileIfExists(path.join(params.codexHome, name), path.join(coreRoot, name));
        if (copied) {
          copiedItems.push(name);
        }
      }
    }

    const warnings: string[] = [];
    if (params.mode === "enhanced") {
      const editorState = await discoverLocalEditorSource();
      let copiedEditorPayloadCount = 0;
      if (editorState.editors.length === 0) {
        warnings.push("已启用增强模式，但未发现可识别的编辑器用户目录。");
      }

      for (const editor of editorState.editors) {
        const editorRoot = path.join(stageRoot, "payload", "editor", editor.editorId);
        let copiedForCurrentEditor = false;

        for (const storageDir of editor.codexGlobalStorageDirs) {
          const dirName = path.basename(storageDir);
          await copyDirectoryContentIfExists(storageDir, path.join(editorRoot, "globalStorage", dirName));
          copiedForCurrentEditor = true;
        }
        if (editor.codexGlobalStorageDirs.length > 0) {
          copiedItems.push(`editor/${editor.editorId}/globalStorage`);
        }

        for (const workspaceDir of editor.codexWorkspaceStorageDirs) {
          const workspaceId = path.basename(workspaceDir);
          await copyDirectoryContentIfExists(workspaceDir, path.join(editorRoot, "workspaceStorage", workspaceId));
          copiedForCurrentEditor = true;
        }
        if (editor.codexWorkspaceStorageDirs.length > 0) {
          copiedItems.push(`editor/${editor.editorId}/workspaceStorage`);
        }

        if (copiedForCurrentEditor) {
          copiedEditorPayloadCount += 1;
        }
      }

      if (editorState.editors.length > 0 && copiedEditorPayloadCount === 0) {
        warnings.push("已启用增强模式，但未发现任何 Codex 相关的编辑器状态目录。");
      }
    }

    const metadata = {
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      platform: process.platform,
      nodeVersion: process.version,
      codexHome: params.codexHome,
      mode: params.mode,
      backupUserLabel: userLabel,
      includeState: params.includeState,
      includeAuth: params.includeAuth,
      copiedItems,
      warnings
    };

    await fs.writeFile(path.join(stageRoot, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
    await createZipFromDirectory(stageRoot, zipPath);

    return {
      codexHome: params.codexHome,
      zipPath,
      mode: params.mode,
      copiedItems,
      warnings
    };
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true });
  }
}
