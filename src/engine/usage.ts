import * as fs from "fs/promises";
import * as path from "path";
import { statSafe } from "./fileTree";

type UsageWindowRaw = {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
};

type UsageApiResponse = {
  plan_type?: string;
  rate_limit?: {
    primary_window?: UsageWindowRaw;
    secondary_window?: UsageWindowRaw;
  };
  additional_rate_limits?: Array<{
    rate_limit?: {
      primary_window?: UsageWindowRaw;
      secondary_window?: UsageWindowRaw;
    };
  }>;
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: string;
  };
};

type UsageFetchFailure = {
  url: string;
  message: string;
  status?: number;
  body?: string;
};

type AuthJsonRecord = Record<string, unknown> & {
  tokens?: Record<string, unknown>;
};

export type ProfileUsageWindow = {
  usedPercent: number;
  remainingPercent: number;
  resetAt?: string;
  windowSeconds: number;
};

export type ProfileUsageSummary = {
  fetchedAt: string;
  planType?: string;
  fiveHour?: ProfileUsageWindow;
  oneWeek?: ProfileUsageWindow;
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string;
  };
};

export type AuthIdentity = {
  accessToken: string;
  accountId: string;
};

export type CodexTokenRefreshResult = {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  accountId?: string;
  email?: string;
  expired: string;
  lastRefresh: string;
  planTypeHint?: string;
};

const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_REFRESH_LEAD_MS = 5 * 24 * 60 * 60 * 1000;

export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const segment = token.split(".")[1];
  if (!segment) {
    return undefined;
  }
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  try {
    const json = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function extractAccountIdFromClaims(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) {
    return undefined;
  }
  const authClaim = payload["https://api.openai.com/auth"];
  if (!authClaim || typeof authClaim !== "object") {
    return undefined;
  }
  const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim().length > 0 ? accountId : undefined;
}

export function extractEmailFromClaims(payload: Record<string, unknown> | undefined): string | undefined {
  const email = payload?.email;
  return typeof email === "string" && email.trim().length > 0 ? email.trim() : undefined;
}

export function extractPlanTypeFromClaims(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) {
    return undefined;
  }
  const authClaim = payload["https://api.openai.com/auth"];
  if (!authClaim || typeof authClaim !== "object") {
    return undefined;
  }
  const planType = (authClaim as Record<string, unknown>).chatgpt_plan_type;
  return typeof planType === "string" && planType.trim().length > 0 ? planType.trim() : undefined;
}

export function shouldRefreshCodexTokens(expired: string | undefined, now = Date.now()): boolean {
  if (!expired) {
    return false;
  }
  const expiresAt = Date.parse(expired);
  if (!Number.isFinite(expiresAt)) {
    return false;
  }
  return expiresAt - now <= CODEX_REFRESH_LEAD_MS;
}

export function isExpiredAuthErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("token_expired") || lower.includes("authentication token is expired") || lower.includes("登录态已过期");
}

export async function refreshCodexTokens(refreshToken: string): Promise<CodexTokenRefreshResult> {
  if (!refreshToken.trim()) {
    throw new Error("缺少 refresh_token，无法续期登录态");
  }

  const body = new URLSearchParams({
    client_id: CODEX_OAUTH_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "openid profile email"
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body,
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      const lower = text.toLowerCase();
      if (lower.includes("refresh_token_reused") || lower.includes("invalid_grant")) {
        throw new Error("登录态续期失败：refresh_token 已失效，请重新登录后再刷新用量");
      }
      throw new Error(`登录态续期失败：${response.status} ${response.statusText} ${text.slice(0, 160)}`.trim());
    }

    const parsed = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };
    if (!parsed.access_token || !parsed.refresh_token || !parsed.id_token) {
      throw new Error("登录态续期失败：响应缺少必要 token 字段");
    }

    const idClaims = decodeJwtPayload(parsed.id_token);
    return {
      accessToken: parsed.access_token,
      idToken: parsed.id_token,
      refreshToken: parsed.refresh_token,
      accountId: extractAccountIdFromClaims(idClaims),
      email: extractEmailFromClaims(idClaims),
      expired: new Date(Date.now() + Math.max(0, parsed.expires_in ?? 0) * 1000).toISOString(),
      lastRefresh: new Date().toISOString(),
      planTypeHint: extractPlanTypeFromClaims(idClaims)
    };
  } finally {
    clearTimeout(timer);
  }
}

function readTokenString(tokens: Record<string, unknown> | undefined, raw: Record<string, unknown>, key: string): string | undefined {
  const value = tokens?.[key] ?? raw[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getAuthIdentityFromParsed(parsed: AuthJsonRecord): AuthIdentity & { refreshToken?: string; expired?: string } {
  const tokens = parsed.tokens && typeof parsed.tokens === "object" ? parsed.tokens : undefined;
  if (!tokens || typeof tokens !== "object") {
    throw new Error("auth.json 缺少 tokens");
  }

  const accessToken = readTokenString(tokens, parsed, "access_token");
  if (!accessToken) {
    throw new Error("auth.json 缺少 access_token");
  }

  const idToken = readTokenString(tokens, parsed, "id_token");
  const accountId = readTokenString(tokens, parsed, "account_id") ?? (idToken ? extractAccountIdFromClaims(decodeJwtPayload(idToken)) : undefined);
  if (!accountId) {
    throw new Error("auth.json 缺少 account_id");
  }

  return {
    accessToken,
    accountId,
    refreshToken: readTokenString(tokens, parsed, "refresh_token"),
    expired: readTokenString(tokens, parsed, "expired") ?? readTokenString(undefined, parsed, "expires_at")
  };
}

async function readAuthIdentity(profilePath: string): Promise<AuthIdentity> {
  return readAuthIdentityWithRefresh(profilePath, false);
}

async function readAuthIdentityWithRefresh(profilePath: string, forceRefresh: boolean): Promise<AuthIdentity> {
  const authPath = path.join(profilePath, "auth.json");
  const st = await statSafe(authPath);
  if (!st?.isFile()) {
    throw new Error("未检测到 auth.json");
  }

  const raw = await fs.readFile(authPath, "utf8");
  const parsed = JSON.parse(raw) as AuthJsonRecord;
  const identity = getAuthIdentityFromParsed(parsed);
  if (!identity.refreshToken || (!forceRefresh && !shouldRefreshCodexTokens(identity.expired))) {
    return identity;
  }

  try {
    const refreshed = await refreshCodexTokens(identity.refreshToken);
    const tokens = parsed.tokens && typeof parsed.tokens === "object" ? { ...parsed.tokens } : {};
    tokens.access_token = refreshed.accessToken;
    tokens.id_token = refreshed.idToken;
    tokens.refresh_token = refreshed.refreshToken;
    tokens.account_id = refreshed.accountId ?? identity.accountId;
    tokens.expired = refreshed.expired;
    parsed.tokens = tokens;
    parsed.expired = refreshed.expired;
    parsed.last_refresh = refreshed.lastRefresh;
    await fs.writeFile(authPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    return {
      accessToken: refreshed.accessToken,
      accountId: refreshed.accountId ?? identity.accountId
    };
  } catch (error) {
    if (forceRefresh) {
      throw error;
    }
    return identity;
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

function resolveUsageUrls(baseUrl?: string): string[] {
  const normalized = (baseUrl?.trim() || "https://chatgpt.com").replace(/\/+$/, "");
  const urls: string[] = [];

  if (normalized.endsWith("/backend-api")) {
    const origin = normalized.slice(0, -"/backend-api".length);
    urls.push(`${normalized}/wham/usage`);
    urls.push(`${origin}/backend-api/wham/usage`);
    urls.push(`${origin}/api/codex/usage`);
  } else {
    urls.push(`${normalized}/backend-api/wham/usage`);
    urls.push(`${normalized}/wham/usage`);
    urls.push(`${normalized}/api/codex/usage`);
  }

  urls.push("https://chatgpt.com/backend-api/wham/usage");
  urls.push("https://chatgpt.com/api/codex/usage");

  return [...new Set(urls)];
}

function normalizePercent(value: number | undefined): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  // Current usage endpoints return used_percent as a 0-100 percentage value.
  // Keep support for fractional ratios such as 0.25, but do not treat 1 as 100%.
  if (value >= 0 && value < 1) {
    return Math.min(100, Math.max(0, value * 100));
  }
  return Math.min(100, Math.max(0, value));
}

function toWindow(raw: UsageWindowRaw | undefined): ProfileUsageWindow | undefined {
  if (!raw) {
    return undefined;
  }
  const usedPercent = normalizePercent(raw.used_percent);
  const windowSeconds = raw.limit_window_seconds;
  if (typeof usedPercent !== "number" || typeof windowSeconds !== "number" || windowSeconds <= 0) {
    return undefined;
  }
  return {
    usedPercent,
    remainingPercent: Math.min(100, Math.max(0, 100 - usedPercent)),
    resetAt: typeof raw.reset_at === "number" ? new Date(raw.reset_at * 1000).toISOString() : undefined,
    windowSeconds
  };
}

function pickNearestWindow(windows: ProfileUsageWindow[], targetSeconds: number): ProfileUsageWindow | undefined {
  if (windows.length === 0) {
    return undefined;
  }
  let best = windows[0];
  let bestDistance = Math.abs(best.windowSeconds - targetSeconds);
  for (const item of windows.slice(1)) {
    const distance = Math.abs(item.windowSeconds - targetSeconds);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function mapUsagePayload(payload: UsageApiResponse): ProfileUsageSummary {
  const windows: ProfileUsageWindow[] = [];
  const push = (raw?: UsageWindowRaw): void => {
    const parsed = toWindow(raw);
    if (parsed) {
      windows.push(parsed);
    }
  };

  push(payload.rate_limit?.primary_window);
  push(payload.rate_limit?.secondary_window);
  for (const item of payload.additional_rate_limits ?? []) {
    push(item.rate_limit?.primary_window);
    push(item.rate_limit?.secondary_window);
  }

  const fiveHour = pickNearestWindow(windows, 5 * 60 * 60);
  const oneWeek = pickNearestWindow(windows, 7 * 24 * 60 * 60);

  return {
    fetchedAt: new Date().toISOString(),
    planType: payload.plan_type,
    fiveHour,
    oneWeek,
    credits: payload.credits
      ? {
          hasCredits: !!payload.credits.has_credits,
          unlimited: !!payload.credits.unlimited,
          balance: payload.credits.balance
        }
      : undefined
  };
}

async function fetchUsage(url: string, identity: AuthIdentity): Promise<UsageApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${identity.accessToken}`,
        "ChatGPT-Account-Id": identity.accountId,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`${response.status} ${response.statusText} ${text.slice(0, 160)}`.trim()) as Error & {
        status?: number;
        body?: string;
      };
      error.status = response.status;
      error.body = text;
      throw error;
    }

    return (await response.json()) as UsageApiResponse;
  } finally {
    clearTimeout(timer);
  }
}

function summarizeUsageFailures(errors: UsageFetchFailure[]): string {
  const authExpired = errors.some((item) => {
    const body = (item.body || item.message).toLowerCase();
    return item.status === 401 && (body.includes("token_expired") || body.includes("authentication token is expired"));
  });
  if (authExpired) {
    return "登录态已过期，请切换到该账号重新登录后再刷新用量";
  }

  const authRejected = errors.some((item) => {
    const body = (item.body || item.message).toLowerCase();
    return item.status === 401 || (item.status === 403 && (body.includes("forbidden") || body.includes("<html")));
  });
  if (authRejected) {
    return "登录态无效或权限不足，请重新登录后再刷新用量";
  }

  const aborted = errors.some((item) => item.message.toLowerCase().includes("abort"));
  if (aborted) {
    return "用量查询超时，请稍后重试";
  }

  const unavailable = errors.some((item) => (item.status ?? 0) >= 500);
  if (unavailable) {
    return "用量接口暂时不可用，请稍后重试";
  }

  return errors
    .slice(0, 2)
    .map((item) => `${item.url} -> ${item.message}`)
    .join(" | ");
}

export async function fetchUsageForIdentity(identity: AuthIdentity, baseUrl?: string): Promise<ProfileUsageSummary> {
  const urls = resolveUsageUrls(baseUrl);
  const errors: UsageFetchFailure[] = [];
  for (const url of urls) {
    try {
      const payload = await fetchUsage(url, identity);
      return mapUsagePayload(payload);
    } catch (error) {
      const typed = error as Error & { status?: number; body?: string };
      errors.push({
        url,
        message: typed.message,
        status: typed.status,
        body: typed.body
      });
    }
  }
  throw new Error(summarizeUsageFailures(errors));
}

export async function fetchProfileUsage(profilePath: string): Promise<ProfileUsageSummary> {
  const identity = await readAuthIdentity(profilePath);
  const baseUrl = await readChatgptBaseUrl(profilePath);
  try {
    return await fetchUsageForIdentity(identity, baseUrl);
  } catch (error) {
    const message = (error as Error).message;
    if (!isExpiredAuthErrorMessage(message)) {
      throw error;
    }
    const refreshedIdentity = await readAuthIdentityWithRefresh(profilePath, true);
    return fetchUsageForIdentity(refreshedIdentity, baseUrl);
  }
}
