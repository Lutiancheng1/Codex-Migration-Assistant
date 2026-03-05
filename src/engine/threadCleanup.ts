import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from "sql.js";
import { ErrorCode } from "../protocol/errors";
import { detectExternalBusyProcesses, forceKillProcesses, type BusyProcess } from "./processGuard";
import { getProfilesSnapshot, type ProfilesSnapshot } from "./profiles";
import { timestampLocal } from "../util/time";

export type ThreadCleanupScope = "all" | "active" | "single";
export type ThreadCleanupApplyMode = "killNow" | "restartLater";

export type ThreadCleanupThreadMatch = {
  id: string;
  title?: string;
  archived: boolean;
  rolloutPath?: string;
  rolloutFiles: string[];
};

export type ThreadCleanupProfilePreview = {
  profileId: string;
  profileName: string;
  codexHome: string;
  matches: ThreadCleanupThreadMatch[];
  matchedFileCount: number;
  missingThreadIds: string[];
  potentialBusyProcesses: BusyProcess[];
};

export type ThreadCleanupPreviewResult = {
  codexHome: string;
  scope: ThreadCleanupScope;
  profileId?: string;
  threadIds: string[];
  profiles: ThreadCleanupProfilePreview[];
  notFoundThreadIds: string[];
  totalMatchedThreads: number;
  totalMatchedFiles: number;
};

export type ThreadCleanupProfileExecuteResult = {
  profileId: string;
  profileName: string;
  codexHome: string;
  deleted: {
    threads: number;
    logs: number;
    dynamicTools: number;
    files: number;
    globalStateTitles: number;
    globalStateOrder: number;
  };
  verification: {
    dbResidual: number;
    fileResidual: number;
    globalStateResidual: number;
    clean: boolean;
  };
  locked: boolean;
  busyProcesses: BusyProcess[];
  warnings: string[];
  errors: string[];
};

export type ThreadCleanupResult = {
  codexHome: string;
  scope: ThreadCleanupScope;
  profileId?: string;
  threadIds: string[];
  backupEnabled: boolean;
  backupPath?: string;
  applyMode: ThreadCleanupApplyMode;
  killTriggered: boolean;
  killedCount: number;
  notFoundThreadIds: string[];
  profiles: ThreadCleanupProfileExecuteResult[];
};

type CleanupProfileTarget = {
  profileId: string;
  profileName: string;
  codexHome: string;
};

type ThreadDbRow = {
  id: string;
  title?: string;
  archived?: number;
  rollout_path?: string;
};

type GlobalThreadTitles = {
  filePath: string;
  titles: Record<string, string>;
  order: string[];
};

type PreviewProfileContext = {
  target: CleanupProfileTarget;
  stateDbPaths: string[];
  stateDbSidecarPaths: string[];
  globalState?: GlobalThreadTitles;
};

type BackupManifest = {
  createdAt: string;
  codexHome: string;
  scope: ThreadCleanupScope;
  profileId?: string;
  threadIds: string[];
  profiles: Array<{
    profileId: string;
    profileName: string;
    files: Array<{
      sourcePath: string;
      backupPath: string;
      size: number;
    }>;
  }>;
};

const GLOBAL_STATE_FILE = ".codex-global-state.json";

type BusyProcessDetector = (paths: string[]) => Promise<BusyProcess[]>;
type ProcessKiller = (pids: number[]) => Promise<{ killedCount: number }>;

type SqliteSession = {
  dbPath: string;
  db: SqlJsDatabase;
  dirty: boolean;
};

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

function getSqlJsWasmPath(): string {
  return require.resolve("sql.js/dist/sql-wasm.wasm");
}

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const wasmPath = getSqlJsWasmPath();
    sqlJsPromise = initSqlJs({
      locateFile: (file) => {
        if (file.endsWith(".wasm")) {
          return wasmPath;
        }
        return path.join(path.dirname(wasmPath), file);
      }
    });
  }
  return sqlJsPromise;
}

async function openSqliteSession(dbPath: string): Promise<SqliteSession> {
  const SQL = await getSqlJs();
  const buffer = await fs.readFile(dbPath);
  const db = new SQL.Database(new Uint8Array(buffer));
  return { dbPath, db, dirty: false };
}

async function closeSqliteSession(session: SqliteSession): Promise<void> {
  try {
    if (session.dirty) {
      const exported = session.db.export();
      await fs.writeFile(session.dbPath, Buffer.from(exported));
    }
  } finally {
    session.db.close();
  }
}

function normalizePathname(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeThreadIdToken(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^[`"'\u201c\u201d\u2018\u2019\[\]\(\){}<>]+/, "")
    .replace(/[`"'\u201c\u201d\u2018\u2019\[\]\(\){}<>]+$/, "")
    .trim();
}

function splitAndNormalizeThreadIds(threadIds: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const uuidPattern = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  for (const raw of threadIds) {
    const parts = String(raw ?? "")
      .split(/[\s,]+/g)
      .map((item) => normalizeThreadIdToken(item))
      .filter((item) => item.length > 0);
    const uuidMatches = parts
      .map((part) => part.match(uuidPattern)?.[1])
      .filter((item): item is string => typeof item === "string");
    if (uuidMatches.length > 0) {
      for (const uuid of uuidMatches) {
        if (!seen.has(uuid)) {
          seen.add(uuid);
          out.push(uuid);
        }
      }
      continue;
    }
    for (const part of parts) {
      if (!seen.has(part)) {
        seen.add(part);
        out.push(part);
      }
    }
  }
  return out;
}

function isStateDbFile(fileName: string): boolean {
  return /^state_.*\.sqlite$/i.test(fileName);
}

function isStateDbSidecarFile(fileName: string): boolean {
  return /^state_.*\.sqlite(?:-wal|-shm)$/i.test(fileName);
}

function createFileLockedError(message: string, busyProcesses: BusyProcess[]): Error & { code: ErrorCode; details: Record<string, unknown> } {
  const error = new Error(message) as Error & { code: ErrorCode; details: Record<string, unknown> };
  error.code = ErrorCode.FileLocked;
  error.details = { busy: busyProcesses };
  return error;
}

function isLikelyLockError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || code === "EPERM" || code === "EBUSY" || code === "EACCES") {
    return true;
  }
  return message.includes("database is locked") || (message.includes("sqlit") && message.includes("busy"));
}

async function statSafe(pathname: string): Promise<import("fs").Stats | undefined> {
  try {
    return await fs.stat(pathname);
  } catch {
    return undefined;
  }
}

async function ensureDirectory(pathname: string): Promise<void> {
  await fs.mkdir(pathname, { recursive: true });
}

async function readProfileContext(target: CleanupProfileTarget): Promise<PreviewProfileContext> {
  const entries = await fs.readdir(target.codexHome, { withFileTypes: true });
  const stateDbPaths = entries
    .filter((entry) => entry.isFile() && isStateDbFile(entry.name))
    .map((entry) => path.join(target.codexHome, entry.name));
  const stateDbSidecarPaths = entries
    .filter((entry) => entry.isFile() && (isStateDbFile(entry.name) || isStateDbSidecarFile(entry.name)))
    .map((entry) => path.join(target.codexHome, entry.name));

  const globalStatePath = path.join(target.codexHome, GLOBAL_STATE_FILE);
  let globalState: GlobalThreadTitles | undefined;
  const globalStateStat = await statSafe(globalStatePath);
  if (globalStateStat?.isFile()) {
    try {
      const raw = await fs.readFile(globalStatePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const root = asRecord(parsed);
      const atom = root ? asRecord(root["electron-persisted-atom-state"]) : undefined;
      const threadTitles = atom ? asRecord(atom["thread-titles"]) : undefined;
      const titlesRecord = threadTitles ? asRecord(threadTitles.titles) : undefined;
      const orderValue = threadTitles?.order;
      const titles: Record<string, string> = {};
      if (titlesRecord) {
        for (const [key, value] of Object.entries(titlesRecord)) {
          if (typeof value === "string") {
            titles[key] = value;
          }
        }
      }
      const order = Array.isArray(orderValue) ? orderValue.filter((item): item is string => typeof item === "string") : [];
      globalState = { filePath: globalStatePath, titles, order };
    } catch {
      // Ignore invalid global state file.
    }
  }

  return { target, stateDbPaths, stateDbSidecarPaths, globalState };
}

function queryRows(db: SqlJsDatabase, sql: string, params: Array<string | number> = []): Array<Record<string, unknown>> {
  const stmt = db.prepare(sql);
  try {
    if (params.length > 0) {
      stmt.bind(params);
    }
    const out: Array<Record<string, unknown>> = [];
    while (stmt.step()) {
      out.push(stmt.getAsObject() as Record<string, unknown>);
    }
    return out;
  } finally {
    stmt.free();
  }
}

function runAndGetChanges(db: SqlJsDatabase, sql: string, params: Array<string | number> = []): number {
  db.run(sql, params);
  const rows = queryRows(db, "SELECT changes() AS count");
  return Number(rows[0]?.count ?? 0);
}

function buildPlaceholders(count: number): string {
  return new Array(count).fill("?").join(",");
}

function hasTable(db: SqlJsDatabase, tableName: string): boolean {
  const rows = queryRows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1", [tableName]);
  return rows.length > 0;
}

function tableColumns(db: SqlJsDatabase, tableName: string): Set<string> {
  const rows = queryRows(db, `PRAGMA table_info(${tableName})`);
  const out = new Set<string>();
  for (const row of rows) {
    const column = row.name;
    if (typeof column === "string") {
      out.add(column);
    }
  }
  return out;
}

function selectThreadRows(db: SqlJsDatabase, threadIds: string[]): ThreadDbRow[] {
  if (!hasTable(db, "threads")) {
    return [];
  }
  const columns = tableColumns(db, "threads");
  if (!columns.has("id") || threadIds.length === 0) {
    return [];
  }
  const selected = ["id"];
  if (columns.has("title")) {
    selected.push("title");
  }
  if (columns.has("archived")) {
    selected.push("archived");
  }
  if (columns.has("rollout_path")) {
    selected.push("rollout_path");
  }
  const rows = queryRows(
    db,
    `SELECT ${selected.join(",")} FROM threads WHERE id IN (${buildPlaceholders(threadIds.length)})`,
    threadIds
  );
  return rows as ThreadDbRow[];
}

async function collectRolloutFiles(codexHome: string, threadIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (threadIds.length === 0) {
    return out;
  }
  const loweredTargets = threadIds.map((id) => id.toLowerCase());

  async function walk(dirPath: string): Promise<void> {
    const stat = await statSafe(dirPath);
    if (!stat?.isDirectory()) {
      return;
    }
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const loweredName = entry.name.toLowerCase();
      for (let idx = 0; idx < loweredTargets.length; idx += 1) {
        const loweredId = loweredTargets[idx];
        if (!loweredName.endsWith(`${loweredId}.jsonl`) && !loweredName.includes(loweredId)) {
          continue;
        }
        const threadId = threadIds[idx];
        const current = out.get(threadId);
        if (current) {
          current.push(fullPath);
        } else {
          out.set(threadId, [fullPath]);
        }
      }
    }
  }

  await walk(path.join(codexHome, "sessions"));
  await walk(path.join(codexHome, "archived_sessions"));
  return out;
}

function resolveTargets(snapshot: ProfilesSnapshot, codexHome: string, scope: ThreadCleanupScope, profileId?: string): CleanupProfileTarget[] {
  const existing = snapshot.profiles.filter((profile) => profile.exists);
  if (scope === "all") {
    if (existing.length === 0) {
      throw new Error("No available profiles found for cleanup.");
    }
    return existing.map((profile) => ({ profileId: profile.id, profileName: profile.name, codexHome: profile.path }));
  }

  if (scope === "single") {
    const targetProfileId = profileId?.trim();
    if (!targetProfileId) {
      throw new Error("scope=single requires profileId.");
    }
    const target = existing.find((profile) => profile.id === targetProfileId);
    if (!target) {
      throw new Error(`Profile not found: ${targetProfileId}`);
    }
    return [{ profileId: target.id, profileName: target.name, codexHome: target.path }];
  }

  const active = snapshot.activeProfileId ? existing.find((profile) => profile.id === snapshot.activeProfileId) : undefined;
  if (active) {
    return [{ profileId: active.id, profileName: active.name, codexHome: active.path }];
  }
  const live = existing.find((profile) => profile.id === "live");
  if (live) {
    return [{ profileId: live.id, profileName: live.name, codexHome: live.path }];
  }
  return [{ profileId: "active", profileName: "Active", codexHome }];
}

function combineBusyProcesses(items: BusyProcess[]): BusyProcess[] {
  const dedup = new Map<number, BusyProcess>();
  for (const item of items) {
    if (!dedup.has(item.pid)) {
      dedup.set(item.pid, item);
    }
  }
  return [...dedup.values()].sort((a, b) => a.pid - b.pid);
}

export async function previewThreadCleanup(params: {
  codexHome: string;
  threadIds: string[];
  scope: ThreadCleanupScope;
  profileId?: string;
  detectBusyProcesses?: BusyProcessDetector;
}): Promise<ThreadCleanupPreviewResult> {
  const codexHome = path.resolve(params.codexHome);
  const threadIds = splitAndNormalizeThreadIds(params.threadIds);
  if (threadIds.length === 0) {
    throw new Error("threadIds is empty.");
  }

  const snapshot = await getProfilesSnapshot(codexHome);
  const targets = resolveTargets(snapshot, codexHome, params.scope, params.profileId);
  const profiles: ThreadCleanupProfilePreview[] = [];
  const detectBusyProcesses = params.detectBusyProcesses ?? detectExternalBusyProcesses;

  for (const target of targets) {
    const context = await readProfileContext(target);
    const rolloutMap = await collectRolloutFiles(target.codexHome, threadIds);
    const threadMap = new Map<string, ThreadDbRow>();

    for (const dbPath of context.stateDbPaths) {
      let session: SqliteSession | undefined;
      try {
        session = await openSqliteSession(dbPath);
        const rows = selectThreadRows(session.db, threadIds);
        for (const row of rows) {
          if (!threadMap.has(row.id)) {
            threadMap.set(row.id, row);
          }
        }
      } catch {
        // Ignore broken sqlite for preview.
      } finally {
        if (session) {
          await closeSqliteSession(session);
        }
      }
    }

    const matches: ThreadCleanupThreadMatch[] = [];
    const missingThreadIds: string[] = [];
    let matchedFileCount = 0;

    for (const threadId of threadIds) {
      const fromDb = threadMap.get(threadId);
      const rolloutFiles = rolloutMap.get(threadId) ?? [];
      if (fromDb?.rollout_path && rolloutFiles.length === 0) {
        rolloutFiles.push(fromDb.rollout_path);
      }
      if (!fromDb && rolloutFiles.length === 0) {
        missingThreadIds.push(threadId);
        continue;
      }
      matchedFileCount += rolloutFiles.length;
      const titleFromState = context.globalState?.titles[threadId];
      const archivedFromFile = rolloutFiles.length > 0 && rolloutFiles.every((file) => normalizePathname(file).includes(`${path.sep}archived_sessions${path.sep}`));
      matches.push({
        id: threadId,
        title: fromDb?.title ?? titleFromState,
        archived: typeof fromDb?.archived === "number" ? fromDb.archived === 1 : archivedFromFile,
        rolloutPath: fromDb?.rollout_path ?? rolloutFiles[0],
        rolloutFiles
      });
    }

    profiles.push({
      profileId: target.profileId,
      profileName: target.profileName,
      codexHome: target.codexHome,
      matches,
      matchedFileCount,
      missingThreadIds,
      potentialBusyProcesses: await detectBusyProcesses([target.codexHome])
    });
  }

  const notFoundThreadIds = threadIds.filter((threadId) => profiles.every((profile) => profile.missingThreadIds.includes(threadId)));
  return {
    codexHome,
    scope: params.scope,
    profileId: params.profileId,
    threadIds,
    profiles,
    notFoundThreadIds,
    totalMatchedThreads: profiles.reduce((sum, p) => sum + p.matches.length, 0),
    totalMatchedFiles: profiles.reduce((sum, p) => sum + p.matchedFileCount, 0)
  };
}

function collectProfileFilesForBackup(context: PreviewProfileContext, preview: ThreadCleanupProfilePreview): string[] {
  const out = new Set<string>();
  for (const dbPath of context.stateDbSidecarPaths) {
    out.add(path.resolve(dbPath));
  }
  for (const match of preview.matches) {
    for (const rolloutFile of match.rolloutFiles) {
      out.add(path.resolve(rolloutFile));
    }
  }
  if (context.globalState?.filePath) {
    out.add(path.resolve(context.globalState.filePath));
  }
  return [...out.values()];
}

async function backupFiles(
  backupRoot: string,
  context: PreviewProfileContext,
  preview: ThreadCleanupProfilePreview,
  manifest: BackupManifest
): Promise<void> {
  const files = collectProfileFilesForBackup(context, preview);
  const profileManifest = {
    profileId: preview.profileId,
    profileName: preview.profileName,
    files: [] as Array<{ sourcePath: string; backupPath: string; size: number }>
  };

  for (const sourcePath of files) {
    const stat = await statSafe(sourcePath);
    if (!stat?.isFile()) {
      continue;
    }
    const relative = path.relative(context.target.codexHome, sourcePath);
    const safeRelative = relative.startsWith("..") ? path.basename(sourcePath) : relative;
    const targetPath = path.join(backupRoot, "profiles", preview.profileId, safeRelative);
    await ensureDirectory(path.dirname(targetPath));
    await fs.copyFile(sourcePath, targetPath);
    profileManifest.files.push({ sourcePath, backupPath: targetPath, size: stat.size });
  }

  manifest.profiles.push(profileManifest);
}

function executeDeleteStatements(db: SqlJsDatabase, threadIds: string[]): { threads: number; logs: number; dynamicTools: number } {
  if (threadIds.length === 0) {
    return { threads: 0, logs: 0, dynamicTools: 0 };
  }
  const placeholders = buildPlaceholders(threadIds.length);
  const out = { threads: 0, logs: 0, dynamicTools: 0 };

  db.run("BEGIN TRANSACTION");
  try {
    if (hasTable(db, "threads")) {
      out.threads += runAndGetChanges(db, `DELETE FROM threads WHERE id IN (${placeholders})`, threadIds);
    }
    if (hasTable(db, "logs") && tableColumns(db, "logs").has("thread_id")) {
      out.logs += runAndGetChanges(db, `DELETE FROM logs WHERE thread_id IN (${placeholders})`, threadIds);
    }
    if (hasTable(db, "thread_dynamic_tools") && tableColumns(db, "thread_dynamic_tools").has("thread_id")) {
      out.dynamicTools += runAndGetChanges(db, `DELETE FROM thread_dynamic_tools WHERE thread_id IN (${placeholders})`, threadIds);
    }
    db.run("COMMIT");
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {
      // ignore rollback failures
    }
    throw error;
  }

  return out;
}

function verifyDbResidual(db: SqlJsDatabase, threadIds: string[]): number {
  if (threadIds.length === 0) {
    return 0;
  }
  const placeholders = buildPlaceholders(threadIds.length);
  let residual = 0;
  if (hasTable(db, "threads")) {
    const row = queryRows(db, `SELECT COUNT(1) AS count FROM threads WHERE id IN (${placeholders})`, threadIds)[0];
    residual += Number(row?.count ?? 0);
  }
  if (hasTable(db, "logs") && tableColumns(db, "logs").has("thread_id")) {
    const row = queryRows(db, `SELECT COUNT(1) AS count FROM logs WHERE thread_id IN (${placeholders})`, threadIds)[0];
    residual += Number(row?.count ?? 0);
  }
  if (hasTable(db, "thread_dynamic_tools") && tableColumns(db, "thread_dynamic_tools").has("thread_id")) {
    const row = queryRows(db, `SELECT COUNT(1) AS count FROM thread_dynamic_tools WHERE thread_id IN (${placeholders})`, threadIds)[0];
    residual += Number(row?.count ?? 0);
  }
  return residual;
}

async function cleanupGlobalStateFile(context: PreviewProfileContext, threadIds: string[]): Promise<{ titlesDeleted: number; orderDeleted: number; residual: number; warning?: string }> {
  const globalStatePath = context.globalState?.filePath;
  if (!globalStatePath) {
    return { titlesDeleted: 0, orderDeleted: 0, residual: 0 };
  }

  try {
    const raw = await fs.readFile(globalStatePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const root = asRecord(parsed);
    const atom = root ? asRecord(root["electron-persisted-atom-state"]) : undefined;
    const threadTitles = atom ? asRecord(atom["thread-titles"]) : undefined;

    if (!root || !atom || !threadTitles) {
      return { titlesDeleted: 0, orderDeleted: 0, residual: 0, warning: `${GLOBAL_STATE_FILE} missing expected thread-titles structure` };
    }

    const titlesRecord = asRecord(threadTitles.titles) ?? {};
    const orderRaw = Array.isArray(threadTitles.order) ? threadTitles.order.filter((item): item is string => typeof item === "string") : [];

    let titlesDeleted = 0;
    for (const threadId of threadIds) {
      if (threadId in titlesRecord) {
        delete titlesRecord[threadId];
        titlesDeleted += 1;
      }
    }

    const order = orderRaw.filter((item) => !threadIds.includes(item));
    const orderDeleted = Math.max(0, orderRaw.length - order.length);

    atom["thread-titles"] = {
      ...threadTitles,
      titles: titlesRecord,
      order
    };
    root["electron-persisted-atom-state"] = atom;

    await fs.writeFile(globalStatePath, JSON.stringify(root), "utf8");

    const residual =
      Object.keys(titlesRecord).filter((key) => threadIds.includes(key)).length +
      order.filter((item) => threadIds.includes(item)).length;
    return { titlesDeleted, orderDeleted, residual };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { titlesDeleted: 0, orderDeleted: 0, residual: 0, warning: `Failed to clean ${GLOBAL_STATE_FILE}: ${reason}` };
  }
}

async function removeRolloutFiles(files: string[]): Promise<{ deleted: number; residual: number }> {
  const unique = [...new Set(files.map((file) => path.resolve(file)))];
  let deleted = 0;
  for (const filePath of unique) {
    const stat = await statSafe(filePath);
    if (!stat?.isFile()) {
      continue;
    }
    await fs.rm(filePath, { force: true });
    deleted += 1;
  }

  let residual = 0;
  for (const filePath of unique) {
    if ((await statSafe(filePath))?.isFile()) {
      residual += 1;
    }
  }
  return { deleted, residual };
}

async function executeProfileCleanup(
  context: PreviewProfileContext,
  preview: ThreadCleanupProfilePreview,
  threadIds: string[]
): Promise<{
  deleted: ThreadCleanupProfileExecuteResult["deleted"];
  verification: ThreadCleanupProfileExecuteResult["verification"];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const deleted = {
    threads: 0,
    logs: 0,
    dynamicTools: 0,
    files: 0,
    globalStateTitles: 0,
    globalStateOrder: 0
  };

  let dbResidual = 0;
  for (const dbPath of context.stateDbPaths) {
    let session: SqliteSession | undefined;
    try {
      session = await openSqliteSession(dbPath);
      const dbDeleted = executeDeleteStatements(session.db, threadIds);
      deleted.threads += dbDeleted.threads;
      deleted.logs += dbDeleted.logs;
      deleted.dynamicTools += dbDeleted.dynamicTools;
      dbResidual += verifyDbResidual(session.db, threadIds);
      if (dbDeleted.threads + dbDeleted.logs + dbDeleted.dynamicTools > 0) {
        session.dirty = true;
      }
    } finally {
      if (session) {
        await closeSqliteSession(session);
      }
    }
  }

  const fileResult = await removeRolloutFiles(preview.matches.flatMap((match) => match.rolloutFiles));
  deleted.files += fileResult.deleted;

  const globalStateResult = await cleanupGlobalStateFile(context, threadIds);
  deleted.globalStateTitles += globalStateResult.titlesDeleted;
  deleted.globalStateOrder += globalStateResult.orderDeleted;
  if (globalStateResult.warning) {
    warnings.push(globalStateResult.warning);
  }

  return {
    deleted,
    verification: {
      dbResidual,
      fileResidual: fileResult.residual,
      globalStateResidual: globalStateResult.residual,
      clean: dbResidual + fileResult.residual + globalStateResult.residual === 0
    },
    warnings
  };
}

async function maybeKillBusyProcesses(
  paths: string[],
  alreadyKilled: Set<number>,
  detectBusyProcesses: BusyProcessDetector,
  killProcesses: ProcessKiller
): Promise<{ killed: number; busy: BusyProcess[] }> {
  const busy = combineBusyProcesses(await detectBusyProcesses(paths));
  if (busy.length === 0) {
    return { killed: 0, busy: [] };
  }
  const killTargets = busy.map((item) => item.pid).filter((pid) => !alreadyKilled.has(pid));
  const killResult = await killProcesses(killTargets);
  for (const pid of killTargets) {
    alreadyKilled.add(pid);
  }
  return { killed: killResult.killedCount, busy };
}

export async function executeThreadCleanup(params: {
  codexHome: string;
  threadIds: string[];
  scope: ThreadCleanupScope;
  profileId?: string;
  backupEnabled: boolean;
  applyMode: ThreadCleanupApplyMode;
  onLog?: (message: string) => void;
  detectBusyProcesses?: BusyProcessDetector;
  killProcesses?: ProcessKiller;
}): Promise<ThreadCleanupResult> {
  const detectBusyProcesses = params.detectBusyProcesses ?? detectExternalBusyProcesses;
  const killProcesses = params.killProcesses ?? forceKillProcesses;

  const preview = await previewThreadCleanup({
    codexHome: params.codexHome,
    threadIds: params.threadIds,
    scope: params.scope,
    profileId: params.profileId,
    detectBusyProcesses
  });

  const result: ThreadCleanupResult = {
    codexHome: preview.codexHome,
    scope: preview.scope,
    profileId: preview.profileId,
    threadIds: preview.threadIds,
    backupEnabled: params.backupEnabled,
    backupPath: undefined,
    applyMode: params.applyMode,
    killTriggered: false,
    killedCount: 0,
    notFoundThreadIds: preview.notFoundThreadIds,
    profiles: []
  };

  const timestamp = timestampLocal();
  const backupPath = path.join(os.homedir(), "codex-backup", "thread-cleanup", timestamp);
  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    codexHome: preview.codexHome,
    scope: preview.scope,
    profileId: preview.profileId,
    threadIds: preview.threadIds,
    profiles: []
  };

  if (params.backupEnabled) {
    await ensureDirectory(backupPath);
    result.backupPath = backupPath;
  }

  const killedPids = new Set<number>();

  for (const profilePreview of preview.profiles) {
    const target: CleanupProfileTarget = {
      profileId: profilePreview.profileId,
      profileName: profilePreview.profileName,
      codexHome: profilePreview.codexHome
    };
    const profileResult: ThreadCleanupProfileExecuteResult = {
      profileId: profilePreview.profileId,
      profileName: profilePreview.profileName,
      codexHome: profilePreview.codexHome,
      deleted: {
        threads: 0,
        logs: 0,
        dynamicTools: 0,
        files: 0,
        globalStateTitles: 0,
        globalStateOrder: 0
      },
      verification: {
        dbResidual: 0,
        fileResidual: 0,
        globalStateResidual: 0,
        clean: true
      },
      locked: false,
      busyProcesses: [],
      warnings: [],
      errors: []
    };

    if (profilePreview.matches.length === 0) {
      result.profiles.push(profileResult);
      continue;
    }

    const context = await readProfileContext(target);

    try {
      if (params.backupEnabled) {
        await backupFiles(backupPath, context, profilePreview, manifest);
      }

      const attempt = async (): Promise<void> => {
        const execution = await executeProfileCleanup(context, profilePreview, preview.threadIds);
        profileResult.deleted = execution.deleted;
        profileResult.verification = execution.verification;
        profileResult.warnings.push(...execution.warnings);
      };

      try {
        await attempt();
      } catch (error) {
        if (!isLikelyLockError(error)) {
          throw error;
        }

        if (params.applyMode === "restartLater") {
          const busy = combineBusyProcesses(await detectBusyProcesses([target.codexHome]));
          profileResult.locked = true;
          profileResult.busyProcesses = busy;
          profileResult.verification.clean = false;
          profileResult.errors.push("Database is locked. Please restart Codex and run cleanup again.");
          result.profiles.push(profileResult);
          continue;
        }

        const lockBusy = await maybeKillBusyProcesses([target.codexHome], killedPids, detectBusyProcesses, killProcesses);
        if (lockBusy.killed > 0) {
          result.killTriggered = true;
          result.killedCount += lockBusy.killed;
          profileResult.busyProcesses = lockBusy.busy;
          params.onLog?.(`Retried after killing ${lockBusy.killed} process(es) for profile ${target.profileName}.`);
        }

        await attempt();
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      profileResult.verification.clean = false;
      profileResult.errors.push(reason);
    }

    result.profiles.push(profileResult);
  }

  if (params.backupEnabled) {
    await fs.writeFile(path.join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  return result;
}

export async function ensureThreadCleanupUnlocked(paths: string[], detectBusyProcesses: BusyProcessDetector = detectExternalBusyProcesses): Promise<void> {
  const busy = await detectBusyProcesses(paths);
  if (busy.length === 0) {
    return;
  }
  throw createFileLockedError("Detected busy processes during thread cleanup.", busy);
}

export const __internal = {
  splitAndNormalizeThreadIds,
  isLikelyLockError
};
