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
