import * as fs from "fs/promises";
import * as path from "path";
import { statSafe } from "./fileTree";

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
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

function normalizeDisplayLabel(input: string): string | undefined {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return undefined;
  }
  const withoutDomain = trimmed.includes("@") ? trimmed.slice(0, trimmed.indexOf("@")) : trimmed;
  const cleaned = withoutDomain.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.slice(0, 36);
}

function pickFirstLabel(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = normalizeDisplayLabel(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export async function resolveProfileAuthLabel(profilePath: string): Promise<string | undefined> {
  const authPath = path.join(profilePath, "auth.json");
  if (!(await statSafe(authPath))?.isFile()) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(authPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const user = parsed.user as Record<string, unknown> | undefined;
    const account = parsed.account as Record<string, unknown> | undefined;
    const tokens = parsed.tokens as Record<string, unknown> | undefined;

    const direct = pickFirstLabel([
      user?.name,
      user?.username,
      user?.email,
      parsed.username,
      parsed.email,
      account?.username,
      account?.name,
      account?.email,
      tokens?.email
    ]);
    if (direct) {
      return direct;
    }

    if (tokens && typeof tokens.id_token === "string" && tokens.id_token.length > 0) {
      const claims = decodeJwtPayload(tokens.id_token);
      const tokenLabel = pickFirstLabel([claims?.name, claims?.preferred_username, claims?.email]);
      if (tokenLabel) {
        return tokenLabel;
      }
    }

    if (tokens && typeof tokens.account_id === "string" && tokens.account_id.length > 0) {
      return `acct-${tokens.account_id.slice(0, 8)}`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function toSafeBackupUserLabel(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return "user";
  }
  return normalized.slice(0, 36);
}
