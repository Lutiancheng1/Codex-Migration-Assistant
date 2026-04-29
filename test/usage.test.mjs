import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { fetchUsageForIdentity, refreshCodexTokens, shouldRefreshCodexTokens } = require("../dist/engine/usage.js");

function encodeBase64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function buildIdToken(payload) {
  return `${encodeBase64Url({ alg: "none", typ: "JWT" })}.${encodeBase64Url(payload)}.signature`;
}

test("fetchUsageForIdentity keeps used_percent=1 as 1 percent instead of 100 percent", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      plan_type: "free",
      rate_limit: {
        primary_window: {
          used_percent: 1,
          limit_window_seconds: 604800,
          reset_at: 1776788415
        }
      }
    })
  });

  try {
    const usage = await fetchUsageForIdentity({
      accessToken: "token",
      accountId: "account"
    });

    assert.equal(usage.planType, "free");
    assert.equal(usage.oneWeek?.usedPercent, 1);
    assert.equal(usage.oneWeek?.remainingPercent, 99);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchUsageForIdentity normalizes expired auth failures to a concise message", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (String(url).includes("/backend-api/wham/usage")) {
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () =>
          JSON.stringify({
            error: {
              message: "Provided authentication token is expired. Please try signing in again.",
              code: "token_expired"
            }
          })
      };
    }
    return {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "<html><head></head><body>Forbidden</body></html>"
    };
  };

  try {
    await assert.rejects(
      () =>
        fetchUsageForIdentity({
          accessToken: "token",
          accountId: "account"
        }),
      (error) => {
        assert.equal(error.message, "登录态已过期，请切换到该账号重新登录后再刷新用量");
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("shouldRefreshCodexTokens follows the codex five day refresh lead", () => {
  const now = Date.parse("2026-04-29T00:00:00.000Z");
  assert.equal(shouldRefreshCodexTokens("2026-05-03T23:59:00.000Z", now), true);
  assert.equal(shouldRefreshCodexTokens("2026-05-05T00:00:00.000Z", now), false);
  assert.equal(shouldRefreshCodexTokens(undefined, now), false);
});

test("refreshCodexTokens uses codex refresh_token grant and parses refreshed claims", async () => {
  const originalFetch = global.fetch;
  const idToken = buildIdToken({
    email: "team@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "account-team",
      chatgpt_plan_type: "team"
    }
  });

  global.fetch = async (url, init) => {
    assert.equal(String(url), "https://auth.openai.com/oauth/token");
    assert.equal(init.method, "POST");
    const body = init.body;
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "refresh-old");
    assert.equal(body.get("client_id"), "app_EMoamEEZ73f0CkXaXp7hrann");
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: "access-new",
          refresh_token: "refresh-new",
          id_token: idToken,
          expires_in: 3600
        })
    };
  };

  try {
    const refreshed = await refreshCodexTokens("refresh-old");
    assert.equal(refreshed.accessToken, "access-new");
    assert.equal(refreshed.refreshToken, "refresh-new");
    assert.equal(refreshed.accountId, "account-team");
    assert.equal(refreshed.email, "team@example.com");
    assert.equal(refreshed.planTypeHint, "team");
    assert.ok(refreshed.expired);
  } finally {
    global.fetch = originalFetch;
  }
});
