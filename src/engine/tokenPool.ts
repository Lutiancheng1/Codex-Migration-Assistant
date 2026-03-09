import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { statSafe } from "./fileTree";
import {
  getProfilesSnapshot,
  invalidateProfileUsage,
  ensureProfileSlot,
  POOL_RUNNER_PROFILE_ID,
  POOL_RUNNER_PROFILE_NAME
} from "./profiles";
import {
  decodeJwtPayload,
  extractAccountIdFromClaims,
  extractEmailFromClaims,
  extractPlanTypeFromClaims,
  fetchUsageForIdentity,
  type AuthIdentity,
  type ProfileUsageSummary
} from "./usage";
import { resolveCodexHome } from "../util/path";
import { getLogger } from "../util/logger";
import { detectExternalBusyProcesses, forceKillProcesses, relaunchKilledProcesses } from "./processGuard";

export type TokenPoolStatus = "neverChecked" | "available" | "exhausted" | "authInvalid" | "incomplete";

export type TokenPoolSettings = {
  autoSwitchEnabled: boolean;
  pollIntervalMs: number;
  autoRelaunchAfterSwitch: boolean;
};

export type TokenPoolEntry = {
  id: string;
  email?: string;
  accountId: string;
  type?: string;
  expired?: string;
  lastRefresh?: string;
  importedAt: string;
  updatedAt: string;
  planTypeHint?: string;
  usage?: ProfileUsageSummary;
  usageError?: string;
  status: TokenPoolStatus;
  current: boolean;
};

export type TokenPoolSnapshot = {
  entries: TokenPoolEntry[];
  activeEntryId?: string;
  settings: TokenPoolSettings;
  lastAutoSwitchAt?: string;
  lastAutoSwitchMessage?: string;
};

type TokenPoolSecret = {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  accountId: string;
  lastRefresh?: string;
  email?: string;
  expired?: string;
  type?: string;
  planTypeHint?: string;
};

type TokenPoolEntryMeta = Omit<TokenPoolEntry, "current">;

type TokenPoolMetadata = {
  version: 1;
  activeEntryId?: string;
  settings: TokenPoolSettings;
  lastAutoSwitchAt?: string;
  lastAutoSwitchMessage?: string;
  entries: TokenPoolEntryMeta[];
};

type ImportSummary = {
  imported: number;
  replaced: number;
  skipped: number;
};

const META_KEY = "codexMigration.tokenPool.meta.v1";
const SECRET_PREFIX = "codexMigration.tokenPool.secret.";
const DEFAULT_INTERVAL = 5 * 60 * 1000;

type ImportableJson = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultMetadata(): TokenPoolMetadata {
  return {
    version: 1,
    activeEntryId: undefined,
    settings: {
      autoSwitchEnabled: false,
      pollIntervalMs: DEFAULT_INTERVAL,
      autoRelaunchAfterSwitch: false
    },
    entries: []
  };
}

function secretKey(id: string): string {
  return `${SECRET_PREFIX}${id}`;
}

function normalizeInterval(value: number): number {
  const allowed = new Set([0, 60_000, 3 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]);
  return allowed.has(value) ? value : DEFAULT_INTERVAL;
}

function normalizeStatus(status: TokenPoolStatus | undefined): TokenPoolStatus {
  return status ?? "neverChecked";
}

function isAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("未授权");
}

function inferStatus(entry: Pick<TokenPoolEntryMeta, "usage" | "usageError" | "planTypeHint">): TokenPoolStatus {
  if (entry.usageError) {
    return isAuthError(entry.usageError) ? "authInvalid" : "incomplete";
  }
  if (!entry.usage) {
    return "neverChecked";
  }

  const plan = (entry.usage.planType || entry.planTypeHint || "").toLowerCase();
  if (plan.includes("free")) {
    if (!entry.usage.oneWeek) {
      return "incomplete";
    }
    return entry.usage.oneWeek.remainingPercent <= 0 ? "exhausted" : "available";
  }

  if (!entry.usage.fiveHour || !entry.usage.oneWeek) {
    return "incomplete";
  }
  return entry.usage.fiveHour.remainingPercent <= 0 || entry.usage.oneWeek.remainingPercent <= 0 ? "exhausted" : "available";
}

function isAvailableForSwitch(entry: Pick<TokenPoolEntryMeta, "status">): boolean {
  return normalizeStatus(entry.status) === "available";
}

function safeTrim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNestedTokenShape(raw: ImportableJson): Record<string, unknown> | undefined {
  const tokens = raw.tokens;
  return tokens && typeof tokens === "object" ? (tokens as Record<string, unknown>) : undefined;
}

function normalizeImportedToken(raw: ImportableJson): TokenPoolSecret {
  const nested = readNestedTokenShape(raw);
  const accessToken = safeTrim(nested?.access_token ?? raw.access_token);
  const idToken = safeTrim(nested?.id_token ?? raw.id_token);
  const refreshToken = safeTrim(nested?.refresh_token ?? raw.refresh_token);
  const directAccountId = safeTrim(nested?.account_id ?? raw.account_id);
  const idClaims = idToken ? decodeJwtPayload(idToken) : undefined;
  const accountId = directAccountId ?? extractAccountIdFromClaims(idClaims);

  if (!accessToken || !idToken || !refreshToken || !accountId) {
    throw new Error("JSON 缺少必要认证字段");
  }

  const email = safeTrim(raw.email) ?? extractEmailFromClaims(idClaims);
  const lastRefresh = safeTrim(raw.last_refresh) ?? safeTrim(raw.lastRefresh);
  const expired = safeTrim(raw.expired) ?? safeTrim(raw.expires_at);
  const type = safeTrim(raw.type) ?? "codex";
  const planTypeHint = extractPlanTypeFromClaims(idClaims);

  return {
    accessToken,
    idToken,
    refreshToken,
    accountId,
    lastRefresh,
    email,
    expired,
    type,
    planTypeHint
  };
}

async function readJsonFile(filePath: string): Promise<ImportableJson> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as ImportableJson;
}

async function resolveActiveProfilePath(codexHome: string): Promise<string> {
  const snapshot = await getProfilesSnapshot(codexHome);
  if (snapshot.activeProfileId) {
    const active = snapshot.profiles.find((item) => item.id === snapshot.activeProfileId && item.exists);
    if (active) {
      return active.path;
    }
  }
  const live = snapshot.profiles.find((item) => item.id === "live" && item.exists);
  if (live) {
    return live.path;
  }
  return codexHome;
}

type PoolRunnerProfileRef = {
  path: string;
  active: boolean;
};

async function resolvePoolRunnerProfile(codexHome: string, ensure = false): Promise<PoolRunnerProfileRef | undefined> {
  if (ensure) {
    await ensureProfileSlot(codexHome, POOL_RUNNER_PROFILE_ID, POOL_RUNNER_PROFILE_NAME);
  }
  const snapshot = await getProfilesSnapshot(codexHome);
  const profile = snapshot.profiles.find((item) => item.id === POOL_RUNNER_PROFILE_ID && item.exists);
  if (!profile) {
    return undefined;
  }
  return {
    path: profile.path,
    active: snapshot.activeProfileId === POOL_RUNNER_PROFILE_ID
  };
}

async function readCurrentAuthAccountId(profilePath: string): Promise<string | undefined> {
  const authPath = path.join(profilePath, "auth.json");
  const st = await statSafe(authPath);
  if (!st?.isFile()) {
    return undefined;
  }
  try {
    const raw = JSON.parse(await fs.readFile(authPath, "utf8")) as Record<string, unknown>;
    const tokens = (raw.tokens && typeof raw.tokens === "object" ? raw.tokens : undefined) as Record<string, unknown> | undefined;
    const direct = safeTrim(tokens?.account_id);
    if (direct) {
      return direct;
    }
    const idToken = safeTrim(tokens?.id_token);
    return idToken ? extractAccountIdFromClaims(decodeJwtPayload(idToken)) : undefined;
  } catch {
    return undefined;
  }
}

async function readChatgptBaseUrl(profilePath: string): Promise<string | undefined> {
  const configPath = path.join(profilePath, "config.toml");
  const st = await statSafe(configPath);
  if (!st?.isFile()) {
    return undefined;
  }
  const content = await fs.readFile(configPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("chatgpt_base_url")) {
      continue;
    }
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 0) {
      continue;
    }
    const value = trimmed.slice(equalIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
}

class TokenPoolService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly logEmitter = new vscode.EventEmitter<{ level: "info" | "warn" | "error"; message: string }>();
  private timer: NodeJS.Timeout | undefined;
  private tickRunning = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.restartTimer();
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.changeEmitter.dispose();
    this.logEmitter.dispose();
  }

  onDidChange(listener: () => void): vscode.Disposable {
    return this.changeEmitter.event(listener);
  }

  onDidLog(listener: (payload: { level: "info" | "warn" | "error"; message: string }) => void): vscode.Disposable {
    return this.logEmitter.event(listener);
  }

  private emitLog(level: "info" | "warn" | "error", message: string): void {
    getLogger().appendLine(`[token-pool:${level}] ${message}`);
    this.logEmitter.fire({ level, message });
  }

  private readMeta(): TokenPoolMetadata {
    const raw = this.context.globalState.get<TokenPoolMetadata>(META_KEY);
    if (!raw || raw.version !== 1 || !Array.isArray(raw.entries)) {
      return defaultMetadata();
    }
    return {
      version: 1,
      activeEntryId: raw.activeEntryId,
      settings: {
        autoSwitchEnabled: !!raw.settings?.autoSwitchEnabled,
        pollIntervalMs: normalizeInterval(raw.settings?.pollIntervalMs ?? DEFAULT_INTERVAL),
        autoRelaunchAfterSwitch: !!raw.settings?.autoRelaunchAfterSwitch
      },
      lastAutoSwitchAt: raw.lastAutoSwitchAt,
      lastAutoSwitchMessage: raw.lastAutoSwitchMessage,
      entries: raw.entries.map((entry) => ({
        ...entry,
        status: normalizeStatus(entry.status)
      }))
    };
  }

  private async writeMeta(meta: TokenPoolMetadata): Promise<void> {
    await this.context.globalState.update(META_KEY, meta);
    this.restartTimer(meta);
    this.changeEmitter.fire();
  }

  private restartTimer(meta = this.readMeta()): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (!meta.settings.autoSwitchEnabled || meta.settings.pollIntervalMs <= 0) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runAutoSwitchTick();
    }, meta.settings.pollIntervalMs);
  }

  private async readSecret(entryId: string): Promise<TokenPoolSecret | undefined> {
    const raw = await this.context.secrets.get(secretKey(entryId));
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as TokenPoolSecret;
    } catch {
      return undefined;
    }
  }

  private async writeSecret(entryId: string, secret: TokenPoolSecret): Promise<void> {
    await this.context.secrets.store(secretKey(entryId), JSON.stringify(secret));
  }

  private async deleteSecret(entryId: string): Promise<void> {
    await this.context.secrets.delete(secretKey(entryId));
  }

  private async detectActiveEntryId(codexHome: string, meta: TokenPoolMetadata): Promise<string | undefined> {
    const poolRunner = await resolvePoolRunnerProfile(codexHome);
    const currentAccountId = poolRunner ? await readCurrentAuthAccountId(poolRunner.path) : undefined;
    if (!currentAccountId) {
      return meta.activeEntryId;
    }
    const matched = meta.entries.find((entry) => entry.accountId === currentAccountId);
    return matched?.id ?? meta.activeEntryId;
  }

  async getSnapshot(codexHomeOverride?: string): Promise<TokenPoolSnapshot> {
    const codexHome = resolveCodexHome(codexHomeOverride);
    const meta = this.readMeta();
    const activeEntryId = await this.detectActiveEntryId(codexHome, meta);
    return {
      activeEntryId,
      settings: meta.settings,
      lastAutoSwitchAt: meta.lastAutoSwitchAt,
      lastAutoSwitchMessage: meta.lastAutoSwitchMessage,
      entries: meta.entries.map((entry) => ({
        ...entry,
        current: entry.id === activeEntryId,
        status: normalizeStatus(entry.status)
      }))
    };
  }

  hasEntry(entryId: string): boolean {
    return this.readMeta().entries.some((entry) => entry.id === entryId);
  }

  async importFiles(filePaths: string[]): Promise<TokenPoolSnapshot> {
    const meta = this.readMeta();
    const summary: ImportSummary = { imported: 0, replaced: 0, skipped: 0 };

    for (const filePath of filePaths) {
      try {
        const parsed = normalizeImportedToken(await readJsonFile(filePath));
        const duplicateIndex = meta.entries.findIndex((entry) => entry.accountId === parsed.accountId || (!!parsed.email && entry.email === parsed.email));
        const nextMeta: TokenPoolEntryMeta = {
          id: duplicateIndex >= 0 ? meta.entries[duplicateIndex].id : `${parsed.accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          email: parsed.email,
          accountId: parsed.accountId,
          type: parsed.type,
          expired: parsed.expired,
          lastRefresh: parsed.lastRefresh,
          importedAt: duplicateIndex >= 0 ? meta.entries[duplicateIndex].importedAt : nowIso(),
          updatedAt: nowIso(),
          planTypeHint: parsed.planTypeHint,
          usage: duplicateIndex >= 0 ? meta.entries[duplicateIndex].usage : undefined,
          usageError: duplicateIndex >= 0 ? meta.entries[duplicateIndex].usageError : undefined,
          status: duplicateIndex >= 0 ? meta.entries[duplicateIndex].status : "neverChecked"
        };
        await this.writeSecret(nextMeta.id, parsed);
        if (duplicateIndex >= 0) {
          meta.entries.splice(duplicateIndex, 1, nextMeta);
          summary.replaced += 1;
        } else {
          meta.entries.push(nextMeta);
          summary.imported += 1;
        }
      } catch {
        summary.skipped += 1;
      }
    }

    await this.writeMeta(meta);
    this.emitLog("info", `账号池导入完成：新增 ${summary.imported}，覆盖 ${summary.replaced}，跳过 ${summary.skipped}。`);
    return this.getSnapshot();
  }

  async importDirectory(directoryPath: string): Promise<TokenPoolSnapshot> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => path.join(directoryPath, entry.name));
    return this.importFiles(files);
  }

  private async refreshUsageForMeta(meta: TokenPoolEntryMeta, codexHomeOverride?: string): Promise<TokenPoolEntryMeta> {
    const secret = await this.readSecret(meta.id);
    if (!secret) {
      return {
        ...meta,
        usage: undefined,
        usageError: "账号池条目缺少敏感 token 数据",
        status: "authInvalid",
        updatedAt: nowIso()
      };
    }

    const codexHome = resolveCodexHome(codexHomeOverride);
    const poolRunner = await resolvePoolRunnerProfile(codexHome);
    const baseUrl = await readChatgptBaseUrl(poolRunner?.path ?? (await resolveActiveProfilePath(codexHome)));
    try {
      const usage = await fetchUsageForIdentity({ accessToken: secret.accessToken, accountId: secret.accountId } satisfies AuthIdentity, baseUrl);
      const next: TokenPoolEntryMeta = {
        ...meta,
        planTypeHint: usage.planType || meta.planTypeHint || secret.planTypeHint,
        usage,
        usageError: undefined,
        status: "neverChecked",
        updatedAt: nowIso()
      };
      next.status = inferStatus(next);
      return next;
    } catch (error) {
      const message = (error as Error).message || "额度查询失败";
      const next: TokenPoolEntryMeta = {
        ...meta,
        usageError: message,
        status: isAuthError(message) ? "authInvalid" : "incomplete",
        updatedAt: nowIso()
      };
      return next;
    }
  }

  async refreshEntryUsage(entryId: string, codexHomeOverride?: string): Promise<TokenPoolSnapshot> {
    const meta = this.readMeta();
    const index = meta.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) {
      throw new Error("未找到账号池条目。");
    }
    meta.entries[index] = await this.refreshUsageForMeta(meta.entries[index], codexHomeOverride);
    await this.writeMeta(meta);
    const item = meta.entries[index];
    this.emitLog("info", `已刷新账号池条目 ${item.email || item.accountId} 的额度。`);
    return this.getSnapshot(codexHomeOverride);
  }

  async setSettings(settings: Partial<TokenPoolSettings>): Promise<TokenPoolSnapshot> {
    const meta = this.readMeta();
    meta.settings = {
      autoSwitchEnabled: settings.autoSwitchEnabled ?? meta.settings.autoSwitchEnabled,
      pollIntervalMs: normalizeInterval(settings.pollIntervalMs ?? meta.settings.pollIntervalMs),
      autoRelaunchAfterSwitch: settings.autoRelaunchAfterSwitch ?? meta.settings.autoRelaunchAfterSwitch
    };
    await this.writeMeta(meta);
    this.emitLog(
      "info",
      `账号池自动切换已${meta.settings.autoSwitchEnabled ? "开启" : "关闭"}，检测间隔 ${meta.settings.pollIntervalMs === 0 ? "禁用" : `${meta.settings.pollIntervalMs / 60000} 分钟`}，切换后${meta.settings.autoRelaunchAfterSwitch ? "自动重启 Codex" : "手动重启生效"}。`
    );
    return this.getSnapshot();
  }

  async deleteEntry(entryId: string): Promise<TokenPoolSnapshot> {
    const meta = this.readMeta();
    const target = meta.entries.find((entry) => entry.id === entryId);
    meta.entries = meta.entries.filter((entry) => entry.id !== entryId);
    if (meta.activeEntryId === entryId) {
      meta.activeEntryId = undefined;
    }
    await this.deleteSecret(entryId);
    await this.writeMeta(meta);
    if (target) {
      this.emitLog("info", `已删除账号池条目: ${target.email || target.accountId}`);
    }
    return this.getSnapshot();
  }

  async moveEntry(entryId: string, direction: "up" | "down"): Promise<TokenPoolSnapshot> {
    const meta = this.readMeta();
    const index = meta.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) {
      throw new Error("未找到账号池条目。");
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= meta.entries.length) {
      return this.getSnapshot();
    }
    const [item] = meta.entries.splice(index, 1);
    meta.entries.splice(targetIndex, 0, item);
    await this.writeMeta(meta);
    return this.getSnapshot();
  }

  private async writePatchedAuthJson(profilePath: string, secret: TokenPoolSecret): Promise<void> {
    const authPath = path.join(profilePath, "auth.json");
    const existingStat = await statSafe(authPath);
    let parsed: Record<string, unknown> = {};
    if (existingStat?.isFile()) {
      try {
        parsed = JSON.parse(await fs.readFile(authPath, "utf8")) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    }
    const tokens = parsed.tokens && typeof parsed.tokens === "object" ? { ...(parsed.tokens as Record<string, unknown>) } : {};
    tokens.access_token = secret.accessToken;
    tokens.account_id = secret.accountId;
    tokens.id_token = secret.idToken;
    tokens.refresh_token = secret.refreshToken;
    parsed.tokens = tokens;
    parsed.last_refresh = secret.lastRefresh ?? parsed.last_refresh ?? nowIso();
    await fs.writeFile(authPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  private async maybeRelaunchCodex(codexHome: string, reason: "manual" | "auto"): Promise<void> {
    const meta = this.readMeta();
    if (!meta.settings.autoRelaunchAfterSwitch) {
      this.emitLog("warn", "账号池已写入 pool-runner 登录态。若当前正在使用 pool-runner，请手动重启 Codex 或执行 Reload Window 使其生效。");
      return;
    }

    const busy = await detectExternalBusyProcesses([codexHome]);
    let commands = busy.map((item) => item.command).filter((item) => item.trim().length > 0);
    if (commands.length === 0) {
      commands = ["codex"];
    }

    if (busy.length > 0) {
      this.emitLog("info", `${reason === "auto" ? "自动切换后" : "账号池切换后"}即将尝试重启 Codex，共检测到 ${busy.length} 个占用进程。`);
      const { killedCount } = await forceKillProcesses(busy.map((item) => item.pid));
      this.emitLog("info", `账号池切换后已结束 ${killedCount} 个进程。`);
    } else {
      this.emitLog("info", "账号池切换后未检测到可重启进程，将直接尝试启动 Codex。");
    }

    const relaunch = await relaunchKilledProcesses(commands);
    if (relaunch.attempted.length > 0) {
      this.emitLog("info", `账号池切换后已尝试恢复启动客户端: ${relaunch.attempted.join(", ")}`);
    }
    if (relaunch.succeeded.length > 0) {
      this.emitLog("info", `恢复启动成功: ${relaunch.succeeded.join(", ")}`);
      return;
    }
    if (relaunch.failed.length > 0) {
      this.emitLog("warn", `恢复启动失败: ${relaunch.failed.join(", ")}`);
    }
    if (busy.length === 0 && relaunch.attempted.length === 0) {
      this.emitLog("warn", "账号池已写入 pool-runner 登录态，但当前系统未识别到可启动的 Codex 客户端。请手动打开 Codex。");
    }
  }

  async activateEntry(entryId: string, codexHomeOverride?: string, reason: "manual" | "auto" = "manual"): Promise<TokenPoolSnapshot> {
    const meta = this.readMeta();
    const entry = meta.entries.find((item) => item.id === entryId);
    if (!entry) {
      throw new Error("未找到账号池条目。");
    }
    const secret = await this.readSecret(entryId);
    if (!secret) {
      throw new Error("账号池条目缺少敏感 token 数据。");
    }
    const codexHome = resolveCodexHome(codexHomeOverride);
    const poolRunner = await resolvePoolRunnerProfile(codexHome, false);
    if (!poolRunner) {
      throw new Error("未找到 pool-runner 槽位，请先执行“同步当前记录到池槽位”。");
    }
    if (!poolRunner.active) {
      throw new Error("账号池只允许在 pool-runner 槽位中操作。请先切换到 pool-runner，再执行 token 切换。");
    }
    if (reason === "manual" && entry.status === "exhausted") {
      throw new Error(`账号 ${entry.email || entry.accountId} 当前额度已用尽，已阻止手动切换。`);
    }

    await this.writePatchedAuthJson(poolRunner.path, secret);
    invalidateProfileUsage(poolRunner.path);
    meta.activeEntryId = entryId;
    if (reason === "auto") {
      meta.lastAutoSwitchAt = nowIso();
      meta.lastAutoSwitchMessage = `已自动切换到 ${entry.email || entry.accountId}`;
    }
    await this.writeMeta(meta);
    this.emitLog(
      "info",
      reason === "auto"
        ? `额度触发自动切换，已将 pool-runner 登录态切换到账号池条目: ${entry.email || entry.accountId}`
        : `已将 pool-runner 登录态切换到账号池条目: ${entry.email || entry.accountId}`
    );
    await this.maybeRelaunchCodex(codexHome, reason);
    if (reason === "auto") {
      void vscode.window.showInformationMessage(`Codex 账号池已自动切换到 ${entry.email || entry.accountId}`);
    }
    return this.getSnapshot(codexHomeOverride);
  }

  private rotateCandidates(entries: TokenPoolEntryMeta[], activeEntryId?: string): TokenPoolEntryMeta[] {
    if (!activeEntryId) {
      return [...entries];
    }
    const index = entries.findIndex((entry) => entry.id === activeEntryId);
    if (index < 0) {
      return [...entries];
    }
    return [...entries.slice(index + 1), ...entries.slice(0, index)];
  }

  private async runAutoSwitchTick(): Promise<void> {
    if (this.tickRunning) {
      return;
    }
    this.tickRunning = true;
    try {
      const codexHome = resolveCodexHome();
      const meta = this.readMeta();
      if (!meta.settings.autoSwitchEnabled || meta.settings.pollIntervalMs <= 0 || meta.entries.length === 0) {
        return;
      }

      const poolRunner = await resolvePoolRunnerProfile(codexHome);
      if (!poolRunner?.active) {
        return;
      }

      const activeEntryId = await this.detectActiveEntryId(codexHome, meta);
      if (!activeEntryId) {
        return;
      }

      const currentIndex = meta.entries.findIndex((entry) => entry.id === activeEntryId);
      if (currentIndex < 0) {
        return;
      }

      meta.entries[currentIndex] = await this.refreshUsageForMeta(meta.entries[currentIndex], codexHome);
      if (isAvailableForSwitch(meta.entries[currentIndex])) {
        await this.writeMeta(meta);
        return;
      }

      const candidates = this.rotateCandidates(meta.entries, activeEntryId).filter((entry) => entry.id !== activeEntryId);
      for (const candidate of candidates) {
        const candidateIndex = meta.entries.findIndex((entry) => entry.id === candidate.id);
        if (candidateIndex < 0) {
          continue;
        }
        meta.entries[candidateIndex] = await this.refreshUsageForMeta(meta.entries[candidateIndex], codexHome);
        if (isAvailableForSwitch(meta.entries[candidateIndex])) {
          await this.writeMeta(meta);
          await this.activateEntry(meta.entries[candidateIndex].id, codexHome, "auto");
          return;
        }
      }

      meta.lastAutoSwitchAt = nowIso();
      meta.lastAutoSwitchMessage = "账号池没有可用账号，已停止自动切换。";
      await this.writeMeta(meta);
      this.emitLog("warn", meta.lastAutoSwitchMessage);
      void vscode.window.showWarningMessage(meta.lastAutoSwitchMessage);
    } catch (error) {
      this.emitLog("error", `账号池自动切换检测失败: ${(error as Error).message}`);
    } finally {
      this.tickRunning = false;
    }
  }
}

let service: TokenPoolService | undefined;

export function initializeTokenPoolService(context: vscode.ExtensionContext): vscode.Disposable {
  if (!service) {
    service = new TokenPoolService(context);
  }
  return service;
}

export function getTokenPoolService(): TokenPoolService {
  if (!service) {
    throw new Error("TokenPoolService not initialized");
  }
  return service;
}
