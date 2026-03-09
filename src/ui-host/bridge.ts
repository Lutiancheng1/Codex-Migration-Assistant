import * as vscode from "vscode";
import type { Dirent } from "fs";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { runExport } from "../engine/exporter";
import { runImport } from "../engine/importer";
import {
  activateProfile,
  createProfile,
  deleteProfile,
  getProfilesSnapshot,
  refreshProfilesUsage,
  syncCurrentCoreToProfile,
  POOL_RUNNER_PROFILE_ID,
  POOL_RUNNER_PROFILE_NAME,
  type ProfilesSnapshot
} from "../engine/profiles";
import { writeReportBundle } from "../engine/report";
import { previewImport } from "../engine/scanner";
import { forceKillProcesses, relaunchKilledProcesses } from "../engine/processGuard";
import { getTokenPoolService } from "../engine/tokenPool";
import { executeThreadCleanup, previewThreadCleanup } from "../engine/threadCleanup";
import { asAppError, ErrorCode } from "../protocol/errors";
import type { ExportResult, ExportScope, ProfileSwitchMode, RequestMessage, ResponseMessage } from "../protocol/messages";
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
let pendingActivateAfterKill: Extract<RequestMessage, { type: "ACTIVATE_PROFILE" }> | undefined;

function rememberActivateAfterKill(
  codexHome: string,
  profileId: string,
  backupCurrent: boolean | undefined,
  switchMode: ProfileSwitchMode | undefined
): void {
  pendingActivateAfterKill = {
    type: "ACTIVATE_PROFILE",
    payload: {
      codexHome,
      profileId,
      backupCurrent: !!backupCurrent,
      switchMode: switchMode ?? "plain"
    }
  };
}

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
  const tokenPool = await getTokenPoolService().getSnapshot(snapshot.codexHome);
  send(webview, {
    type: "STATE_SNAPSHOT",
    payload: {
      codexHome: snapshot.codexHome,
      platform: process.platform,
      defaultOutputDir: await resolveDefaultOutputDir(),
      profilesRoot: snapshot.profilesRoot,
      activeProfileId: snapshot.activeProfileId,
      profiles: snapshot.profiles,
      tokenPool
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

async function runActivateProfileRequest(target: WebviewTarget, msg: Extract<RequestMessage, { type: "ACTIVATE_PROFILE" }>): Promise<void> {
  const codexHome = resolveCodexHome(msg.payload.codexHome);
  const switchMode =
    msg.payload.switchMode ?? (msg.payload.mergeFromCurrentCore ? "merge" : "plain");
  send(target.webview, {
    type: "TASK_PROGRESS",
    payload: { step: "switch-profile", percent: 10, message: "准备切换账号" }
  });
  const snapshot = await activateProfile(
    codexHome,
    msg.payload.profileId,
    msg.payload.backupCurrent,
    switchMode
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
        mergeFromCurrentCore: switchMode === "merge",
        switchMode,
        relaunchedClients,
        messages: snapshot.messages
      }
    }
  });
  emitTaskLog(target.webview, "warn", "账号已切换。请重启 Codex App 或执行 Reload Window 以加载新账号会话。");
}

async function importTokenPoolFiles(webview: vscode.Webview, mode: "single" | "multiple"): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: mode === "single" ? "选择 token JSON" : "选择多个 token JSON",
    canSelectMany: mode === "multiple",
    canSelectFiles: true,
    canSelectFolders: false,
    filters: {
      JSON: ["json"]
    }
  });
  if (!picked || picked.length === 0) {
    return;
  }
  await getTokenPoolService().importFiles(picked.map((item) => item.fsPath));
  emitTaskLog(webview, "info", `账号池已导入 ${picked.length} 个 JSON 文件。`);
}

async function importTokenPoolDirectory(webview: vscode.Webview): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: "选择 token 目录",
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true
  });
  const targetDir = picked?.[0]?.fsPath;
  if (!targetDir) {
    return;
  }
  await getTokenPoolService().importDirectory(targetDir);
  emitTaskLog(webview, "info", `账号池已导入目录中的 JSON：${targetDir}`);
}

export function bindBridge(target: WebviewTarget): vscode.Disposable {
  const tokenPoolService = getTokenPoolService();
  let scheduledSnapshot: NodeJS.Timeout | undefined;
  let preferredCodexHome: string | undefined;

  function rememberCodexHome(codexHomeOverride?: string): string {
    const resolved = resolveCodexHome(codexHomeOverride);
    preferredCodexHome = resolved;
    return resolved;
  }

  function scheduleStateSnapshot(codexHomeOverride?: string): void {
    if (codexHomeOverride) {
      rememberCodexHome(codexHomeOverride);
    }
    if (scheduledSnapshot) {
      clearTimeout(scheduledSnapshot);
    }
    scheduledSnapshot = setTimeout(() => {
      scheduledSnapshot = undefined;
      void emitStateSnapshot(target.webview, preferredCodexHome);
    }, 80);
  }

  const messageDisposable = target.webview.onDidReceiveMessage(async (raw: unknown) => {
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
        await emitStateSnapshot(target.webview, rememberCodexHome());
        return;
      }

      if (msg.type === "REFRESH_PROFILES") {
        await emitStateSnapshot(target.webview, rememberCodexHome(msg.payload?.codexHome));
        return;
      }

      if (msg.type === "IMPORT_TOKEN_POOL_FILES") {
        await importTokenPoolFiles(target.webview, msg.payload.mode);
        return;
      }

      if (msg.type === "IMPORT_TOKEN_POOL_DIRECTORY") {
        await importTokenPoolDirectory(target.webview);
        return;
      }

      if (msg.type === "SYNC_CURRENT_TO_POOL_RUNNER") {
        const codexHome = resolveCodexHome(msg.payload?.codexHome);
        rememberCodexHome(codexHome);
        const snapshot = await syncCurrentCoreToProfile(codexHome, POOL_RUNNER_PROFILE_ID, POOL_RUNNER_PROFILE_NAME);
        await emitSnapshot(target.webview, snapshot);
        emitTaskLog(target.webview, "info", "已同步当前记录到 pool-runner。账号池后续只会操作该专用槽位。");
        return;
      }

      if (msg.type === "SWITCH_TO_POOL_RUNNER") {
        const codexHome = resolveCodexHome(msg.payload?.codexHome);
        rememberCodexHome(codexHome);
        const before = await getProfilesSnapshot(codexHome);
        const hasPoolRunner = before.profiles.some((item) => item.id === POOL_RUNNER_PROFILE_ID && item.exists);
        if (!hasPoolRunner) {
          const synced = await syncCurrentCoreToProfile(codexHome, POOL_RUNNER_PROFILE_ID, POOL_RUNNER_PROFILE_NAME);
          await emitSnapshot(target.webview, synced);
          emitTaskLog(target.webview, "info", "未检测到 pool-runner，已先同步当前记录到该专用槽位。");
        }
        await runActivateProfileRequest(target, {
          type: "ACTIVATE_PROFILE",
          payload: {
            codexHome,
            profileId: POOL_RUNNER_PROFILE_ID,
            backupCurrent: !!msg.payload?.backupCurrent,
            switchMode: "plain"
          }
        });
        return;
      }

      if (msg.type === "REFRESH_TOKEN_POOL_ENTRY_USAGE") {
        await tokenPoolService.refreshEntryUsage(msg.payload.entryId, msg.payload.codexHome);
        return;
      }

      if (msg.type === "ACTIVATE_TOKEN_POOL_ENTRY") {
        await tokenPoolService.activateEntry(msg.payload.entryId, msg.payload.codexHome, "manual");
        return;
      }

      if (msg.type === "DELETE_TOKEN_POOL_ENTRY") {
        await tokenPoolService.deleteEntry(msg.payload.entryId);
        return;
      }

      if (msg.type === "MOVE_TOKEN_POOL_ENTRY") {
        await tokenPoolService.moveEntry(msg.payload.entryId, msg.payload.direction);
        return;
      }

      if (msg.type === "SET_TOKEN_POOL_SETTINGS") {
        await tokenPoolService.setSettings(msg.payload);
        return;
      }

      if (msg.type === "REFRESH_PROFILE_USAGE") {
        const codexHome = resolveCodexHome(msg.payload?.codexHome);
        rememberCodexHome(codexHome);
        const snapshot = await refreshProfilesUsage(codexHome, msg.payload?.profileId);
        await emitSnapshot(target.webview, snapshot);
        return;
      }

      if (msg.type === "CREATE_PROFILE") {
        const codexHome = resolveCodexHome(msg.payload.codexHome);
        rememberCodexHome(codexHome);
        const snapshot = await createProfile(codexHome, msg.payload.name);
        await emitSnapshot(target.webview, snapshot);
        return;
      }

      if (msg.type === "ACTIVATE_PROFILE") {
        pendingActivateAfterKill = undefined;
        await runActivateProfileRequest(target, msg);
        return;
      }

      if (msg.type === "DELETE_PROFILE") {
        const codexHome = resolveCodexHome(msg.payload.codexHome);
        rememberCodexHome(codexHome);
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
        rememberCodexHome(codexHome);
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
        rememberCodexHome(codexHome);
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
        rememberCodexHome(codexHome);
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
        rememberCodexHome(codexHome);
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
        rememberCodexHome(codexHome);
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

      if (msg.type === "PREVIEW_THREAD_CLEANUP") {
        const codexHome = await resolveAndValidateCodexHome(msg.payload.codexHome);
        rememberCodexHome(codexHome);
        emitTaskLog(target.webview, "info", `开始对话清理预览（范围=${msg.payload.scope}）`);
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "thread-cleanup-preview", percent: 15, message: "扫描匹配线程" } });
        const result = await previewThreadCleanup({
          codexHome,
          threadIds: msg.payload.threadIds,
          scope: msg.payload.scope,
          profileId: msg.payload.profileId
        });
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "thread-cleanup-preview", percent: 100, message: "清理预览完成" } });
        send(target.webview, { type: "TASK_RESULT", payload: { action: "threadCleanupPreview", data: result } });
        emitTaskLog(
          target.webview,
          "info",
          `预览完成：命中线程 ${result.totalMatchedThreads}，命中文件 ${result.totalMatchedFiles}，未命中会话ID ${result.notFoundThreadIds.length}`
        );
        return;
      }

      if (msg.type === "START_THREAD_CLEANUP") {
        const codexHome = await resolveAndValidateCodexHome(msg.payload.codexHome);
        rememberCodexHome(codexHome);
        emitTaskLog(
          target.webview,
          "info",
          `开始执行对话清理（范围=${msg.payload.scope}, 生效=${msg.payload.applyMode}, 备份=${msg.payload.backupEnabled ? "on" : "off"}）`
        );
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "thread-cleanup", percent: 10, message: "准备清理任务" } });
        const result = await executeThreadCleanup({
          codexHome,
          threadIds: msg.payload.threadIds,
          scope: msg.payload.scope,
          profileId: msg.payload.profileId,
          backupEnabled: msg.payload.backupEnabled,
          applyMode: msg.payload.applyMode,
          onLog: (message) => emitTaskLog(target.webview, "info", message)
        });
        send(target.webview, { type: "TASK_PROGRESS", payload: { step: "thread-cleanup", percent: 100, message: "对话清理执行完成" } });
        send(target.webview, { type: "TASK_RESULT", payload: { action: "threadCleanup", data: result } });
        if (result.backupPath) {
          emitTaskLog(target.webview, "info", `清理备份目录: ${result.backupPath}`);
        }
        if (result.notFoundThreadIds.length > 0) {
          emitTaskLog(target.webview, "warn", `以下会话ID未命中: ${result.notFoundThreadIds.join(", ")}`);
        }
        const lockedProfiles = result.profiles.filter((item) => item.locked);
        if (lockedProfiles.length > 0) {
          emitTaskLog(target.webview, "warn", `有 ${lockedProfiles.length} 个账号因进程占用未清理，请重启后再执行。`);
        }
        await emitStateSnapshot(target.webview, codexHome);
        return;
      }

      if (msg.type === "KILL_PROCESSES") {
        emitTaskLog(target.webview, "info", `即将尝试结束 ${msg.payload.pids.length} 个占用进程...`);
        const result = await forceKillProcesses(msg.payload.pids);
        pendingRelaunchCommands = msg.payload.commands?.filter((item) => item.trim().length > 0) ?? [];
        emitTaskLog(target.webview, "info", `成功结束占用进程数: ${result.killedCount}`);
        send(target.webview, { type: "TASK_RESULT", payload: { action: "killProcesses", data: result } });
        if (pendingActivateAfterKill) {
          const resumeMsg = pendingActivateAfterKill;
          pendingActivateAfterKill = undefined;
          const resumeMode = resumeMsg.payload.switchMode ?? (resumeMsg.payload.mergeFromCurrentCore ? "merge" : "plain");
          emitTaskLog(target.webview, "info", `继续执行挂起的账号切换（模式=${resumeMode}）...`);
          await runActivateProfileRequest(target, resumeMsg);
        }
        return;
      }
    } catch (err) {
      const appError = asAppError(err, ErrorCode.Unknown);
      if (appError.code === ErrorCode.FileLocked) {
        if (msg.type === "ACTIVATE_PROFILE") {
          pendingActivateAfterKill = msg;
        } else if (msg.type === "SWITCH_TO_POOL_RUNNER") {
          const codexHome = resolveCodexHome(msg.payload?.codexHome);
          rememberActivateAfterKill(codexHome, POOL_RUNNER_PROFILE_ID, msg.payload?.backupCurrent, "plain");
        }
      }
      logger.appendLine(`[error] ${appError.code}: ${appError.message}`);
      emitTaskLog(target.webview, "error", `${appError.code}: ${appError.message}`);
      send(target.webview, { type: "TASK_ERROR", payload: appError });
    }
  });
  const tokenPoolLogDisposable = tokenPoolService.onDidLog(({ level, message }) => {
    emitTaskLog(target.webview, level, message);
  });
  const tokenPoolChangeDisposable = tokenPoolService.onDidChange(() => {
    scheduleStateSnapshot();
  });
  return new vscode.Disposable(() => {
    if (scheduledSnapshot) {
      clearTimeout(scheduledSnapshot);
      scheduledSnapshot = undefined;
    }
    messageDisposable.dispose();
    tokenPoolLogDisposable.dispose();
    tokenPoolChangeDisposable.dispose();
  });
}
