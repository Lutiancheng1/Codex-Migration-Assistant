import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import { copyFileIfExists, ensureDir, statSafe } from "./fileTree";
import { runExport } from "./exporter";
import { runImport } from "./importer";
import { CORE_DIRS } from "./constants";
import { detectExternalBusyProcesses, formatBusyProcessSummary } from "./processGuard";
import { fetchProfileUsage, type ProfileUsageSummary } from "./usage";
import { resolveProfileAuthLabel } from "./authLabel";
import { ErrorCode } from "../protocol/errors";
import type { ProfileSwitchMode } from "../protocol/messages";

const MERGE_FILE_NAMES = ["history.jsonl", "session_index.jsonl"] as const;

type StoredProfile = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
};

type ProfilesMetadata = {
  version: 1;
  activeProfileId?: string;
  profiles: StoredProfile[];
};

export type ProfileView = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  exists: boolean;
  hasAuth: boolean;
  hasState: boolean;
  usage?: ProfileUsageSummary;
  usageError?: string;
};

export type ProfilesSnapshot = {
  codexHome: string;
  profilesRoot: string;
  activeProfileId?: string;
  profiles: ProfileView[];
  messages: string[];
};

type Paths = {
  codexHome: string;
  profilesRoot: string;
  metadataPath: string;
};

const METADATA_FILE = "profiles.json";
const PROFILE_VERSION = 1;
type UsageCacheEntry = {
  usage?: ProfileUsageSummary;
  usageError?: string;
};
const usageCache = new Map<string, UsageCacheEntry>();
const GLOBAL_STATE_FILE = ".codex-global-state.json";
const CONFIG_FILE = "config.toml";
export const POOL_RUNNER_PROFILE_ID = "pool-runner";
export const POOL_RUNNER_PROFILE_NAME = "账号池运行槽位";

type TomlSection = {
  header?: string;
  order: string[];
  entries: Map<string, string>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function createTomlSection(header?: string): TomlSection {
  return {
    header,
    order: [],
    entries: new Map<string, string>()
  };
}

function parseTomlSections(content: string): Map<string, TomlSection> {
  const sections = new Map<string, TomlSection>();
  let currentSection = "";
  sections.set(currentSection, createTomlSection());

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!sections.has(currentSection)) {
        sections.set(currentSection, createTomlSection(line));
      }
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
    if (!keyMatch) {
      continue;
    }
    const key = keyMatch[1];
    const section = sections.get(currentSection) ?? createTomlSection(currentSection ? `[${currentSection}]` : undefined);
    if (!sections.has(currentSection)) {
      sections.set(currentSection, section);
    }
    if (!section.entries.has(key)) {
      section.order.push(key);
    }
    section.entries.set(key, rawLine);
  }

  return sections;
}

async function mergeConfigToml(sourceProfilePath: string, targetProfilePath: string, messages: string[]): Promise<void> {
  const sourcePath = path.join(sourceProfilePath, CONFIG_FILE);
  const targetPath = path.join(targetProfilePath, CONFIG_FILE);
  const sourceStat = await statSafe(sourcePath);
  if (!sourceStat?.isFile()) {
    return;
  }

  const targetStat = await statSafe(targetPath);
  if (!targetStat?.isFile()) {
    await fs.copyFile(sourcePath, targetPath);
    messages.push("已补齐目标账号缺失的 config.toml。");
    return;
  }

  const sourceSections = parseTomlSections(await fs.readFile(sourcePath, "utf8"));
  const targetSections = parseTomlSections(await fs.readFile(targetPath, "utf8"));
  let addedCount = 0;
  let replacedCount = 0;

  for (const [sectionName, sourceSection] of sourceSections.entries()) {
    const targetSection = targetSections.get(sectionName) ?? createTomlSection(sourceSection.header);
    if (!targetSections.has(sectionName)) {
      targetSections.set(sectionName, targetSection);
    }
    if (!targetSection.header && sourceSection.header) {
      targetSection.header = sourceSection.header;
    }
    for (const key of sourceSection.order) {
      const rawLine = sourceSection.entries.get(key);
      if (!rawLine) {
        continue;
      }
      if (!targetSection.entries.has(key)) {
        targetSection.order.push(key);
        addedCount += 1;
      } else {
        replacedCount += 1;
      }
      targetSection.entries.set(key, rawLine);
    }
  }

  const outputLines: string[] = [];
  for (const [sectionName, section] of targetSections.entries()) {
    if (sectionName && section.header) {
      if (outputLines.length > 0) {
        outputLines.push("");
      }
      outputLines.push(section.header);
    }
    for (const key of section.order) {
      const rawLine = section.entries.get(key);
      if (rawLine) {
        outputLines.push(rawLine);
      }
    }
  }

  await fs.writeFile(targetPath, `${outputLines.join("\n")}\n`, "utf8");
  messages.push(`已合并 config.toml：新增 ${addedCount} 个配置项，覆盖 ${replacedCount} 个同名配置，未命中的目标配置已保留。`);
}

async function sha256File(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function dedupeBackupArchives(preferredZipPath: string): Promise<{ keptPath: string; removedPaths: string[] }> {
  const preferredStat = await statSafe(preferredZipPath);
  if (!preferredStat?.isFile()) {
    return { keptPath: preferredZipPath, removedPaths: [] };
  }

  const backupDir = path.dirname(preferredZipPath);
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
    .map((entry) => path.join(backupDir, entry.name));

  const preferredHash = await sha256File(preferredZipPath);
  const sameGroup: Array<{ filePath: string; mtimeMs: number }> = [];

  for (const filePath of candidates) {
    const st = await statSafe(filePath);
    if (!st?.isFile() || st.size !== preferredStat.size) {
      continue;
    }
    const hash = await sha256File(filePath);
    if (hash === preferredHash) {
      sameGroup.push({ filePath, mtimeMs: st.mtimeMs });
    }
  }

  if (sameGroup.length <= 1) {
    return { keptPath: preferredZipPath, removedPaths: [] };
  }

  sameGroup.sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));
  const keptPath = sameGroup[0].filePath;
  const removedPaths: string[] = [];
  for (const item of sameGroup.slice(1)) {
    await fs.rm(item.filePath, { force: true });
    removedPaths.push(item.filePath);
  }

  return { keptPath, removedPaths };
}

async function resolvePreferredProfileName(profilePath: string, fallback: string): Promise<string> {
  const label = await resolveProfileAuthLabel(profilePath);
  return label && label.trim().length > 0 ? label.trim() : fallback;
}

function normalizeForCompare(input: string): string {
  const normalized = path.resolve(input);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

function usageCacheKey(input: string): string {
  return normalizeForCompare(input);
}

function getUsageCache(profilePath: string): UsageCacheEntry | undefined {
  return usageCache.get(usageCacheKey(profilePath));
}

function setUsageCache(profilePath: string, entry: UsageCacheEntry): void {
  const key = usageCacheKey(profilePath);
  if (!entry.usage && !entry.usageError) {
    usageCache.delete(key);
    return;
  }
  usageCache.set(key, entry);
}

export function invalidateProfileUsage(profilePath: string): void {
  usageCache.delete(usageCacheKey(profilePath));
}

function derivePaths(codexHomeInput: string): Paths {
  const codexHome = path.resolve(codexHomeInput);
  const base = path.basename(codexHome);
  const profilesRoot = path.join(path.dirname(codexHome), `${base}-profiles`);
  return {
    codexHome,
    profilesRoot,
    metadataPath: path.join(profilesRoot, METADATA_FILE)
  };
}

async function lstatSafe(filePath: string): Promise<import("fs").Stats | undefined> {
  try {
    return await fs.lstat(filePath);
  } catch {
    return undefined;
  }
}

async function readMetadata(paths: Paths): Promise<ProfilesMetadata> {
  const st = await statSafe(paths.metadataPath);
  if (!st?.isFile()) {
    return { version: PROFILE_VERSION, profiles: [] };
  }
  const raw = await fs.readFile(paths.metadataPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<ProfilesMetadata>;
  const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  const cleaned: StoredProfile[] = [];
  const seen = new Set<string>();
  for (const item of profiles) {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.path !== "string") {
      continue;
    }
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    cleaned.push({
      id: item.id,
      name: item.name,
      path: path.resolve(item.path),
      createdAt: typeof item.createdAt === "string" ? item.createdAt : nowIso(),
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : nowIso(),
      lastActivatedAt: typeof item.lastActivatedAt === "string" ? item.lastActivatedAt : undefined
    });
  }
  const activeProfileId = typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : undefined;
  return { version: PROFILE_VERSION, activeProfileId, profiles: cleaned };
}

async function writeMetadata(paths: Paths, metadata: ProfilesMetadata): Promise<void> {
  await ensureDir(paths.profilesRoot);
  const tempPath = `${paths.metadataPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2), "utf8");
  await fs.rename(tempPath, paths.metadataPath);
}

function slugify(input: string): string {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value.length > 0 ? value : "profile";
}

function uniqueProfileId(metadata: ProfilesMetadata, seed: string): string {
  const base = slugify(seed);
  if (!metadata.profiles.some((item) => item.id === base)) {
    return base;
  }
  let idx = 2;
  while (metadata.profiles.some((item) => item.id === `${base}-${idx}`)) {
    idx += 1;
  }
  return `${base}-${idx}`;
}

async function allocateProfileId(metadata: ProfilesMetadata, profilesRoot: string, seed: string): Promise<string> {
  const base = slugify(seed);
  let id = uniqueProfileId(metadata, base);
  let idx = 2;
  while (await statSafe(path.join(profilesRoot, id))) {
    id = `${base}-${idx}`;
    idx += 1;
  }
  return id;
}

async function resolveCodexTargetIfLink(codexHome: string): Promise<string | undefined> {
  const st = await lstatSafe(codexHome);
  if (!st?.isSymbolicLink()) {
    return undefined;
  }
  const target = await fs.realpath(codexHome);
  return path.resolve(target);
}

async function switchCodexLink(codexHome: string, targetProfilePath: string): Promise<void> {
  const st = await lstatSafe(codexHome);
  if (st) {
    if (st.isSymbolicLink()) {
      await fs.unlink(codexHome);
    } else if (st.isDirectory()) {
      throw new Error(`切换失败：${codexHome} 不是链接目录。请先初始化多账号目录。`);
    } else {
      await fs.rm(codexHome, { force: true });
    }
  }

  const linkType = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(targetProfilePath, codexHome, linkType);
}

function isStateFilename(name: string): boolean {
  return /^state_.*\.sqlite(?:-wal|-shm)?$/i.test(name);
}

async function createEmptyProfileSkeleton(profilePath: string): Promise<void> {
  await ensureDir(profilePath);
  await ensureDir(path.join(profilePath, "sessions"));
  await ensureDir(path.join(profilePath, "rules"));
  await ensureDir(path.join(profilePath, "skills"));
  await ensureDir(path.join(profilePath, "archived_sessions"));
  await ensureDir(path.join(profilePath, "shell_snapshots"));
  await ensureDir(path.join(profilePath, "sqlite"));
  await ensureDir(path.join(profilePath, "tmp"));
}

async function summarizeProfile(profile: StoredProfile): Promise<ProfileView> {
  const st = await statSafe(profile.path);
  const exists = !!st?.isDirectory();
  let hasAuth = false;
  let hasState = false;
  const usage = getUsageCache(profile.path);

  if (exists) {
    const authCandidates = [path.join(profile.path, "auth.json"), path.join(profile.path, "cap_sid")];
    for (const candidate of authCandidates) {
      if ((await statSafe(candidate))?.isFile()) {
        hasAuth = true;
        break;
      }
    }

    const entries = await fs.readdir(profile.path, { withFileTypes: true });
    hasState = entries.some((item) => item.isFile() && isStateFilename(item.name));
  }

  return {
    id: profile.id,
    name: profile.name,
    path: profile.path,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastActivatedAt: profile.lastActivatedAt,
    exists,
    hasAuth,
    hasState,
    usage: usage?.usage,
    usageError: usage?.usageError
  };
}

function findProfileById(metadata: ProfilesMetadata, profileId: string): StoredProfile {
  const found = metadata.profiles.find((item) => item.id === profileId);
  if (!found) {
    throw new Error(`未找到账号槽位: ${profileId}`);
  }
  return found;
}

async function ensureBootstrapped(paths: Paths, metadata: ProfilesMetadata): Promise<{ metadata: ProfilesMetadata; messages: string[] }> {
  const messages: string[] = [];
  await ensureDir(paths.profilesRoot);

  const codexLinkStat = await lstatSafe(paths.codexHome);

  if (!codexLinkStat) {
    if (metadata.profiles.length === 0) {
      const createdAt = nowIso();
      const id = await allocateProfileId(metadata, paths.profilesRoot, "primary");
      const profilePath = path.join(paths.profilesRoot, id);
      await createEmptyProfileSkeleton(profilePath);
      metadata.profiles.push({
        id,
        name: "主账号",
        path: profilePath,
        createdAt,
        updatedAt: createdAt,
        lastActivatedAt: createdAt
      });
      metadata.activeProfileId = id;
      await switchCodexLink(paths.codexHome, profilePath);
      messages.push(`已初始化账号目录并创建首个槽位: ${id}`);
    }
    return { metadata, messages };
  }

  if (codexLinkStat.isSymbolicLink()) {
    const linkTarget = await resolveCodexTargetIfLink(paths.codexHome);
    if (!linkTarget) {
      return { metadata, messages };
    }

    let profile = metadata.profiles.find((item) => samePath(item.path, linkTarget));
    if (!profile) {
      const createdAt = nowIso();
      const inferredId = await allocateProfileId(metadata, paths.profilesRoot, path.basename(linkTarget));
      const preferredName = await resolvePreferredProfileName(linkTarget, inferredId === "primary" ? "主账号" : inferredId);
      profile = {
        id: inferredId,
        name: preferredName,
        path: linkTarget,
        createdAt,
        updatedAt: createdAt,
        lastActivatedAt: createdAt
      };
      metadata.profiles.push(profile);
      messages.push(`已纳入现有链接目标为账号槽位: ${profile.id}`);
    }

    metadata.activeProfileId = profile.id;
    if (!profile.lastActivatedAt) {
      profile.lastActivatedAt = nowIso();
    }
    return { metadata, messages };
  }

  if (!codexLinkStat.isDirectory()) {
    throw new Error(`无法初始化账号管理：${paths.codexHome} 不是目录或链接。`);
  }

  const existing = metadata.profiles.find((item) => samePath(item.path, paths.codexHome));
  if (existing) {
    metadata.activeProfileId = existing.id;
    return { metadata, messages };
  }

  const createdAt = nowIso();
  const id = await allocateProfileId(metadata, paths.profilesRoot, "primary");
  const targetPath = path.join(paths.profilesRoot, id);
  const preferredName = await resolvePreferredProfileName(paths.codexHome, "主账号");
  try {
    await fs.rename(paths.codexHome, targetPath);
  } catch (err: any) {
    if (err.code === "EPERM" || err.code === "EBUSY") {
      const busy = await detectExternalBusyProcesses([paths.codexHome]);
      const busyMsg = busy.length > 0 ? `占用进程: ${formatBusyProcessSummary(busy)}` : "未抓取到具体占用进程 PID 的线索。";
      const wrapper = new Error(`首次初始化多账号关联目录失败 (系统锁定无法重命名 .codex)。\n原因：权限不足或文件被活动进程（如原始 Codex 扩充端大文件读写）牢牢锁住。\n请尝试：点击关闭其他应用释放，或者在 VS Code 中暂时禁用 Codex 后重装此环境。\n(${busyMsg})`) as Error & {
        code: ErrorCode;
        details: Record<string, unknown>;
      };
      wrapper.code = ErrorCode.FileLocked;
      wrapper.details = { busy };
      throw wrapper;
    }
    throw err;
  }
  await switchCodexLink(paths.codexHome, targetPath);
  metadata.profiles.push({
    id,
    name: preferredName,
    path: targetPath,
    createdAt,
    updatedAt: createdAt,
    lastActivatedAt: createdAt
  });
  metadata.activeProfileId = id;
  messages.push(`已将当前 .codex 迁移到账号槽位: ${id}`);
  return { metadata, messages };
}

async function toSnapshot(paths: Paths, metadata: ProfilesMetadata, messages: string[]): Promise<ProfilesSnapshot> {
  const profiles: ProfileView[] = [];
  for (const item of metadata.profiles) {
    profiles.push(await summarizeProfile(item));
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return {
    codexHome: paths.codexHome,
    profilesRoot: paths.profilesRoot,
    activeProfileId: metadata.activeProfileId,
    profiles,
    messages
  };
}

async function buildLiveProfile(paths: Paths): Promise<ProfileView | undefined> {
  const codexStat = await statSafe(paths.codexHome);
  if (!codexStat?.isDirectory()) {
    return undefined;
  }
  const now = nowIso();
  const preferredLabel = await resolveProfileAuthLabel(paths.codexHome);
  return summarizeProfile({
    id: "live",
    name: preferredLabel ? `当前账号（${preferredLabel}）` : "当前账号",
    path: paths.codexHome,
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: now
  });
}

async function inferActiveProfileId(paths: Paths, metadata: ProfilesMetadata): Promise<string | undefined> {
  if (metadata.activeProfileId) {
    return metadata.activeProfileId;
  }

  const linkTarget = await resolveCodexTargetIfLink(paths.codexHome);
  if (linkTarget) {
    const matched = metadata.profiles.find((item) => samePath(item.path, linkTarget));
    if (matched) {
      return matched.id;
    }
  }

  const codexStat = await statSafe(paths.codexHome);
  if (codexStat?.isDirectory()) {
    return "live";
  }
  return undefined;
}

async function resolveTemplateSourcePath(paths: Paths, metadata: ProfilesMetadata): Promise<string | undefined> {
  const activeId = await inferActiveProfileId(paths, metadata);
  if (activeId && activeId !== "live") {
    const active = metadata.profiles.find((item) => item.id === activeId);
    if (active && (await statSafe(active.path))?.isDirectory()) {
      return active.path;
    }
  }

  const codexStat = await statSafe(paths.codexHome);
  if (codexStat?.isDirectory()) {
    return paths.codexHome;
  }
  return undefined;
}

async function loadBootstrappedMetadata(codexHome: string): Promise<{ paths: Paths; metadata: ProfilesMetadata; messages: string[] }> {
  const paths = derivePaths(codexHome);
  const metadata = await readMetadata(paths);
  const bootstrapped = await ensureBootstrapped(paths, metadata);
  await writeMetadata(paths, bootstrapped.metadata);
  return { paths, metadata: bootstrapped.metadata, messages: bootstrapped.messages };
}

export async function getProfilesSnapshot(codexHome: string, autoBootstrap = false): Promise<ProfilesSnapshot> {
  if (autoBootstrap) {
    const loaded = await loadBootstrappedMetadata(codexHome);
    return toSnapshot(loaded.paths, loaded.metadata, loaded.messages);
  }

  const paths = derivePaths(codexHome);
  const metadata = await readMetadata(paths);
  if (metadata.profiles.length > 0) {
    const inferredActive = await inferActiveProfileId(paths, metadata);
    if (inferredActive === "live") {
      const liveProfile = await buildLiveProfile(paths);
      const storedProfiles = await Promise.all(metadata.profiles.map((item) => summarizeProfile(item)));
      storedProfiles.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      return {
        codexHome: paths.codexHome,
        profilesRoot: paths.profilesRoot,
        activeProfileId: "live",
        profiles: liveProfile ? [liveProfile, ...storedProfiles] : storedProfiles,
        messages: []
      };
    }
    return toSnapshot(paths, { ...metadata, activeProfileId: inferredActive }, []);
  }

  const liveProfile = await buildLiveProfile(paths);
  if (liveProfile) {
    return {
      codexHome: paths.codexHome,
      profilesRoot: paths.profilesRoot,
      activeProfileId: "live",
      profiles: [liveProfile],
      messages: ["未初始化多账号。首次执行新增或切换时会自动迁移当前 .codex。"]
    };
  }

  return {
    codexHome: paths.codexHome,
    profilesRoot: paths.profilesRoot,
    activeProfileId: undefined,
    profiles: [],
    messages: []
  };
}

export async function createProfile(codexHome: string, profileName: string): Promise<ProfilesSnapshot> {
  const name = profileName.trim();
  if (name.length === 0) {
    throw new Error("账号名称不能为空。");
  }

  const paths = derivePaths(codexHome);
  const metadata = await readMetadata(paths);
  const messages: string[] = [];
  const id = await allocateProfileId(metadata, paths.profilesRoot, name);
  const createdAt = nowIso();
  const profilePath = path.join(paths.profilesRoot, id);

  await ensureDir(paths.profilesRoot);
  await createEmptyProfileSkeleton(profilePath);
  const templateSourcePath = await resolveTemplateSourcePath(paths, metadata);
  if (templateSourcePath) {
    await copyFileIfExists(path.join(templateSourcePath, "config.toml"), path.join(profilePath, "config.toml"));
  }

  metadata.profiles.push({
    id,
    name,
    path: profilePath,
    createdAt,
    updatedAt: createdAt
  });
  await writeMetadata(paths, metadata);
  messages.push(`已创建账号槽位: ${name} (${id})`);
  const snapshot = await getProfilesSnapshot(codexHome);
  snapshot.messages.unshift(...messages);
  return snapshot;
}

async function ensureFixedProfileSlot(
  paths: Paths,
  metadata: ProfilesMetadata,
  profileId: string,
  profileName: string,
  messages: string[]
): Promise<StoredProfile> {
  const existing = metadata.profiles.find((item) => item.id === profileId);
  if (existing) {
    if (!(await statSafe(existing.path))?.isDirectory()) {
      await createEmptyProfileSkeleton(existing.path);
    }
    return existing;
  }

  const createdAt = nowIso();
  const profilePath = path.join(paths.profilesRoot, profileId);
  await ensureDir(paths.profilesRoot);
  if (!(await statSafe(profilePath))?.isDirectory()) {
    await createEmptyProfileSkeleton(profilePath);
  }
  const templateSourcePath = await resolveTemplateSourcePath(paths, metadata);
  if (templateSourcePath) {
    await copyFileIfExists(path.join(templateSourcePath, CONFIG_FILE), path.join(profilePath, CONFIG_FILE));
  }

  const created: StoredProfile = {
    id: profileId,
    name: profileName,
    path: profilePath,
    createdAt,
    updatedAt: createdAt
  };
  metadata.profiles.push(created);
  messages.push(`已创建专用账号槽位: ${profileName} (${profileId})`);
  return created;
}

export async function ensureProfileSlot(codexHome: string, profileId: string, profileName: string): Promise<ProfilesSnapshot> {
  const loaded = await loadBootstrappedMetadata(codexHome);
  const { paths, metadata, messages } = loaded;
  await ensureFixedProfileSlot(paths, metadata, profileId, profileName, messages);
  await writeMetadata(paths, metadata);
  return toSnapshot(paths, metadata, messages);
}

export async function syncCurrentCoreToProfile(
  codexHome: string,
  targetProfileId: string,
  targetProfileName: string
): Promise<ProfilesSnapshot> {
  const loaded = await loadBootstrappedMetadata(codexHome);
  const { paths, metadata, messages } = loaded;
  const target = await ensureFixedProfileSlot(paths, metadata, targetProfileId, targetProfileName, messages);
  const activeProfileId = metadata.activeProfileId ?? (await inferActiveProfileId(paths, metadata));

  let sourcePath = paths.codexHome;
  let sourceName = "当前账号";
  if (activeProfileId && activeProfileId !== "live") {
    const active = findProfileById(metadata, activeProfileId);
    sourcePath = active.path;
    sourceName = active.name;
  }

  if (activeProfileId === targetProfileId || samePath(sourcePath, target.path)) {
    messages.push(`当前已在 ${target.name}，无需同步记录。`);
    await writeMetadata(paths, metadata);
    return toSnapshot(paths, metadata, messages);
  }

  await overwriteCurrentIntoTargetProfile(sourcePath, target.path, messages);
  target.updatedAt = nowIso();
  await writeMetadata(paths, metadata);
  messages.push(`已将 ${sourceName} 的当前记录同步到 ${target.name}。`);
  invalidateProfileUsage(target.path);
  return toSnapshot(paths, metadata, messages);
}

export async function refreshProfilesUsage(codexHome: string, profileId?: string): Promise<ProfilesSnapshot> {
  const snapshot = await getProfilesSnapshot(codexHome);
  snapshot.messages = snapshot.messages.filter((message) => !message.includes("未初始化多账号"));
  const targets = profileId ? snapshot.profiles.filter((item) => item.id === profileId) : snapshot.profiles;

  if (profileId && targets.length === 0) {
    throw new Error(`未找到账号槽位: ${profileId}`);
  }
  if (targets.length === 0) {
    snapshot.messages.push("当前没有可查询用量的账号槽位。");
    return snapshot;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;
  for (const profile of targets) {
    if (!profile.exists) {
      setUsageCache(profile.path, { usageError: "账号槽位目录不存在" });
      failed += 1;
      continue;
    }
    if (!profile.hasAuth) {
      setUsageCache(profile.path, { usageError: "未检测到 auth.json，无法查询用量" });
      skipped += 1;
      continue;
    }
    try {
      const usage = await fetchProfileUsage(profile.path);
      setUsageCache(profile.path, { usage, usageError: undefined });
      success += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setUsageCache(profile.path, { usage: undefined, usageError: reason });
      failed += 1;
    }
  }

  const refreshed = await getProfilesSnapshot(codexHome);
  refreshed.messages = refreshed.messages.filter((message) => !message.includes("未初始化多账号"));
  const targetLabel = profileId ? "指定账号" : "全部账号";
  const parts = [`成功 ${success}`];
  if (skipped > 0) {
    parts.push(`跳过 ${skipped}`);
  }
  if (failed > 0) {
    parts.push(`失败 ${failed}`);
  }
  refreshed.messages.push(`用量刷新完成（${targetLabel}）：${parts.join("，")}。`);
  return refreshed;
}

async function mergeCoreIntoTargetProfile(sourceProfilePath: string, targetProfilePath: string, messages: string[]): Promise<void> {
  const tempOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-profile-merge-"));
  const snapshotRoot = path.join(tempOutputRoot, "target-core-before");

  function asRecord(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {};
    }
    return input as Record<string, unknown>;
  }

  function mergeUniqueStringArray(source: unknown, target: unknown): string[] {
    const sourceItems = Array.isArray(source) ? source.filter((item): item is string => typeof item === "string") : [];
    const targetItems = Array.isArray(target) ? target.filter((item): item is string => typeof item === "string") : [];
    return Array.from(new Set([...sourceItems, ...targetItems]));
  }

  function mergeThreadTitles(source: unknown, target: unknown): Record<string, unknown> {
    const src = asRecord(source);
    const dst = asRecord(target);
    const srcTitles = asRecord(src.titles);
    const dstTitles = asRecord(dst.titles);
    const order = mergeUniqueStringArray(src.order, dst.order);
    return {
      ...dst,
      ...src,
      titles: { ...dstTitles, ...srcTitles },
      order
    };
  }

  async function mergeGlobalState(sourceProfilePathInput: string, targetProfilePathInput: string): Promise<void> {
    const sourcePath = path.join(sourceProfilePathInput, GLOBAL_STATE_FILE);
    const targetPath = path.join(targetProfilePathInput, GLOBAL_STATE_FILE);
    const sourceStat = await statSafe(sourcePath);
    if (!sourceStat?.isFile()) {
      return;
    }
    const targetStat = await statSafe(targetPath);
    if (!targetStat?.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
      messages.push("目标账号缺少全局状态文件，已同步 .codex-global-state.json。");
      return;
    }

    try {
      const sourceRaw = await fs.readFile(sourcePath, "utf8");
      const targetRaw = await fs.readFile(targetPath, "utf8");
      const sourceJson = asRecord(JSON.parse(sourceRaw));
      const targetJson = asRecord(JSON.parse(targetRaw));

      const sourceAtom = asRecord(sourceJson["electron-persisted-atom-state"]);
      const targetAtom = asRecord(targetJson["electron-persisted-atom-state"]);
      const mergedAtom: Record<string, unknown> = { ...targetAtom, ...sourceAtom };
      mergedAtom["prompt-history"] = mergeUniqueStringArray(sourceAtom["prompt-history"], targetAtom["prompt-history"]);
      mergedAtom["thread-titles"] = mergeThreadTitles(sourceAtom["thread-titles"], targetAtom["thread-titles"]);

      const mergedRoot: Record<string, unknown> = {
        ...targetJson,
        ...sourceJson,
        "electron-persisted-atom-state": mergedAtom,
        "electron-saved-workspace-roots": mergeUniqueStringArray(
          sourceJson["electron-saved-workspace-roots"],
          targetJson["electron-saved-workspace-roots"]
        ),
        "active-workspace-roots": mergeUniqueStringArray(sourceJson["active-workspace-roots"], targetJson["active-workspace-roots"])
      };

      await fs.writeFile(targetPath, JSON.stringify(mergedRoot), "utf8");
      messages.push("已合并 .codex-global-state.json（含线程标题与历史索引）。");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      messages.push(`全局状态合并失败，已跳过 .codex-global-state.json。原因: ${reason}`);
    }
  }

  async function collapseImportedSessionConflicts(targetProfilePathInput: string): Promise<void> {
    const sessionsRoot = path.join(targetProfilePathInput, "sessions");
    const sessionStat = await statSafe(sessionsRoot);
    if (!sessionStat?.isDirectory()) {
      return;
    }

    function asEventRecord(input: unknown): Record<string, unknown> | undefined {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return undefined;
      }
      return input as Record<string, unknown>;
    }

    function pickSemanticEventKey(line: string): string | undefined {
      try {
        const parsed = JSON.parse(line) as unknown;
        const root = asEventRecord(parsed);
        if (!root) {
          return undefined;
        }
        const payload = asEventRecord(root.payload);
        const payloadMessage = payload ? asEventRecord(payload.message) : undefined;
        const payloadItem = payload ? asEventRecord(payload.item) : undefined;

        const type = typeof root.type === "string" ? root.type : "";
        const timestamp = typeof root.timestamp === "string" ? root.timestamp : "";
        const idCandidates = [
          root.id,
          payload?.id,
          payload?.message_id,
          payload?.response_id,
          payload?.turn_id,
          payload?.session_id,
          payloadMessage?.id,
          payloadItem?.id
        ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
        const id = idCandidates[0] ?? "";

        if (type && timestamp && id) {
          return `${type}|${timestamp}|${id}`;
        }
        if (type && id) {
          return `${type}|${id}`;
        }
        if (type && timestamp) {
          return `${type}|${timestamp}`;
        }
        return undefined;
      } catch {
        return undefined;
      }
    }

    function dedupeSessionLines(lines: string[]): { lines: string[]; removed: number } {
      const deduped: string[] = [];
      const seenRaw = new Set<string>();
      const semanticIndex = new Map<string, number>();
      let removed = 0;

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (line.length === 0) {
          continue;
        }
        if (seenRaw.has(line)) {
          removed += 1;
          continue;
        }

        const semanticKey = pickSemanticEventKey(line);
        if (semanticKey && semanticIndex.has(semanticKey)) {
          const existingIndex = semanticIndex.get(semanticKey) as number;
          const existingLine = deduped[existingIndex];
          // 保留信息更完整的一行，避免语义同条但字段稍有差异时保留旧版本。
          if (line.length > existingLine.length) {
            deduped[existingIndex] = line;
            seenRaw.add(line);
          }
          removed += 1;
          continue;
        }

        deduped.push(line);
        seenRaw.add(line);
        if (semanticKey) {
          semanticIndex.set(semanticKey, deduped.length - 1);
        }
      }

      return { lines: deduped, removed };
    }

    const importedFiles: string[] = [];
    async function walk(dirPath: string): Promise<void> {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (entry.isFile() && /-imported-\d{8}-\d{6}\.jsonl$/i.test(entry.name)) {
          importedFiles.push(full);
        }
      }
    }

    await walk(sessionsRoot);
    if (importedFiles.length === 0) {
      return;
    }

    let mergedFiles = 0;
    let appendedLines = 0;
    let removedDuplicates = 0;
    for (const importedPath of importedFiles) {
      const canonicalPath = importedPath.replace(/-imported-\d{8}-\d{6}\.jsonl$/i, ".jsonl");
      const canonicalStat = await statSafe(canonicalPath);
      if (!canonicalStat?.isFile()) {
        const importedRaw = await fs.readFile(importedPath, "utf8");
        const importedLines = importedRaw.split("\n").filter((line) => line.length > 0);
        const dedupedImported = dedupeSessionLines(importedLines);
        const content = dedupedImported.lines.length > 0 ? `${dedupedImported.lines.join("\n")}\n` : "";
        const tempPath = `${canonicalPath}.tmp`;
        await fs.writeFile(tempPath, content, "utf8");
        await fs.rename(tempPath, canonicalPath);
        await fs.rm(importedPath, { force: true });
        removedDuplicates += dedupedImported.removed;
        mergedFiles += 1;
        continue;
      }

      const canonicalRaw = await fs.readFile(canonicalPath, "utf8");
      const importedRaw = await fs.readFile(importedPath, "utf8");
      const canonicalLines = canonicalRaw.split("\n").filter((line) => line.length > 0);
      const importedLines = importedRaw.split("\n").filter((line) => line.length > 0);
      const beforeCount = canonicalLines.length;
      const merged = dedupeSessionLines([...canonicalLines, ...importedLines]);
      const mergedLines = merged.lines;
      appendedLines += Math.max(0, mergedLines.length - beforeCount);
      removedDuplicates += merged.removed;

      const mergedContent = mergedLines.length > 0 ? `${mergedLines.join("\n")}\n` : "";
      const tempPath = `${canonicalPath}.tmp`;
      await fs.writeFile(tempPath, mergedContent, "utf8");
      await fs.rename(tempPath, canonicalPath);
      await fs.rm(importedPath, { force: true });
      mergedFiles += 1;
    }

    messages.push(
      `会话冲突收敛完成：处理 ${mergedFiles} 个 imported 会话文件，追加 ${appendedLines} 行新事件，去重 ${removedDuplicates} 行。`
    );
  }

  async function listStateFiles(profilePath: string): Promise<string[]> {
    const entries = await fs.readdir(profilePath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isStateFilename(entry.name))
      .map((entry) => path.join(profilePath, entry.name));
  }

  async function snapshotCoreState(profilePath: string, outPath: string): Promise<void> {
    await ensureDir(outPath);
    for (const dirName of CORE_DIRS) {
      const sourceDir = path.join(profilePath, dirName);
      const st = await statSafe(sourceDir);
      if (!st?.isDirectory()) {
        continue;
      }
      await fs.cp(sourceDir, path.join(outPath, dirName), { recursive: true });
    }
    for (const fileName of MERGE_FILE_NAMES) {
      await copyFileIfExists(path.join(profilePath, fileName), path.join(outPath, fileName));
    }
  }

  async function restoreCoreState(profilePath: string, snapshotPath: string): Promise<void> {
    for (const dirName of CORE_DIRS) {
      await fs.rm(path.join(profilePath, dirName), { recursive: true, force: true });
      const backupDir = path.join(snapshotPath, dirName);
      const st = await statSafe(backupDir);
      if (st?.isDirectory()) {
        await fs.cp(backupDir, path.join(profilePath, dirName), { recursive: true });
      }
    }
    for (const fileName of MERGE_FILE_NAMES) {
      await fs.rm(path.join(profilePath, fileName), { force: true });
      await copyFileIfExists(path.join(snapshotPath, fileName), path.join(profilePath, fileName));
    }
  }

  try {
    await snapshotCoreState(targetProfilePath, snapshotRoot);
    const exportResult = await runExport({
      codexHome: sourceProfilePath,
      outputDir: tempOutputRoot,
      includeState: false,
      includeAuth: false,
      mode: "core"
    });

    const importResult = await runImport({
      codexHome: targetProfilePath,
      backupZip: exportResult.zipPath,
      replaceState: false,
      importAuth: false,
      mode: "core"
    });

    messages.push(
      `已合并当前账号数据到目标账号：sessions 新增 ${importResult.sessions.newCount}，冲突 ${importResult.sessions.conflictCount}。`
    );
    messages.push(
      `合并统计：rules 新增 ${importResult.rules.newCount}，skills 新增 ${importResult.skills.newCount}，history 追加 ${importResult.history.appended}。`
    );
    for (const warning of importResult.warnings) {
      messages.push(`合并警告: ${warning}`);
    }

    await mergeConfigToml(sourceProfilePath, targetProfilePath, messages);

    const sourceStateFiles = await listStateFiles(sourceProfilePath);
    const targetStateFiles = await listStateFiles(targetProfilePath);
    if (sourceStateFiles.length > 0 && targetStateFiles.length === 0) {
      for (const sourceFile of sourceStateFiles) {
        await fs.copyFile(sourceFile, path.join(targetProfilePath, path.basename(sourceFile)));
      }
      messages.push(`目标账号未检测到 state 文件，已同步 ${sourceStateFiles.length} 个 state_*.sqlite*。`);
    }

    await collapseImportedSessionConflicts(targetProfilePath);
    await mergeGlobalState(sourceProfilePath, targetProfilePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await restoreCoreState(targetProfilePath, snapshotRoot);
    } catch (rollbackError) {
      const rollbackReason = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`切换并合并失败，且回滚失败。原因: ${reason}; 回滚错误: ${rollbackReason}`);
    }
    throw new Error(`切换并合并失败，已回滚目标账号数据。原因: ${reason}`);
  } finally {
    await fs.rm(tempOutputRoot, { recursive: true, force: true });
  }
}

async function overwriteCurrentIntoTargetProfile(sourceProfilePath: string, targetProfilePath: string, messages: string[]): Promise<void> {
  const tempOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-profile-overwrite-"));
  const snapshotRoot = path.join(tempOutputRoot, "target-before");

  async function listStateFiles(profilePath: string): Promise<string[]> {
    const entries = await fs.readdir(profilePath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isStateFilename(entry.name))
      .map((entry) => path.join(profilePath, entry.name));
  }

  async function snapshotTarget(profilePath: string, outPath: string): Promise<void> {
    await ensureDir(outPath);
    for (const dirName of CORE_DIRS) {
      const sourceDir = path.join(profilePath, dirName);
      if ((await statSafe(sourceDir))?.isDirectory()) {
        await fs.cp(sourceDir, path.join(outPath, dirName), { recursive: true });
      }
    }
    for (const fileName of [...MERGE_FILE_NAMES, GLOBAL_STATE_FILE, CONFIG_FILE]) {
      await copyFileIfExists(path.join(profilePath, fileName), path.join(outPath, fileName));
    }
    for (const stateFile of await listStateFiles(profilePath)) {
      await fs.copyFile(stateFile, path.join(outPath, path.basename(stateFile)));
    }
  }

  async function restoreTarget(profilePath: string, outPath: string): Promise<void> {
    for (const dirName of CORE_DIRS) {
      await fs.rm(path.join(profilePath, dirName), { recursive: true, force: true });
      const backupDir = path.join(outPath, dirName);
      if ((await statSafe(backupDir))?.isDirectory()) {
        await fs.cp(backupDir, path.join(profilePath, dirName), { recursive: true });
      }
    }
    for (const fileName of [...MERGE_FILE_NAMES, GLOBAL_STATE_FILE, CONFIG_FILE]) {
      await fs.rm(path.join(profilePath, fileName), { force: true });
      await copyFileIfExists(path.join(outPath, fileName), path.join(profilePath, fileName));
    }
    for (const stateFile of await listStateFiles(profilePath)) {
      await fs.rm(stateFile, { force: true });
    }
    for (const backupState of await listStateFiles(outPath)) {
      await fs.copyFile(backupState, path.join(profilePath, path.basename(backupState)));
    }
  }

  async function clearTargetCore(profilePath: string): Promise<void> {
    for (const dirName of CORE_DIRS) {
      await fs.rm(path.join(profilePath, dirName), { recursive: true, force: true });
    }
    for (const fileName of [...MERGE_FILE_NAMES, GLOBAL_STATE_FILE, CONFIG_FILE]) {
      await fs.rm(path.join(profilePath, fileName), { force: true });
    }
    for (const stateFile of await listStateFiles(profilePath)) {
      await fs.rm(stateFile, { force: true });
    }
  }

  async function copySourceCore(sourcePath: string, targetPath: string): Promise<void> {
    await ensureDir(targetPath);
    for (const dirName of CORE_DIRS) {
      const sourceDir = path.join(sourcePath, dirName);
      if ((await statSafe(sourceDir))?.isDirectory()) {
        await fs.cp(sourceDir, path.join(targetPath, dirName), { recursive: true });
      }
    }
    for (const fileName of [...MERGE_FILE_NAMES, GLOBAL_STATE_FILE, CONFIG_FILE]) {
      await copyFileIfExists(path.join(sourcePath, fileName), path.join(targetPath, fileName));
    }
    for (const stateFile of await listStateFiles(sourcePath)) {
      await fs.copyFile(stateFile, path.join(targetPath, path.basename(stateFile)));
    }
  }

  try {
    await snapshotTarget(targetProfilePath, snapshotRoot);
    await clearTargetCore(targetProfilePath);
    await copySourceCore(sourceProfilePath, targetProfilePath);
    messages.push("已使用当前账号的记录覆盖目标账号（保留目标账号登录态）。");
    messages.push("已使用当前账号的 config.toml 覆盖目标账号配置。");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await restoreTarget(targetProfilePath, snapshotRoot);
    } catch (rollbackError) {
      const rollbackReason = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`切换并覆盖失败，且回滚失败。原因: ${reason}; 回滚错误: ${rollbackReason}`);
    }
    throw new Error(`切换并覆盖失败，已回滚目标账号数据。原因: ${reason}`);
  } finally {
    await fs.rm(tempOutputRoot, { recursive: true, force: true });
  }
}

export async function activateProfile(
  codexHome: string,
  profileId: string,
  backupCurrent: boolean,
  switchMode: ProfileSwitchMode = "plain"
): Promise<ProfilesSnapshot> {
  const loaded = await loadBootstrappedMetadata(codexHome);
  const { paths, metadata, messages } = loaded;
  const target = findProfileById(metadata, profileId);
  const targetStat = await statSafe(target.path);
  if (!targetStat?.isDirectory()) {
    throw new Error(`目标账号槽位目录不存在: ${target.path}`);
  }

  const active = metadata.activeProfileId ? metadata.profiles.find((item) => item.id === metadata.activeProfileId) : undefined;
  if (active && active.id === target.id) {
    messages.push(`当前已是账号槽位: ${target.name}`);
    return toSnapshot(paths, metadata, messages);
  }

  const lockCheckPaths = [target.path];
  if (active) {
    lockCheckPaths.push(active.path);
  }
  const busy = await detectExternalBusyProcesses(lockCheckPaths);
  if (busy.length > 0) {
    const err = new Error(`检测到目录被其他进程占用，请先关闭相关客户端再切换。占用进程: ${formatBusyProcessSummary(busy)}`) as Error & {
      code: ErrorCode;
      details: Record<string, unknown>;
    };
    err.code = ErrorCode.FileLocked;
    err.details = { busy };
    throw err;
  }

  if (backupCurrent && active) {
    const result = await runExport({
      codexHome: active.path,
      outputDir: path.resolve(os.homedir(), "codex-backup"),
      includeState: true,
      includeAuth: false,
      mode: "core"
    });
    const deduped = await dedupeBackupArchives(result.zipPath);
    messages.push(`切换前已备份当前账号: ${deduped.keptPath}`);
    if (deduped.removedPaths.length > 0) {
      messages.push(`已自动清理 ${deduped.removedPaths.length} 个重复备份 ZIP。`);
    }
  }

  if (switchMode === "merge" && active) {
    await mergeCoreIntoTargetProfile(active.path, target.path, messages);
  }
  if (switchMode === "overwrite" && active) {
    await overwriteCurrentIntoTargetProfile(active.path, target.path, messages);
  }

  const previousActiveId = metadata.activeProfileId;
  const previousActivePath = active?.path;
  let switched = false;
  try {
    await switchCodexLink(paths.codexHome, target.path);
    switched = true;
    metadata.activeProfileId = target.id;
    target.lastActivatedAt = nowIso();
    target.updatedAt = nowIso();
    await writeMetadata(paths, metadata);
    messages.push(`已切换到账号槽位: ${target.name}`);
    return toSnapshot(paths, metadata, messages);
  } catch (error) {
    if (switched && previousActivePath) {
      try {
        await switchCodexLink(paths.codexHome, previousActivePath);
        metadata.activeProfileId = previousActiveId;
        await writeMetadata(paths, metadata);
      } catch (rollbackError) {
        throw new Error(`账号切换失败且回滚失败: ${(rollbackError as Error).message}`);
      }
    }
    throw error;
  }
}

export async function deleteProfile(codexHome: string, profileId: string): Promise<ProfilesSnapshot> {
  const paths = derivePaths(codexHome);
  const metadata = await readMetadata(paths);
  const messages: string[] = [];
  const activeId = await inferActiveProfileId(paths, metadata);
  if (activeId === profileId) {
    throw new Error("不能删除当前激活账号。请先切换到其他账号。");
  }

  const target = findProfileById(metadata, profileId);
  const busy = await detectExternalBusyProcesses([target.path]);
  if (busy.length > 0) {
    const err = new Error(`检测到目录被其他进程占用，请先关闭相关客户端再删除。占用进程: ${formatBusyProcessSummary(busy)}`) as Error & {
      code: ErrorCode;
      details: Record<string, unknown>;
    };
    err.code = ErrorCode.FileLocked;
    err.details = { busy };
    throw err;
  }

  invalidateProfileUsage(target.path);
  await fs.rm(target.path, { recursive: true, force: true });
  metadata.profiles = metadata.profiles.filter((item) => item.id !== profileId);
  await writeMetadata(paths, metadata);
  messages.push(`已删除账号槽位: ${target.name}`);
  return toSnapshot(paths, metadata, messages);
}
