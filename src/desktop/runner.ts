import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runExport } from "../engine/exporter";
import { runImport } from "../engine/importer";
import {
  activateProfile,
  createProfile,
  deleteProfile,
  getProfilesSnapshot,
  refreshProfilesUsage,
  reorderProfiles,
  syncCurrentCoreToProfile,
  POOL_RUNNER_PROFILE_ID,
  POOL_RUNNER_PROFILE_NAME,
  type ProfilesSnapshot
} from "../engine/profiles";
import {
  getTokenPoolService,
  initializeDesktopTokenPoolService,
  type TokenPoolSnapshot
} from "../engine/tokenPool";
import { previewImport } from "../engine/scanner";
import { previewThreadCleanup, executeThreadCleanup } from "../engine/threadCleanup";
import { resolveAndValidateCodexHome } from "../engine/codexHome";
import { writeReportBundle } from "../engine/report";
import { relaunchKilledProcesses } from "../engine/processGuard";
import { asAppError, ErrorCode } from "../protocol/errors";
import type {
  ExportResult,
  ExportScope,
  ImportResult,
  PreviewResult,
  ProfileSwitchMode,
  ThreadCleanupApplyMode,
  ThreadCleanupScope
} from "../protocol/messages";
import { resolveCodexHome } from "../util/path";
import { deriveProfilesRoot } from "../util/sharedData";
import { withSharedWriteLock } from "../util/sharedLock";

type DesktopStateSnapshot = {
  codexHome: string;
  platform: NodeJS.Platform;
  defaultOutputDir: string;
  profilesRoot: string;
  activeProfileId?: string;
  profiles: ProfilesSnapshot["profiles"];
  tokenPool: TokenPoolSnapshot;
};

type DesktopCommand =
  | { command: "initAppState"; payload?: { codexHome?: string } }
  | { command: "refreshState"; payload?: { codexHome?: string } }
  | { command: "refreshProfileUsage"; payload?: { codexHome?: string; profileId?: string } }
  | { command: "createProfile"; payload: { codexHome?: string; name: string } }
  | { command: "activateProfile"; payload: { codexHome?: string; profileId: string; backupCurrent: boolean; switchMode?: ProfileSwitchMode } }
  | { command: "deleteProfile"; payload: { codexHome?: string; profileId: string } }
  | { command: "reorderProfiles"; payload: { codexHome?: string; orderedIds: string[] } }
  | { command: "importTokenPoolFiles"; payload: { codexHome?: string; filePaths: string[] } }
  | { command: "importTokenPoolDirectory"; payload: { codexHome?: string; directoryPath: string } }
  | { command: "importProfileToTokenPool"; payload: { codexHome?: string; profileId: string } }
  | { command: "syncCurrentToPoolRunner"; payload?: { codexHome?: string } }
  | { command: "switchToPoolRunner"; payload?: { codexHome?: string; backupCurrent?: boolean } }
  | { command: "refreshTokenPoolEntryUsage"; payload: { codexHome?: string; entryId: string } }
  | { command: "activateTokenPoolEntry"; payload: { codexHome?: string; entryId: string } }
  | { command: "deleteTokenPoolEntry"; payload: { codexHome?: string; entryId: string } }
  | { command: "reorderTokenPoolEntries"; payload: { codexHome?: string; orderedIds: string[] } }
  | {
      command: "setTokenPoolSettings";
      payload: { codexHome?: string; autoSwitchEnabled?: boolean; pollIntervalMs?: number; autoRelaunchAfterSwitch?: boolean };
    }
  | {
      command: "startExport";
      payload: {
        codexHome?: string;
        outputDir: string;
        includeState: boolean;
        includeAuth: boolean;
        mode: "core" | "enhanced";
        scope?: ExportScope;
        profileId?: string;
      };
    }
  | {
      command: "previewImport";
      payload: {
        codexHome?: string;
        backupZip: string;
        replaceState: boolean;
        importAuth: boolean;
        mode: "core" | "enhanced";
      };
    }
  | {
      command: "startImport";
      payload: {
        codexHome?: string;
        backupZip: string;
        replaceState: boolean;
        importAuth: boolean;
        mode: "core" | "enhanced";
      };
    }
  | {
      command: "startImportToNewProfile";
      payload: {
        codexHome?: string;
        backupZip: string;
        replaceState: boolean;
        importAuth: boolean;
        mode: "core" | "enhanced";
        profileName: string;
      };
    }
  | {
      command: "previewThreadCleanup";
      payload: {
        codexHome?: string;
        threadIds: string[];
        scope: ThreadCleanupScope;
        profileId?: string;
      };
    }
  | {
      command: "startThreadCleanup";
      payload: {
        codexHome?: string;
        threadIds: string[];
        scope: ThreadCleanupScope;
        profileId?: string;
        backupEnabled: boolean;
        applyMode: ThreadCleanupApplyMode;
      };
    };

type DesktopCommandResult<T = unknown> = {
  snapshot?: DesktopStateSnapshot;
  data?: T;
  messages: string[];
  warnings: string[];
  errors: string[];
};

type RunnerSuccess = {
  ok: true;
  result: DesktopCommandResult;
};

type RunnerFailure = {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
};

const THREAD_CLEANUP_PENDING_FILE = ".thread-cleanup-pending.json";

type PendingThreadCleanupTask = {
  schemaVersion: 1;
  createdAt: string;
  codexHome: string;
  threadIds: string[];
  scope: ThreadCleanupScope;
  profileId?: string;
  backupEnabled: boolean;
};

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

function resolveThreadCleanupPendingPath(codexHome: string): string {
  return path.join(deriveProfilesRoot(codexHome), THREAD_CLEANUP_PENDING_FILE);
}

async function readPendingThreadCleanup(codexHome: string): Promise<PendingThreadCleanupTask | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(resolveThreadCleanupPendingPath(codexHome), "utf8")) as Partial<PendingThreadCleanupTask>;
    if (!parsed || !Array.isArray(parsed.threadIds) || parsed.threadIds.length === 0) {
      return undefined;
    }
    if (typeof parsed.codexHome !== "string" || parsed.codexHome.trim().length === 0) {
      return undefined;
    }
    if (parsed.scope !== "all" && parsed.scope !== "active" && parsed.scope !== "single") {
      return undefined;
    }
    return {
      schemaVersion: 1,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      codexHome: parsed.codexHome,
      threadIds: parsed.threadIds,
      scope: parsed.scope,
      profileId: typeof parsed.profileId === "string" ? parsed.profileId : undefined,
      backupEnabled: !!parsed.backupEnabled
    };
  } catch {
    return undefined;
  }
}

async function writePendingThreadCleanup(task: PendingThreadCleanupTask): Promise<void> {
  const filePath = resolveThreadCleanupPendingPath(task.codexHome);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(
    tempPath,
    JSON.stringify(
      {
        ...task,
        schemaVersion: 1
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.rename(tempPath, filePath);
}

async function clearPendingThreadCleanup(codexHome: string): Promise<void> {
  await fs.rm(resolveThreadCleanupPendingPath(codexHome), { force: true });
}

function collectThreadCleanupCommands(
  result: Awaited<ReturnType<typeof executeThreadCleanup>>
): string[] {
  const dedup = new Set<string>();
  for (const profile of result.profiles) {
    for (const busy of profile.busyProcesses) {
      const command = busy.command.trim();
      if (command.length > 0) {
        dedup.add(command);
      }
    }
  }
  return [...dedup];
}

async function resolveDefaultOutputDir(): Promise<string> {
  const outputDir = path.resolve(os.homedir(), "codex-backup");
  await fs.mkdir(outputDir, { recursive: true });
  return outputDir;
}

async function buildStateSnapshot(codexHomeOverride?: string): Promise<DesktopStateSnapshot> {
  const codexHome = resolveCodexHome(codexHomeOverride);
  const snapshot = await getProfilesSnapshot(codexHome);
  return {
    codexHome,
    platform: process.platform,
    defaultOutputDir: await resolveDefaultOutputDir(),
    profilesRoot: snapshot.profilesRoot,
    activeProfileId: snapshot.activeProfileId,
    profiles: snapshot.profiles,
    tokenPool: await getTokenPoolService().getSnapshot(codexHome)
  };
}

async function withWriteAccess<T>(codexHomeOverride: string | undefined, action: (codexHome: string) => Promise<T>): Promise<T> {
  const codexHome = resolveCodexHome(codexHomeOverride);
  return withSharedWriteLock(codexHome, "desktop-macos", () => action(codexHome));
}

function resolveExportTargets(snapshot: ProfilesSnapshot, codexHome: string, scope: ExportScope, profileId?: string): ExportTarget[] {
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
    if (!target || !target.exists) {
      throw new Error(`未找到可导出的账号槽位: ${requestedProfileId}`);
    }
    return [{ profileId: target.id, profileName: target.name, codexHome: target.path }];
  }

  if (snapshot.activeProfileId) {
    const active = snapshot.profiles.find((item) => item.id === snapshot.activeProfileId && item.exists);
    if (active) {
      return [{ profileId: active.id, profileName: active.name, codexHome: active.path }];
    }
  }

  const live = snapshot.profiles.find((item) => item.id === "live" && item.exists);
  if (live) {
    return [{ profileId: live.id, profileName: live.name, codexHome: live.path }];
  }

  return [{ profileId: "active", profileName: "当前账号", codexHome }];
}

function resolveCreatedProfile(before: ProfilesSnapshot, after: ProfilesSnapshot, expectedName: string): { id: string; name: string; path: string } | undefined {
  const beforeIds = new Set(before.profiles.map((item) => item.id));
  const candidates = after.profiles.filter((item) => !beforeIds.has(item.id));
  if (candidates.length === 0) {
    return undefined;
  }
  const exact = candidates.find((item) => item.name === expectedName);
  if (exact) {
    return { id: exact.id, name: exact.name, path: exact.path };
  }
  const sorted = [...candidates].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const picked = sorted[0];
  return picked ? { id: picked.id, name: picked.name, path: picked.path } : undefined;
}

async function maybeResumePendingThreadCleanup(codexHome: string): Promise<string[]> {
  const messages: string[] = [];
  const pending = await readPendingThreadCleanup(codexHome);
  if (!pending) {
    return messages;
  }

  const preview = await previewThreadCleanup({
    codexHome: pending.codexHome,
    threadIds: pending.threadIds,
    scope: pending.scope,
    profileId: pending.profileId
  });
  const blockedProfiles = preview.profiles.filter((item) => item.matches.length > 0 && item.potentialBusyProcesses.length > 0);
  if (blockedProfiles.length > 0) {
    messages.push(`待补做清理仍有 ${blockedProfiles.length} 个账号被占用，暂不继续执行。`);
    return messages;
  }

  await withSharedWriteLock(pending.codexHome, "desktop-macos", () =>
    executeThreadCleanup({
      codexHome: pending.codexHome,
      threadIds: pending.threadIds,
      scope: pending.scope,
      profileId: pending.profileId,
      backupEnabled: pending.backupEnabled,
      applyMode: "restartLater"
    })
  );
  await clearPendingThreadCleanup(codexHome);
  messages.push("已自动完成上次登记的对话清理任务。");
  return messages;
}

async function runCommand(request: DesktopCommand): Promise<DesktopCommandResult> {
  const messages: string[] = [];
  const warnings: string[] = [];

  switch (request.command) {
    case "initAppState":
    case "refreshState": {
      const codexHome = resolveCodexHome(request.payload?.codexHome);
      messages.push(...(await maybeResumePendingThreadCleanup(codexHome)));
      return {
        snapshot: await buildStateSnapshot(codexHome),
        messages,
        warnings,
        errors: []
      };
    }
    case "refreshProfileUsage": {
      const codexHome = resolveCodexHome(request.payload?.codexHome);
      const snapshot = await refreshProfilesUsage(codexHome, request.payload?.profileId);
      return {
        snapshot: {
          codexHome,
          platform: process.platform,
          defaultOutputDir: await resolveDefaultOutputDir(),
          profilesRoot: snapshot.profilesRoot,
          activeProfileId: snapshot.activeProfileId,
          profiles: snapshot.profiles,
          tokenPool: await getTokenPoolService().getSnapshot(codexHome)
        },
        messages: snapshot.messages,
        warnings,
        errors: []
      };
    }
    case "createProfile": {
      const snapshot = await withWriteAccess(request.payload.codexHome, (codexHome) => createProfile(codexHome, request.payload.name));
      return { snapshot: await buildStateSnapshot(snapshot.codexHome), data: snapshot, messages: snapshot.messages, warnings, errors: [] };
    }
    case "activateProfile": {
      const data = await withWriteAccess(request.payload.codexHome, (codexHome) =>
        activateProfile(codexHome, request.payload.profileId, request.payload.backupCurrent, request.payload.switchMode ?? "plain")
      );
      return { snapshot: await buildStateSnapshot(data.codexHome), data, messages: data.messages, warnings, errors: [] };
    }
    case "deleteProfile": {
      const snapshot = await withWriteAccess(request.payload.codexHome, (codexHome) => deleteProfile(codexHome, request.payload.profileId));
      return { snapshot: await buildStateSnapshot(snapshot.codexHome), data: snapshot, messages: snapshot.messages, warnings, errors: [] };
    }
    case "reorderProfiles": {
      const snapshot = await withWriteAccess(request.payload.codexHome, (codexHome) => reorderProfiles(codexHome, request.payload.orderedIds));
      return { snapshot: await buildStateSnapshot(snapshot.codexHome), data: snapshot, messages: snapshot.messages, warnings, errors: [] };
    }
    case "importTokenPoolFiles": {
      const tokenPool = await withWriteAccess(request.payload.codexHome, (codexHome) =>
        getTokenPoolService().importFiles(request.payload.filePaths, codexHome)
      );
      return { snapshot: await buildStateSnapshot(request.payload.codexHome), data: tokenPool, messages, warnings, errors: [] };
    }
    case "importTokenPoolDirectory": {
      const tokenPool = await withWriteAccess(request.payload.codexHome, (codexHome) =>
        getTokenPoolService().importDirectory(request.payload.directoryPath, codexHome)
      );
      return { snapshot: await buildStateSnapshot(request.payload.codexHome), data: tokenPool, messages, warnings, errors: [] };
    }
    case "importProfileToTokenPool": {
      const codexHome = resolveCodexHome(request.payload.codexHome);
      const snapshot = await getProfilesSnapshot(codexHome);
      const profile = snapshot.profiles.find((item) => item.id === request.payload.profileId && item.exists);
      if (!profile) {
        throw new Error(`未找到可导入的账号槽位: ${request.payload.profileId}`);
      }
      const tokenPool = await withWriteAccess(codexHome, (resolved) => getTokenPoolService().importProfileAuth(profile.path, resolved));
      return { snapshot: await buildStateSnapshot(codexHome), data: tokenPool, messages, warnings, errors: [] };
    }
    case "syncCurrentToPoolRunner": {
      const snapshot = await withWriteAccess(request.payload?.codexHome, (codexHome) =>
        syncCurrentCoreToProfile(codexHome, POOL_RUNNER_PROFILE_ID, POOL_RUNNER_PROFILE_NAME)
      );
      return { snapshot: await buildStateSnapshot(snapshot.codexHome), data: snapshot, messages: snapshot.messages, warnings, errors: [] };
    }
    case "switchToPoolRunner": {
      const data = await withWriteAccess(request.payload?.codexHome, async (codexHome) => {
        const before = await getProfilesSnapshot(codexHome);
        const hasPoolRunner = before.profiles.some((item) => item.id === POOL_RUNNER_PROFILE_ID && item.exists);
        if (!hasPoolRunner) {
          await syncCurrentCoreToProfile(codexHome, POOL_RUNNER_PROFILE_ID, POOL_RUNNER_PROFILE_NAME);
        }
        return activateProfile(codexHome, POOL_RUNNER_PROFILE_ID, !!request.payload?.backupCurrent, "plain");
      });
      return { snapshot: await buildStateSnapshot(data.codexHome), data, messages: data.messages, warnings, errors: [] };
    }
    case "refreshTokenPoolEntryUsage": {
      const tokenPool = await withWriteAccess(request.payload.codexHome, (codexHome) =>
        getTokenPoolService().refreshEntryUsage(request.payload.entryId, codexHome)
      );
      return { snapshot: await buildStateSnapshot(request.payload.codexHome), data: tokenPool, messages, warnings, errors: [] };
    }
    case "activateTokenPoolEntry": {
      const tokenPool = await withWriteAccess(request.payload.codexHome, (codexHome) =>
        getTokenPoolService().activateEntry(request.payload.entryId, codexHome, "manual")
      );
      return { snapshot: await buildStateSnapshot(request.payload.codexHome), data: tokenPool, messages, warnings, errors: [] };
    }
    case "deleteTokenPoolEntry": {
      const tokenPool = await withWriteAccess(request.payload.codexHome, (codexHome) =>
        getTokenPoolService().deleteEntry(request.payload.entryId, codexHome)
      );
      return { snapshot: await buildStateSnapshot(request.payload.codexHome), data: tokenPool, messages, warnings, errors: [] };
    }
    case "reorderTokenPoolEntries": {
      const tokenPool = await withWriteAccess(request.payload.codexHome, (codexHome) =>
        getTokenPoolService().reorderEntries(request.payload.orderedIds, codexHome)
      );
      return { snapshot: await buildStateSnapshot(request.payload.codexHome), data: tokenPool, messages, warnings, errors: [] };
    }
    case "setTokenPoolSettings": {
      const tokenPool = await withWriteAccess(request.payload.codexHome, (codexHome) =>
        getTokenPoolService().setSettings(request.payload, codexHome)
      );
      return { snapshot: await buildStateSnapshot(request.payload.codexHome), data: tokenPool, messages, warnings, errors: [] };
    }
    case "startExport": {
      const codexHome = await resolveAndValidateCodexHome(request.payload.codexHome);
      const snapshot = await getProfilesSnapshot(codexHome);
      const scope = normalizeExportScope(request.payload.scope, request.payload.profileId);
      const exportTargets = resolveExportTargets(snapshot, codexHome, scope, request.payload.profileId);
      const exportedProfiles: NonNullable<ExportResult["exportedProfiles"]> = [];
      for (const target of exportTargets) {
        const result = await runExport({
          codexHome: target.codexHome,
          outputDir: request.payload.outputDir,
          includeState: request.payload.includeState,
          includeAuth: request.payload.includeAuth,
          mode: request.payload.mode
        });
        exportedProfiles.push({
          profileId: target.profileId,
          profileName: target.profileName,
          codexHome: target.codexHome,
          zipPath: result.zipPath,
          copiedItems: result.copiedItems,
          warnings: result.warnings
        });
      }
      const data: ExportResult =
        exportedProfiles.length === 1
          ? {
              codexHome: exportedProfiles[0].codexHome,
              zipPath: exportedProfiles[0].zipPath,
              copiedItems: exportedProfiles[0].copiedItems,
              mode: request.payload.mode,
              warnings: exportedProfiles[0].warnings,
              scope,
              profileId: exportedProfiles[0].profileId,
              profileName: exportedProfiles[0].profileName,
              exportedProfiles
            }
          : {
              codexHome,
              zipPath: exportedProfiles[0]?.zipPath ?? "",
              copiedItems: [],
              mode: request.payload.mode,
              warnings: exportedProfiles.flatMap((item) => item.warnings.map((warning) => `[${item.profileName}] ${warning}`)),
              scope,
              exportedProfiles
            };
      return { snapshot: await buildStateSnapshot(codexHome), data, messages, warnings: data.warnings, errors: [] };
    }
    case "previewImport": {
      const codexHome = path.resolve(resolveCodexHome(request.payload.codexHome));
      const data: PreviewResult = await previewImport({
        codexHome,
        backupZip: request.payload.backupZip,
        replaceState: request.payload.replaceState,
        importAuth: request.payload.importAuth,
        mode: request.payload.mode
      });
      return { snapshot: await buildStateSnapshot(codexHome), data, messages, warnings: data.warnings, errors: [] };
    }
    case "startImport": {
      const data: ImportResult = await withWriteAccess(request.payload.codexHome, async (codexHomeRaw) => {
        const codexHome = path.resolve(codexHomeRaw);
        const result = await runImport({
          codexHome,
          backupZip: request.payload.backupZip,
          replaceState: request.payload.replaceState,
          importAuth: request.payload.importAuth,
          mode: request.payload.mode
        });
        await writeReportBundle(result.reportPath, result);
        return result;
      });
      return { snapshot: await buildStateSnapshot(request.payload.codexHome), data, messages, warnings: data.warnings, errors: [] };
    }
    case "startImportToNewProfile": {
      const payload = request.payload;
      const data = await withWriteAccess(payload.codexHome, async (codexHomeRaw) => {
        const codexHome = path.resolve(codexHomeRaw);
        const profileName = payload.profileName.trim();
        if (profileName.length === 0) {
          throw new Error("新账号名称不能为空。");
        }
        const beforeSnapshot = await getProfilesSnapshot(codexHome);
        const createdSnapshot = await createProfile(codexHome, profileName);
        const created = resolveCreatedProfile(beforeSnapshot, createdSnapshot, profileName);
        if (!created) {
          throw new Error("未能定位新建账号槽位。");
        }
        const result = await runImport({
          codexHome: created.path,
          backupZip: payload.backupZip,
          replaceState: payload.replaceState,
          importAuth: payload.importAuth,
          mode: payload.mode
        });
        await writeReportBundle(result.reportPath, result);
        return result;
      });
      return { snapshot: await buildStateSnapshot(payload.codexHome), data, messages, warnings: data.warnings, errors: [] };
    }
    case "previewThreadCleanup": {
      const codexHome = await resolveAndValidateCodexHome(request.payload.codexHome);
      const data = await previewThreadCleanup({
        codexHome,
        threadIds: request.payload.threadIds,
        scope: request.payload.scope,
        profileId: request.payload.profileId
      });
      return { snapshot: await buildStateSnapshot(codexHome), data, messages, warnings, errors: [] };
    }
    case "startThreadCleanup": {
      const payload = request.payload;
      const codexHome = await resolveAndValidateCodexHome(payload.codexHome);
      const data = await withWriteAccess(codexHome, async () => {
        const result = await executeThreadCleanup({
          codexHome,
          threadIds: payload.threadIds,
          scope: payload.scope,
          profileId: payload.profileId,
          backupEnabled: payload.backupEnabled,
          applyMode: payload.applyMode
        });
        const lockedProfiles = result.profiles.filter((item) => item.locked);
        const scheduledProfiles = payload.applyMode === "restartLater" ? lockedProfiles.map((item) => item.profileName) : [];
        let relaunchedClients: string[] = [];
        if (result.killTriggered) {
          const relaunch = await relaunchKilledProcesses(collectThreadCleanupCommands(result));
          relaunchedClients = relaunch.succeeded;
        }
        if (scheduledProfiles.length > 0) {
          await writePendingThreadCleanup({
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            codexHome,
            threadIds: result.threadIds,
            scope: result.scope,
            profileId: result.profileId,
            backupEnabled: result.backupEnabled
          });
        } else {
          await clearPendingThreadCleanup(codexHome);
        }
        return {
          ...result,
          scheduledProfiles,
          relaunchedClients
        };
      });
      return { snapshot: await buildStateSnapshot(codexHome), data, messages, warnings, errors: [] };
    }
  }
}

async function main(): Promise<void> {
  const encoded = process.argv[2];
  if (!encoded) {
    throw new Error("Missing desktop command payload");
  }

  initializeDesktopTokenPoolService();
  const request = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as DesktopCommand;
  const result = await runCommand(request);
  const output: RunnerSuccess = {
    ok: true,
    result
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

void main().catch((error) => {
  const appError = asAppError(error, ErrorCode.Unknown);
  const output: RunnerFailure = {
    ok: false,
    code: appError.code,
    message: appError.message,
    details: appError.details
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = 1;
});
