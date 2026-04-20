import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { initializeDesktopTokenPoolService, getTokenPoolService } = require("../dist/engine/tokenPool.js");

initializeDesktopTokenPoolService();

function encodeBase64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function buildIdToken(payload) {
  return `${encodeBase64Url({ alg: "none", typ: "JWT" })}.${encodeBase64Url(payload)}.signature`;
}

async function createTokenJson(root, name, overrides = {}) {
  const filePath = path.join(root, `${name}.json`);
  const accountId = overrides.accountId ?? "shared-account";
  const email = overrides.email ?? "same@example.com";
  const plan = overrides.plan ?? "free";
  const accessToken = overrides.accessToken ?? `access-${name}`;
  const refreshToken = overrides.refreshToken ?? `refresh-${name}`;
  const idToken = buildIdToken({
    email,
    chatgpt_account_id: accountId,
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId
    },
    "https://api.openai.com/profile": {
      plan_type: plan
    }
  });

  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        email,
        type: overrides.type ?? "codex",
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          id_token: idToken,
          account_id: accountId
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return filePath;
}

test("token pool keeps same email/accountId entries when token fingerprints differ", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-pool-test-"));
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(codexHome, { recursive: true });

  try {
    const freeJson = await createTokenJson(root, "free", { plan: "free", refreshToken: "refresh-free", accessToken: "access-free" });
    const teamJson = await createTokenJson(root, "team", { plan: "team", refreshToken: "refresh-team", accessToken: "access-team" });

    const service = getTokenPoolService();
    const snapshot = await service.importFiles([freeJson, teamJson], codexHome);

    assert.equal(snapshot.entries.length, 2);
    assert.deepEqual(
      snapshot.entries.map((entry) => entry.email),
      ["same@example.com", "same@example.com"]
    );
    assert.deepEqual(
      snapshot.entries.map((entry) => entry.accountId),
      ["shared-account", "shared-account"]
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("token pool re-import replaces exact same token entry instead of duplicating it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-pool-test-"));
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(codexHome, { recursive: true });

  try {
    const tokenJson = await createTokenJson(root, "single", { plan: "team", refreshToken: "refresh-same", accessToken: "access-same" });

    const service = getTokenPoolService();
    const first = await service.importFiles([tokenJson], codexHome);
    const second = await service.importFiles([tokenJson], codexHome);

    assert.equal(first.entries.length, 1);
    assert.equal(second.entries.length, 1);
    assert.equal(second.entries[0].id, first.entries[0].id);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
