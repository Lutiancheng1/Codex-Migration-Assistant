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

async function readAuthIdentity(profilePath: string): Promise<AuthIdentity> {
  const authPath = path.join(profilePath, "auth.json");
  const st = await statSafe(authPath);
  if (!st?.isFile()) {
    throw new Error("未检测到 auth.json");
  }

  const raw = await fs.readFile(authPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const tokens = parsed.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens !== "object") {
    throw new Error("auth.json 缺少 tokens");
  }

  const accessToken = tokens.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("auth.json 缺少 access_token");
  }

  let accountId = tokens.account_id;
  if (typeof accountId !== "string" || accountId.length === 0) {
    const idToken = tokens.id_token;
    if (typeof idToken === "string" && idToken.length > 0) {
      accountId = extractAccountIdFromClaims(decodeJwtPayload(idToken));
    }
  }
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("auth.json 缺少 account_id");
  }

  return { accessToken, accountId };
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
  if (value >= 0 && value <= 1) {
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
      throw new Error(`${response.status} ${response.statusText} ${text.slice(0, 160)}`.trim());
    }

    return (await response.json()) as UsageApiResponse;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchUsageForIdentity(identity: AuthIdentity, baseUrl?: string): Promise<ProfileUsageSummary> {
  const urls = resolveUsageUrls(baseUrl);
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const payload = await fetchUsage(url, identity);
      return mapUsagePayload(payload);
    } catch (error) {
      errors.push(`${url} -> ${(error as Error).message}`);
    }
  }
  throw new Error(errors.slice(0, 3).join(" | "));
}

export async function fetchProfileUsage(profilePath: string): Promise<ProfileUsageSummary> {
  const identity = await readAuthIdentity(profilePath);
  const baseUrl = await readChatgptBaseUrl(profilePath);
  return fetchUsageForIdentity(identity, baseUrl);
}
