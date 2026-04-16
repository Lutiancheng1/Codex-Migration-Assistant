import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { fetchUsageForIdentity } = require("../dist/engine/usage.js");

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
