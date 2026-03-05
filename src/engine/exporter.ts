import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { ClientProvider, ExportResult } from "../protocol/messages";
import { AUTH_FILES, BACKUP_FORMAT, CORE_DIRS, CORE_TEXT_FILES } from "./constants";
import { resolveProfileAuthLabel, toSafeBackupUserLabel } from "./authLabel";
import { copyFileIfExists, ensureDir, listFilesRecursive, statSafe } from "./fileTree";
import { getProvider, normalizeSelectedProviders } from "./providers";
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
  selectedProviders?: ClientProvider[];
  includeState: boolean;
  includeAuth: boolean;
  mode: "core";
}): Promise<ExportResult> {
  const stamp = timestampLocal();
  const userLabel = await resolveBackupUserLabel(params.codexHome);
  const outputDir = path.resolve(params.outputDir);
  const zipPath = path.join(outputDir, `codex-backup-${userLabel}-${stamp}.zip`);
  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), `codex-export-${stamp}-`));
  const selectedProviders = normalizeSelectedProviders(params.selectedProviders);
  const copiedItems: string[] = [];

  async function copyDirectoryWithFilter(sourceDir: string, targetDir: string, shouldKeep: (relativePath: string) => boolean): Promise<number> {
    const sourceStat = await statSafe(sourceDir);
    if (!sourceStat?.isDirectory()) {
      return 0;
    }
    const files = await listFilesRecursive(sourceDir);
    let copied = 0;
    for (const sourceFile of files) {
      const relativePath = path.relative(sourceDir, sourceFile);
      if (!shouldKeep(relativePath)) {
        continue;
      }
      const targetFile = path.join(targetDir, relativePath);
      await ensureDir(path.dirname(targetFile));
      await fs.copyFile(sourceFile, targetFile);
      copied += 1;
    }
    return copied;
  }

  try {
    await ensureDir(outputDir);
    const warnings: string[] = [];
    for (const providerId of selectedProviders) {
      const provider = getProvider(providerId);
      const targets = provider.resolveTargets(params.codexHome);
      if (providerId === "codex") {
        const coreRoot = path.join(stageRoot, "payload", "providers", "codex", "core");
        await ensureDir(coreRoot);
        for (const name of CORE_TEXT_FILES) {
          const copied = await copyFileIfExists(path.join(params.codexHome, name), path.join(coreRoot, name));
          if (copied) {
            copiedItems.push(`codex/${name}`);
          }
        }
        for (const name of CORE_DIRS) {
          const count = await copyDirectoryWithFilter(
            path.join(params.codexHome, name),
            path.join(coreRoot, name),
            () => true
          );
          if (count > 0) {
            copiedItems.push(`codex/${name}`);
          }
        }
        if (params.includeState) {
          const stateFiles = await listTopLevelStateFiles(params.codexHome);
          for (const file of stateFiles) {
            await fs.copyFile(file, path.join(coreRoot, path.basename(file)));
          }
          if (stateFiles.length > 0) {
            copiedItems.push("codex/state_*.sqlite*");
          }
        }
        if (params.includeAuth) {
          for (const name of AUTH_FILES) {
            const copied = await copyFileIfExists(path.join(params.codexHome, name), path.join(coreRoot, name));
            if (copied) {
              copiedItems.push(`codex/${name}`);
            }
          }
        }
        continue;
      }

      let providerCopied = 0;
      for (const target of targets) {
        const stageDir = path.join(stageRoot, "payload", "providers", providerId, target.key);
        const copiedCount = await copyDirectoryWithFilter(target.sourcePath, stageDir, (relativePath) => {
          const filename = path.basename(relativePath);
          if (!params.includeAuth && /(auth|token|session|credential|cookies?|keychain|oauth|login)/i.test(relativePath)) {
            return false;
          }
          if (!params.includeState && /^state_.*\.sqlite(?:-wal|-shm)?$/i.test(filename)) {
            return false;
          }
          return true;
        });
        if (copiedCount > 0) {
          providerCopied += copiedCount;
          copiedItems.push(`${providerId}/${target.key}`);
        }
      }
      if (providerCopied === 0) {
        warnings.push(`${provider.label} 未检测到可导出的目录。`);
      }
    }

    const metadata = {
      format: "ai-client-backup-v1",
      compatFormat: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      platform: process.platform,
      nodeVersion: process.version,
      codexHome: params.codexHome,
      mode: params.mode,
      selectedProviders,
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
      selectedProviders,
      mode: params.mode,
      copiedItems,
      warnings
    };
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true });
  }
}
