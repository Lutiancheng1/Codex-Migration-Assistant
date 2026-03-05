import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runExport } from "./exporter";
import { detectExternalBusyProcesses, formatBusyProcessSummary } from "./processGuard";
import { ensureDir, statSafe } from "./fileTree";
import { ErrorCode } from "../protocol/errors";

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

export type AntigravityProfileSummary = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  exists: boolean;
  hasHome: boolean;
  hasUser: boolean;
};

export type AntigravityProfilesSnapshot = {
  profilesRoot: string;
  activeProfileId?: string;
  profiles: AntigravityProfileSummary[];
  messages: string[];
};

const METADATA_FILE = "profiles.json";
const PROFILE_VERSION = 1;

function nowIso(): string {
  return new Date().toISOString();
}

function antigravityHomePath(): string {
  return path.join(os.homedir(), ".antigravity");
}

function antigravityUserPath(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Antigravity", "User");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Antigravity", "User");
  }
  return path.join(home, ".config", "Antigravity", "User");
}

function profilesRootPath(): string {
  return path.join(os.homedir(), ".antigravity-profiles");
}

function profileHomeDir(profileRoot: string): string {
  return path.join(profileRoot, "home");
}

function profileUserDir(profileRoot: string): string {
  return path.join(profileRoot, "user");
}

async function lstatSafe(filePath: string): Promise<import("fs").Stats | undefined> {
  try {
    return await fs.lstat(filePath);
  } catch {
    return undefined;
  }
}

async function resolveIfSymlink(filePath: string): Promise<string | undefined> {
  const st = await lstatSafe(filePath);
  if (!st?.isSymbolicLink()) {
    return undefined;
  }
  return path.resolve(await fs.realpath(filePath));
}

async function ensureParent(filePath: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
}

async function switchLink(linkPath: string, targetPath: string): Promise<void> {
  await ensureParent(linkPath);
  const st = await lstatSafe(linkPath);
  if (st?.isSymbolicLink()) {
    await fs.unlink(linkPath);
  } else if (st?.isDirectory()) {
    throw new Error(`切换失败：${linkPath} 不是链接目录。请先初始化 Antigravity 多账号目录。`);
  } else if (st) {
    await fs.rm(linkPath, { force: true });
  }
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(targetPath, linkPath, linkType);
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

async function allocateProfileId(metadata: ProfilesMetadata, root: string, seed: string): Promise<string> {
  const base = slugify(seed);
  let id = uniqueProfileId(metadata, base);
  let idx = 2;
  while (await statSafe(path.join(root, id))) {
    id = `${base}-${idx}`;
    idx += 1;
  }
  return id;
}

async function readMetadata(): Promise<ProfilesMetadata> {
  const metadataPath = path.join(profilesRootPath(), METADATA_FILE);
  const st = await statSafe(metadataPath);
  if (!st?.isFile()) {
    return { version: PROFILE_VERSION, profiles: [] };
  }
  const raw = await fs.readFile(metadataPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<ProfilesMetadata>;
  const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  return {
    version: PROFILE_VERSION,
    activeProfileId: typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : undefined,
    profiles: profiles
      .filter((item): item is StoredProfile => !!item && typeof item.id === "string" && typeof item.name === "string" && typeof item.path === "string")
      .map((item) => ({
        ...item,
        path: path.resolve(item.path),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : nowIso(),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : nowIso()
      }))
  };
}

async function writeMetadata(metadata: ProfilesMetadata): Promise<void> {
  const root = profilesRootPath();
  const metadataPath = path.join(root, METADATA_FILE);
  await ensureDir(root);
  const tempPath = `${metadataPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2), "utf8");
  await fs.rename(tempPath, metadataPath);
}

async function createProfileSkeleton(profilePath: string): Promise<void> {
  await ensureDir(profileHomeDir(profilePath));
  await ensureDir(profileUserDir(profilePath));
}

async function migrateOrCloneLiveDir(livePath: string, targetPath: string): Promise<void> {
  const st = await lstatSafe(livePath);
  if (!st) {
    await ensureDir(targetPath);
    return;
  }
  if (st.isSymbolicLink()) {
    const resolved = await fs.realpath(livePath);
    await fs.cp(resolved, targetPath, { recursive: true });
    return;
  }
  if (st.isDirectory()) {
    await fs.rename(livePath, targetPath);
    return;
  }
  await ensureDir(targetPath);
}

async function ensureBootstrapped(metadata: ProfilesMetadata): Promise<{ metadata: ProfilesMetadata; messages: string[] }> {
  const messages: string[] = [];
  const root = profilesRootPath();
  await ensureDir(root);
  if (metadata.profiles.length > 0) {
    if (!metadata.activeProfileId) {
      const homeTarget = await resolveIfSymlink(antigravityHomePath());
      const userTarget = await resolveIfSymlink(antigravityUserPath());
      const found = metadata.profiles.find((item) => {
        return (
          homeTarget === path.resolve(profileHomeDir(item.path)) &&
          userTarget === path.resolve(profileUserDir(item.path))
        );
      });
      if (found) {
        metadata.activeProfileId = found.id;
      }
    }
    return { metadata, messages };
  }

  const id = await allocateProfileId(metadata, root, "primary");
  const createdAt = nowIso();
  const profilePath = path.join(root, id);
  await createProfileSkeleton(profilePath);
  await migrateOrCloneLiveDir(antigravityHomePath(), profileHomeDir(profilePath));
  await migrateOrCloneLiveDir(antigravityUserPath(), profileUserDir(profilePath));
  await switchLink(antigravityHomePath(), profileHomeDir(profilePath));
  await switchLink(antigravityUserPath(), profileUserDir(profilePath));

  metadata.profiles.push({
    id,
    name: "主账号",
    path: profilePath,
    createdAt,
    updatedAt: createdAt,
    lastActivatedAt: createdAt
  });
  metadata.activeProfileId = id;
  messages.push(`已初始化 Antigravity 多账号目录并迁移当前账号: ${id}`);
  return { metadata, messages };
}

async function toSummary(profile: StoredProfile): Promise<AntigravityProfileSummary> {
  const st = await statSafe(profile.path);
  const hasHome = !!(await statSafe(profileHomeDir(profile.path)))?.isDirectory();
  const hasUser = !!(await statSafe(profileUserDir(profile.path)))?.isDirectory();
  return {
    id: profile.id,
    name: profile.name,
    path: profile.path,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastActivatedAt: profile.lastActivatedAt,
    exists: !!st?.isDirectory(),
    hasHome,
    hasUser
  };
}

async function toSnapshot(metadata: ProfilesMetadata, messages: string[]): Promise<AntigravityProfilesSnapshot> {
  const profiles = await Promise.all(metadata.profiles.map((item) => toSummary(item)));
  profiles.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return {
    profilesRoot: profilesRootPath(),
    activeProfileId: metadata.activeProfileId,
    profiles,
    messages
  };
}

function findProfile(metadata: ProfilesMetadata, profileId: string): StoredProfile {
  const found = metadata.profiles.find((item) => item.id === profileId);
  if (!found) {
    throw new Error(`未找到 Antigravity 账号槽位: ${profileId}`);
  }
  return found;
}

export async function getAntigravityProfilesSnapshot(autoBootstrap = false): Promise<AntigravityProfilesSnapshot> {
  const metadata = await readMetadata();
  if (autoBootstrap) {
    const bootstrapped = await ensureBootstrapped(metadata);
    await writeMetadata(bootstrapped.metadata);
    return toSnapshot(bootstrapped.metadata, bootstrapped.messages);
  }
  if (metadata.profiles.length === 0) {
    return {
      profilesRoot: profilesRootPath(),
      activeProfileId: undefined,
      profiles: [],
      messages: ["未初始化 Antigravity 多账号。首次执行新增或切换时会自动迁移当前目录。"]
    };
  }
  return toSnapshot(metadata, []);
}

export async function createAntigravityProfile(profileName: string): Promise<AntigravityProfilesSnapshot> {
  const name = profileName.trim();
  if (!name) {
    throw new Error("账号名称不能为空。");
  }
  const metadata = await readMetadata();
  const bootstrapped = await ensureBootstrapped(metadata);
  const root = profilesRootPath();
  const id = await allocateProfileId(bootstrapped.metadata, root, name);
  const createdAt = nowIso();
  const profilePath = path.join(root, id);
  await createProfileSkeleton(profilePath);
  bootstrapped.metadata.profiles.push({
    id,
    name,
    path: profilePath,
    createdAt,
    updatedAt: createdAt
  });
  await writeMetadata(bootstrapped.metadata);
  const snapshot = await toSnapshot(bootstrapped.metadata, bootstrapped.messages);
  snapshot.messages.push(`已创建 Antigravity 账号槽位: ${name} (${id})`);
  return snapshot;
}

export async function activateAntigravityProfile(profileId: string, backupCurrent: boolean): Promise<AntigravityProfilesSnapshot> {
  const metadata = await readMetadata();
  const bootstrapped = await ensureBootstrapped(metadata);
  const messages = [...bootstrapped.messages];
  const target = findProfile(bootstrapped.metadata, profileId);
  if (bootstrapped.metadata.activeProfileId === profileId) {
    messages.push(`当前已是 Antigravity 账号槽位: ${target.name}`);
    return toSnapshot(bootstrapped.metadata, messages);
  }

  const active = bootstrapped.metadata.activeProfileId
    ? bootstrapped.metadata.profiles.find((item) => item.id === bootstrapped.metadata.activeProfileId)
    : undefined;

  const busy = await detectExternalBusyProcesses([
    antigravityHomePath(),
    antigravityUserPath(),
    profileHomeDir(target.path),
    profileUserDir(target.path),
    ...(active ? [profileHomeDir(active.path), profileUserDir(active.path)] : [])
  ]);
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
      codexHome: path.join(os.homedir(), ".codex"),
      outputDir: path.resolve(os.homedir(), "codex-backup"),
      selectedProviders: ["antigravity"],
      includeState: true,
      includeAuth: false,
      mode: "core"
    });
    messages.push(`切换前已备份当前 Antigravity 账号: ${result.zipPath}`);
  }

  await switchLink(antigravityHomePath(), profileHomeDir(target.path));
  await switchLink(antigravityUserPath(), profileUserDir(target.path));
  bootstrapped.metadata.activeProfileId = target.id;
  target.lastActivatedAt = nowIso();
  target.updatedAt = nowIso();
  await writeMetadata(bootstrapped.metadata);
  messages.push(`已切换到 Antigravity 账号槽位: ${target.name}`);
  return toSnapshot(bootstrapped.metadata, messages);
}

export async function deleteAntigravityProfile(profileId: string): Promise<AntigravityProfilesSnapshot> {
  const metadata = await readMetadata();
  const bootstrapped = await ensureBootstrapped(metadata);
  if (bootstrapped.metadata.activeProfileId === profileId) {
    throw new Error("不能删除当前激活的 Antigravity 账号。请先切换到其他账号。");
  }
  const target = findProfile(bootstrapped.metadata, profileId);
  const busy = await detectExternalBusyProcesses([profileHomeDir(target.path), profileUserDir(target.path)]);
  if (busy.length > 0) {
    const err = new Error(`检测到目录被其他进程占用，请先关闭相关客户端再删除。占用进程: ${formatBusyProcessSummary(busy)}`) as Error & {
      code: ErrorCode;
      details: Record<string, unknown>;
    };
    err.code = ErrorCode.FileLocked;
    err.details = { busy };
    throw err;
  }

  await fs.rm(target.path, { recursive: true, force: true });
  bootstrapped.metadata.profiles = bootstrapped.metadata.profiles.filter((item) => item.id !== profileId);
  await writeMetadata(bootstrapped.metadata);
  const snapshot = await toSnapshot(bootstrapped.metadata, bootstrapped.messages);
  snapshot.messages.push(`已删除 Antigravity 账号槽位: ${target.name}`);
  return snapshot;
}
