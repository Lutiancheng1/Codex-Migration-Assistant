import * as vscode from "vscode";
import type { Dirent } from "fs";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { runExport } from "../engine/exporter";
import { runImport } from "../engine/importer";
import { activateProfile, createProfile, deleteProfile, getProfilesSnapshot, refreshProfilesUsage, type ProfilesSnapshot } from "../engine/profiles";
import { writeReportBundle } from "../engine/report";
import { previewImport } from "../engine/scanner";
import { forceKillProcesses, relaunchKilledProcesses } from "../engine/processGuard";
import { asAppError, ErrorCode } from "../protocol/errors";
import type { ExportResult, ExportScope, RequestMessage, ResponseMessage } from "../protocol/messages";
import { requestSchema } from "../protocol/schema";
import { resolveAndValidateCodexHome } from "../engine/codexHome";
import { resolveCodexHome } from "../util/path";
import { getLogger } from "../util/logger";

function send(webview: vscode.Webview, message: ResponseMessage): void {
  void webview.postMessage(message);
}

function emitTaskLog(webview: vscode.Webview, level: "info" | "warn" | "error", message: string): void {
  send(webview, { type: "TASK_LOG", payload: { level, message } });
}

async function pickPath(webview: vscode.Webview, kind: "folder" | "file", title: string, filters?: Record<string, string[]>): Promise<void> {
  const options: vscode.OpenDialogOptions = {
    title,
    canSelectMany: false,
    canSelectFiles: kind === "file",
    canSelectFolders: kind === "folder",
    filters
  };

  const picked = await vscode.window.showOpenDialog(options);
  send(webview, { type: "PATH_PICKED", payload: { path: picked?.[0]?.fsPath } });
}

type ZipCandidate = {
  fullPath: string;
  fileName: string;
  mtimeMs: number;
  size: number;
};

async function ensureDirectory(pathname: string): Promise<boolean> {
  try {
    const st = await fs.stat(pathname);
    if (!st.isDirectory()) {
      throw new Error(`Not a directory: ${pathname}`);
    }
    return false;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
    await fs.mkdir(pathname, { recursive: true });
    return true;
  }
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

async function statSafe(pathname: string): Promise<import("fs").Stats | undefined> {
  try {
    return await fs.stat(pathname);
  } catch {
    return undefined;
  }
}

async function resolveBackupDirectoryInput(rawDirectory?: string): Promise<{ requested?: string; backupDir: string; normalizedFromFile: boolean }> {
  const requested = rawDirectory?.trim();
  const defaultDir = path.resolve(os.homedir(), "codex-backup");
  if (!requested) {
    return { requested: undefined, backupDir: defaultDir, normalizedFromFile: false };
  }

  const candidate = path.resolve(requested);
  if (candidate.toLowerCase().endsWith(".zip")) {
    return { requested: candidate, backupDir: path.dirname(candidate), normalizedFromFile: true };
  }

  try {
    const st = await fs.stat(candidate);
    if (st.isFile()) {
      return { requested: candidate, backupDir: path.dirname(candidate), normalizedFromFile: true };
    }
  } catch {
    // ignore stat error and keep original candidate
  }

  return { requested: candidate, backupDir: candidate, normalizedFromFile: false };
}

async function pickBackupFromDefaultDirectory(webview: vscode.Webview, directory?: string): Promise<void> {
  const resolved = await resolveBackupDirectoryInput(directory);
  const backupDir = resolved.backupDir;
  let entries: Dirent[];

  try {
    if (resolved.normalizedFromFile && resolved.requested) {
      emitTaskLog(webview, "info", `检测到传入 ZIP 文件路径，已自动切换到父目录: ${backupDir}`);
    }
    const created = await ensureDirectory(backupDir);
    if (created) {
      emitTaskLog(webview, "info", `已创建默认导出目录: ${backupDir}`);
    }
    entries = await fs.readdir(backupDir, { withFileTypes: true });
  } catch {
    emitTaskLog(webview, "warn", `无法访问导出目录: ${backupDir}`);
    send(webview, { type: "PATH_PICKED", payload: {} });
    return;
  }

  const zipCandidates: ZipCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.toLowerCase().endsWith(".zip")) {
      continue;
    }
    const fullPath = path.join(backupDir, entry.name);
    try {
      const st = await fs.stat(fullPath);
      zipCandidates.push({
        fullPath,
        fileName: entry.name,
        mtimeMs: st.mtimeMs,
        size: st.size
      });
    } catch {
      // ignore unreadable candidate
    }
  }

  if (zipCandidates.length === 0) {
    emitTaskLog(webview, "info", `目录中未发现备份 ZIP: ${backupDir}`);
    send(webview, { type: "PATH_PICKED", payload: {} });
    return;
  }

  zipCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (zipCandidates.length === 1) {
    send(webview, { type: "PATH_PICKED", payload: { path: zipCandidates[0].fullPath } });
    emitTaskLog(webview, "info", `已自动选择备份: ${zipCandidates[0].fileName}`);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    zipCandidates.map((item) => ({
      label: item.fileName,
      description: `${formatTime(item.mtimeMs)} · ${formatBytes(item.size)}`,
      detail: item.fullPath,
      value: item.fullPath
    })),
    {
      title: "选择备份 ZIP（默认导出目录）",
      placeHolder: `共 ${zipCandidates.length} 个备份文件`
    }
  );

  send(webview, { type: "PATH_PICKED", payload: { path: picked?.value } });
}

type ExportTarget = {
  profileId: string;
  profileName: string;
  codexHome: string;
};

function normalizeExportScope(scope?: ExportScope, profileId?: string): ExportScope {
  if (scope) {
    return scope;
  }
  if (profileId && profileId.trim().length > 0) {
    return "single";
  }
  return "active";
}

function resolveExportTargets(
  snapshot: ProfilesSnapshot,
  codexHome: string,
  scope: ExportScope,
  profileId?: string
): ExportTarget[] {
  if (scope === "all") {
    const available = snapshot.profiles.filter((item) => item.exists);
    if (available.length === 0) {
      throw new Error("未找到可导出的账号槽位。");
    }
    return available.map((item) => ({
      profileId: item.id,
      profileName: item.name,
      codexHome: item.path
    }));
  }

  if (scope === "single") {
    const requestedProfileId = profileId?.trim();
    if (!requestedProfileId) {
      throw new Error("单账号导出缺少 profileId。");
    }
    const target = snapshot.profiles.find((item) => item.id === requestedProfileId);
    if (!target) {
      throw new Error(`未找到账号槽位: ${requestedProfileId}`);
    }
    if (!target.exists) {
      throw new Error(`账号目录不存在: ${target.path}`);
    }
    return [
      {
        profileId: target.id,
        profileName: target.name,
        codexHome: target.path
      }
    ];
  }

  if (snapshot.activeProfileId) {
    const active = snapshot.profiles.find((item) => item.id === snapshot.activeProfileId && item.exists);
    if (active) {
      return [
        {
          profileId: active.id,
          profileName: active.name,
          codexHome: active.path
        }
      ];
    }
  }

  const live = snapshot.profiles.find((item) => item.id === "live" && item.exists);
  if (live) {
    return [
      {
        profileId: live.id,
        profileName: live.name,
        codexHome: live.path
      }
    ];
  }

  return [
    {
      profileId: snapshot.activeProfileId ?? "active",
      profileName: "当前账号",
      codexHome
    }
  ];
}

type WebviewTarget = { webview: vscode.Webview };
let emittedUninitializedHint = false;
let pendingRelaunchCommands: string[] = [];

function resolveCreatedProfile(
  before: ProfilesSnapshot,
  after: ProfilesSnapshot,
  expectedName: string
): { id: string; name: string; path: string } | undefined {
  const beforeIds = new Set(before.profiles.map((item) => item.id));
  const candidates = after.profiles.filter((item) => !beforeIds.has(item.id));
  if (candidates.length === 0) {
    return undefined;
  }
  const exactName = candidates.find((item) => item.name === expectedName);
  if (exactName) {
    return { id: exactName.id, name: exactName.name, path: exactName.path };
  }
  const sorted = [...candidates].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const picked = sorted[0];
  return picked ? { id: picked.id, name: picked.name, path: picked.path } : undefined;
}

async function resolveDefaultOutputDir(): Promise<string> {
  const defaultOutputDir = path.resolve(os.homedir(), "codex-backup");
  try {
    await ensureDirectory(defaultOutputDir);
  } catch {
    // non-fatal
  }
  return defaultOutputDir;
}

async function emitSnapshot(webview: vscode.Webview, snapshot: ProfilesSnapshot): Promise<void> {
  send(webview, {
    type: "STATE_SNAPSHOT",
    payload: {
      codexHome: snapshot.codexHome,
      platform: process.platform,
      defaultOutputDir: await resolveDefaultOutputDir(),
      profilesRoot: snapshot.profilesRoot,
      activeProfileId: snapshot.activeProfileId,
      profiles: snapshot.profiles
    }
  });
  for (const message of snapshot.messages) {
    if (message.includes("未初始化多账号")) {
      if (emittedUninitializedHint) {
        continue;
      }
      emittedUninitializedHint = true;
    }
    emitTaskLog(webview, "info", message);
  }
}

async function emitStateSnapshot(webview: vscode.Webview, codexHomeOverride?: string): Promise<void> {
  const codexHome = resolveCodexHome(codexHomeOverride);
  const snapshot = await getProfilesSnapshot(codexHome);
  await emitSnapshot(webview, snapshot);
}

export function bindBridge(target: WebviewTarget): vscode.Disposable {
  return target.webview.onDidReceiveMessage(async (raw: unknown) => {
    const logger = getLogger();
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      send(target.webview, {
        type: "TASK_ERROR",
        payload: {
          code: ErrorCode.InvalidMessage,
          message: "请求参数无效",
          details: { issues: parsed.error.issues }
        }
      });
      return;
    }

    const msg = parsed.data as RequestMessage;

    try {
      if (msg.type === "INIT") {
        await emitStateSnapshot(target.webview);
        return;
      }

      if (msg.type === "REFRESH_PROFILES") {
        await emitStateSnapshot(target.webview, msg.payload?.codexHome);
        return;
      }

      if (msg.type === "REFRESH_PROFILE_USAGE") {
        const codexHome = resolveCodexHome(msg.payload?.codexHome);
        const snapshot = await refreshProfilesUsage(codexHome, msg.payload?.profileId);
        await emitSnapshot(target.webview, snapshot);
        return;
      }

      if (msg.type === "CREATE_PROFILE") {
        const codexHome = resolveCodexHome(msg.payload.codexHome);
        const snapshot = await createProfile(codexHome, msg.payload.name);
        await emitSnapshot(target.webview, snapshot);
        return;
      }

      if (msg.type === "ACTIVATE_PROFILE") {
        const codexHome = resolveCodexHome(msg.payload.codexHome);
        send(target.webview, {
          type: "TASK_PROGRESS",
          payload: { step: "switch-profile", percent: 10, message: "准备切换账号" }
        });
        const snapshot = await activateProfile(
          codexHome,
          msg.payload.profileId,
          msg.payload.backupCurrent,
          msg.payload.mergeFromCurrentCore ?? false
        );
        send(target.webview, {
          type: "TASK_PROGRESS",
          payload: { step: "switch-profile", percent: 80, message: "账号切换完成，正在刷新状态" }
        });
        await emitSnapshot(target.webview, snapshot);
        let relaunchedClients: string[] = [];
        if (pendingRelaunchCommands.length > 0) {
          const result = await relaunchKilledProcesses(pendingRelaunchCommands);
          relaunchedClients = result.succeeded;
          if (result.attempted.length > 0) {
            emitTaskLog(target.webview, "info", `已尝试恢复启动客户端: ${result.attempted.join(", ")}`);
          }
          if (result.succeeded.length > 0) {
            emitTaskLog(target.webview, "info", `恢复启动成功: ${result.succeeded.join(", ")}`);
          }
          if (result.failed.length > 0) {
            emitTaskLog(target.webview, "warn", `恢复启动失败: ${result.failed.join(", ")}（可手动打开）`);
          }
          pendingRelaunchCommands = [];
        }
        send(target.webview, {
          type: "TASK_PROGRESS",
          payload: { step: "switch-profile", percent: 100, message: "切换完成" }
        });
        send(target.webview, {
          type: "TASK_RESULT",
          payload: {
            action: "switchProfile",
            data: {
              codexHome,
              targetProfileId: msg.payload.profileId,
              backupCurrent: msg.payload.backupCurrent,
              mergeFromCurrentCore: msg.payload.mergeFromCurrentCore ?? false,
              relaunchedClients,
              messages: snapshot.messages
            }
          }
        });
        emitTaskLog(target.webview, "warn", "账号已切换。请重启 Codex App 或执行 Reload Window 以加载新账号会话。");
        return;
      }

      if (msg.type === "DELETE_PROFILE") {
        const codexHome = resolveCodexHome(msg.payload.codexHome);
        const snapshot = await deleteProfile(codexHome, msg.payload.profileId);
        await emitSnapshot(target.webview, snapshot);
        return;
      }

      if (msg.type === "PICK_PATH") {
        await pickPath(target.webview, msg.payload.kind, msg.payload.title, msg.payload.filters);
        return;
      }

      if (msg.type === "PICK_DEFAULT_BACKUP") {
        await pickBackupFromDefaultDirectory(target.webview, msg.payload?.directory);
        return;
      }

      if (msg.type === "OPEN_IN_OS") {
        const rawPath = msg.payload.path.trim();
        if (rawPath.length === 0) {
          return;
        }
        const resolved = path.resolve(rawPath);
        const st = await statSafe(resolved);
        let revealPath: string | undefined;
        if (st?.isDirectory()) {
          revealPath = resolved;
        } else if (st?.isFile()) {
          revealPath = path.dirname(resolved);
        } else if (resolved.toLowerCase().endsWith(".zip")) {
          const parent = path.dirname(resolved);
          if ((await statSafe(parent))?.isDirectory()) {
            revealPath = parent;
          }
        }
        if (revealPath) {
          await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(revealPath));
        }
        return;
      }

      if (msg.type === "START_EXPORT" && (msg.payload.scope || msg.payload.profileId)) {
        const codexHome = await resolveAndValidateCodexHome(msg.payload.codexHome);
        const scope = normalizeExportScope(msg.payload.scope, msg.payload.profileId);
        const snapshot = await getProfilesSnapshot(codexHome);
        const exportTargets = resolveExportTargets(snapshot, codexHome, scope, msg.payload.profileId);
        emitTaskLog(target.webview, "info", `开始导出（模式=${msg.payload.mode}, 范围=${scope}）`);
        emitTaskLog(target.webview, "info", `Codex 目录: ${codexHome}`);
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "export", percent: 10, message: "准备导出" } });
        if (scope === "all") {
          emitTaskLog(target.webview, "info", `将按账号逐个导出，共 ${exportTargets.length} 个账号槽位。`);
        }

        const exportedProfiles: NonNullable<ExportResult["exportedProfiles"]> = [];
        for (let index = 0; index < exportTargets.length; index += 1) {
          const targetProfile = exportTargets[index];
          const progress = Math.min(95, 10 + Math.floor((index / exportTargets.length) * 80));
          send(target.webview, {
            type: "TASK_PROGRESS",
            payload: {
              step: "export",
              percent: progress,
              message: `导出账号 (${index + 1}/${exportTargets.length}): ${targetProfile.profileName}`
            }
          });

          const exportResult = await runExport({
            codexHome: targetProfile.codexHome,
            outputDir: msg.payload.outputDir,
            includeState: msg.payload.includeState,
            includeAuth: msg.payload.includeAuth,
            mode: msg.payload.mode
          });
          exportedProfiles.push({
            profileId: targetProfile.profileId,
            profileName: targetProfile.profileName,
            codexHome: targetProfile.codexHome,
            zipPath: exportResult.zipPath,
            copiedItems: exportResult.copiedItems,
            warnings: exportResult.warnings
          });
          emitTaskLog(target.webview, "info", `账号 ${targetProfile.profileName} 导出 ZIP: ${exportResult.zipPath}`);
          logger.appendLine(`[export] generated ${exportResult.zipPath} (${targetProfile.profileId})`);
        }

        let result: ExportResult;
        if (exportedProfiles.length === 1) {
          const single = exportedProfiles[0];
          result = {
            codexHome: single.codexHome,
            zipPath: single.zipPath,
            copiedItems: single.copiedItems,
            mode: msg.payload.mode,
            warnings: single.warnings,
            scope,
            profileId: single.profileId,
            profileName: single.profileName,
            exportedProfiles
          };
        } else {
          const allWarnings = exportedProfiles.flatMap((item) => item.warnings.map((warning) => `[${item.profileName}] ${warning}`));
          result = {
            codexHome,
            zipPath: exportedProfiles[0]?.zipPath ?? "",
            copiedItems: [],
            mode: msg.payload.mode,
            warnings: allWarnings,
            scope,
            exportedProfiles
          };
          emitTaskLog(target.webview, "info", `批量导出完成，已生成 ${exportedProfiles.length} 个 ZIP 文件。`);
        }

        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "export", percent: 100, message: "导出完成" } });
        send(target.webview, { type: "TASK_RESULT", payload: { action: "export", data: result } });
        for (const item of exportedProfiles) {
          for (const warning of item.warnings) {
            emitTaskLog(target.webview, "warn", `[${item.profileName}] ${warning}`);
          }
        }
        return;
      }

      if (msg.type === "START_EXPORT") {
        const codexHome = await resolveAndValidateCodexHome(msg.payload.codexHome);
        emitTaskLog(target.webview, "info", `开始导出（模式=${msg.payload.mode}）`);
        emitTaskLog(target.webview, "info", `Codex 目录: ${codexHome}`);
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "export", percent: 15, message: "准备导出" } });
        const result = await runExport({
          codexHome,
          outputDir: msg.payload.outputDir,
          includeState: msg.payload.includeState,
          includeAuth: msg.payload.includeAuth,
          mode: msg.payload.mode
        });
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "export", percent: 100, message: "导出完成" } });
        send(target.webview, { type: "TASK_RESULT", payload: { action: "export", data: result } });
        for (const warning of result.warnings) {
          emitTaskLog(target.webview, "warn", warning);
        }
        emitTaskLog(target.webview, "info", `导出 ZIP: ${result.zipPath}`);
        logger.appendLine(`[export] generated ${result.zipPath}`);
        return;
      }

      if (msg.type === "START_PREVIEW_IMPORT") {
        const codexHome = path.resolve(resolveCodexHome(msg.payload.codexHome));
        emitTaskLog(target.webview, "info", `开始预演（模式=${msg.payload.mode}）`);
        emitTaskLog(target.webview, "info", `目标 Codex 目录: ${codexHome}`);
        emitTaskLog(target.webview, "info", `备份 ZIP: ${path.resolve(msg.payload.backupZip)}`);
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "preview", percent: 20, message: "扫描备份文件" } });
        const result = await previewImport({
          codexHome,
          backupZip: msg.payload.backupZip,
          replaceState: msg.payload.replaceState,
          importAuth: msg.payload.importAuth,
          mode: msg.payload.mode
        });
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "preview", percent: 100, message: "预演完成" } });
        send(target.webview, { type: "TASK_RESULT", payload: { action: "previewImport", data: result } });
        for (const warning of result.warnings) {
          emitTaskLog(target.webview, "warn", warning);
        }
        emitTaskLog(target.webview, "info", "预演执行完毕。");
        return;
      }

      if (msg.type === "START_IMPORT") {
        const codexHome = path.resolve(resolveCodexHome(msg.payload.codexHome));
        emitTaskLog(target.webview, "info", `开始导入（模式=${msg.payload.mode}）`);
        emitTaskLog(target.webview, "info", `目标 Codex 目录: ${codexHome}`);
        emitTaskLog(target.webview, "info", `备份 ZIP: ${path.resolve(msg.payload.backupZip)}`);
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "import", percent: 10, message: "准备导入" } });
        const result = await runImport({
          codexHome,
          backupZip: msg.payload.backupZip,
          replaceState: msg.payload.replaceState,
          importAuth: msg.payload.importAuth,
          mode: msg.payload.mode
        });
        await writeReportBundle(result.reportPath, result);
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "import", percent: 100, message: "导入完成" } });
        send(target.webview, { type: "TASK_RESULT", payload: { action: "import", data: result } });
        for (const warning of result.warnings) {
          emitTaskLog(target.webview, "warn", warning);
        }
        emitTaskLog(target.webview, "info", `导入报告: ${result.reportPath}`);
        return;
      }

      if (msg.type === "START_IMPORT_TO_NEW_PROFILE") {
        const codexHome = path.resolve(resolveCodexHome(msg.payload.codexHome));
        const profileName = msg.payload.profileName.trim();
        if (profileName.length === 0) {
          throw new Error("新账号名称不能为空。");
        }
        emitTaskLog(target.webview, "info", `开始导入到新账号（模式=${msg.payload.mode}）`);
        emitTaskLog(target.webview, "info", `目标 Codex 根目录: ${codexHome}`);
        emitTaskLog(target.webview, "info", `备份 ZIP: ${path.resolve(msg.payload.backupZip)}`);
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "import-new-profile", percent: 10, message: "创建账号槽位" } });

        const beforeSnapshot = await getProfilesSnapshot(codexHome);
        const createdSnapshot = await createProfile(codexHome, profileName);
        const created = resolveCreatedProfile(beforeSnapshot, createdSnapshot, profileName);
        if (!created) {
          throw new Error("未能定位新建账号槽位。");
        }
        emitTaskLog(target.webview, "info", `已创建账号槽位: ${created.name} (${created.id})`);

        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "import-new-profile", percent: 45, message: "导入数据到新账号槽位" } });
        const result = await runImport({
          codexHome: created.path,
          backupZip: msg.payload.backupZip,
          replaceState: msg.payload.replaceState,
          importAuth: msg.payload.importAuth,
          mode: msg.payload.mode
        });
        await writeReportBundle(result.reportPath, result);

        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "import-new-profile", percent: 100, message: "导入完成" } });
        send(target.webview, { type: "TASK_RESULT", payload: { action: "import", data: result } });
        for (const warning of result.warnings) {
          emitTaskLog(target.webview, "warn", warning);
        }
        emitTaskLog(target.webview, "info", `导入报告: ${result.reportPath}`);
        emitTaskLog(target.webview, "info", `已导入到新账号槽位 ${created.name}。如需使用，请在账号页切换到该槽位。`);
        const finalSnapshot = await getProfilesSnapshot(codexHome);
        await emitSnapshot(target.webview, finalSnapshot);
        return;
      }

      if (msg.type === "KILL_PROCESSES") {
        emitTaskLog(target.webview, "info", `即将尝试结束 ${msg.payload.pids.length} 个占用进程...`);
        const result = await forceKillProcesses(msg.payload.pids);
        pendingRelaunchCommands = msg.payload.commands?.filter((item) => item.trim().length > 0) ?? [];
        emitTaskLog(target.webview, "info", `成功结束占用进程数: ${result.killedCount}`);
        send(target.webview, { type: "TASK_RESULT", payload: { action: "killProcesses", data: result } });
        return;
      }
    } catch (err) {
      const appError = asAppError(err, ErrorCode.Unknown);
      logger.appendLine(`[error] ${appError.code}: ${appError.message}`);
      emitTaskLog(target.webview, "error", `${appError.code}: ${appError.message}`);
      send(target.webview, { type: "TASK_ERROR", payload: appError });
    }
  });
}
