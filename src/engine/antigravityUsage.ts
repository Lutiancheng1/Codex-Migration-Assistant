import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ProfileUsageSummary } from "../protocol/messages";

const execFileAsync = promisify(execFile);

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CLOUD_CODE_API_BASE = "https://cloudcode-pa.googleapis.com";
const LOAD_CODE_ASSIST_PATH = "/v1internal:loadCodeAssist";
const FETCH_AVAILABLE_MODELS_PATH = "/v1internal:fetchAvailableModels";

export type AntigravityUsageAuthMode = "local_extract" | "manual_token";

export type AntigravityUsageResult = {
  mode: AntigravityUsageAuthMode;
  summary: ProfileUsageSummary;
};

function readGoogleOAuthClientConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.ANTIGRAVITY_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.ANTIGRAVITY_GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "缺少 Google OAuth 客户端配置。请设置环境变量 ANTIGRAVITY_GOOGLE_CLIENT_ID 与 ANTIGRAVITY_GOOGLE_CLIENT_SECRET。"
    );
  }
  return { clientId, clientSecret };
}

function getAntigravityStateDbPath(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Antigravity", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Antigravity", "User", "globalStorage", "state.vscdb");
  }
  return path.join(home, ".config", "Antigravity", "User", "globalStorage", "state.vscdb");
}

function readVarint(buffer: Buffer, start: number): { value: number; next: number } {
  let result = BigInt(0);
  let shift = 0;
  let cursor = start;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    result |= BigInt(byte & 0x7f) << BigInt(shift);
    cursor += 1;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
    if (shift > 63) {
      break;
    }
  }
  return {
    value: result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : Number.MAX_SAFE_INTEGER,
    next: cursor
  };
}

function findProtobufField(buffer: Buffer, fieldNumber: number): Buffer | undefined {
  let cursor = 0;
  while (cursor < buffer.length) {
    const tag = readVarint(buffer, cursor);
    cursor = tag.next;
    if (cursor >= buffer.length) {
      break;
    }
    const wireType = tag.value & 0x07;
    const field = tag.value >> 3;

    if (wireType === 2) {
      const len = readVarint(buffer, cursor);
      cursor = len.next;
      const end = cursor + len.value;
      if (field === fieldNumber && end <= buffer.length) {
        return buffer.slice(cursor, end);
      }
      cursor = end;
      continue;
    }
    if (wireType === 0) {
      cursor = readVarint(buffer, cursor).next;
      continue;
    }
    if (wireType === 1) {
      cursor += 8;
      continue;
    }
    if (wireType === 5) {
      cursor += 4;
      continue;
    }
    break;
  }
  return undefined;
}

function parseRefreshTokenFromAgentManagerBlob(rawBase64: string): string | undefined {
  const decoded = Buffer.from(rawBase64, "base64");
  const oauthData = findProtobufField(decoded, 6);
  if (!oauthData) {
    return undefined;
  }
  const refresh = findProtobufField(oauthData, 3);
  if (!refresh) {
    return undefined;
  }
  const token = refresh.toString("utf8").trim();
  return token.length > 0 ? token : undefined;
}

async function extractRefreshTokenFromLocalDb(): Promise<string | undefined> {
  const dbPath = getAntigravityStateDbPath();
  const sql = "SELECT value FROM ItemTable WHERE key = 'jetskiStateSync.agentManagerInitState' LIMIT 1;";
  try {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], { timeout: 8000, maxBuffer: 10 * 1024 * 1024 });
    const raw = stdout.trim();
    if (!raw) {
      return undefined;
    }
    return parseRefreshTokenFromAgentManagerBlob(raw);
  } catch {
    return undefined;
  }
}

async function exchangeRefreshToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = readGoogleOAuthClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token 刷新失败: ${response.status} ${text.slice(0, 180)}`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google token 刷新结果缺少 access_token");
  }
  return data.access_token;
}

async function callCloudCode(pathname: string, accessToken: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${CLOUD_CODE_API_BASE}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CloudCode 请求失败: ${response.status} ${text.slice(0, 180)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function parseTier(loadProjectInfo: Record<string, unknown>): string {
  const paidTier = (loadProjectInfo.paidTier ?? {}) as Record<string, unknown>;
  const currentTier = (loadProjectInfo.currentTier ?? {}) as Record<string, unknown>;
  const paidId = typeof paidTier.id === "string" ? paidTier.id : undefined;
  const currentId = typeof currentTier.id === "string" ? currentTier.id : undefined;
  return paidId || currentId || "free";
}

function toIsoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
}

function normalizeRemainingPercent(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  if (value >= 0 && value <= 1) {
    return Math.max(0, Math.min(100, value * 100));
  }
  return Math.max(0, Math.min(100, value));
}

function summarizeFromModels(modelsResponse: Record<string, unknown>, planType: string): ProfileUsageSummary {
  const models = (modelsResponse.models ?? {}) as Record<string, unknown>;
  let minRemaining: number | undefined;
  let nearestReset: string | undefined;
  for (const item of Object.values(models)) {
    const model = item as Record<string, unknown>;
    const quotaInfo = (model.quotaInfo ?? {}) as Record<string, unknown>;
    const remaining = normalizeRemainingPercent(quotaInfo.remainingFraction);
    if (typeof remaining === "number") {
      minRemaining = typeof minRemaining === "number" ? Math.min(minRemaining, remaining) : remaining;
    }
    const resetTime = toIsoOrUndefined(quotaInfo.resetTime);
    if (resetTime) {
      if (!nearestReset || Date.parse(resetTime) < Date.parse(nearestReset)) {
        nearestReset = resetTime;
      }
    }
  }

  const remainingPercent = typeof minRemaining === "number" ? minRemaining : 0;
  const usedPercent = Math.max(0, 100 - remainingPercent);
  return {
    fetchedAt: new Date().toISOString(),
    planType,
    fiveHour: {
      usedPercent,
      remainingPercent,
      resetAt: nearestReset,
      windowSeconds: 5 * 60 * 60
    },
    oneWeek: {
      usedPercent,
      remainingPercent,
      resetAt: nearestReset,
      windowSeconds: 7 * 24 * 60 * 60
    }
  };
}

export async function fetchAntigravityUsage(mode: AntigravityUsageAuthMode, manualRefreshToken?: string): Promise<AntigravityUsageResult> {
  const refreshToken = mode === "manual_token" ? manualRefreshToken?.trim() : await extractRefreshTokenFromLocalDb();
  if (!refreshToken) {
    throw new Error(mode === "manual_token" ? "未提供手动 refresh token" : "本地提取失败，未找到 Antigravity refresh token");
  }
  const accessToken = await exchangeRefreshToken(refreshToken);
  const loadResult = await callCloudCode(LOAD_CODE_ASSIST_PATH, accessToken, { metadata: { ideType: "ANTIGRAVITY" } });
  const projectId = typeof loadResult.cloudaicompanionProject === "string" ? loadResult.cloudaicompanionProject : "";
  const tier = parseTier(loadResult);
  const models = await callCloudCode(FETCH_AVAILABLE_MODELS_PATH, accessToken, projectId ? { project: projectId } : {});
  return {
    mode,
    summary: summarizeFromModels(models, tier)
  };
}
