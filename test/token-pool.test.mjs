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

test("token pool re-import from same source path replaces rotated tokens", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-pool-test-"));
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(codexHome, { recursive: true });

  try {
    const tokenJson = await createTokenJson(root, "rotating", { refreshToken: "refresh-old", accessToken: "access-old" });

    const service = getTokenPoolService();
    const first = await service.importFiles([tokenJson], codexHome);
    await createTokenJson(root, "rotating", { refreshToken: "refresh-new", accessToken: "access-new" });
    const second = await service.importFiles([tokenJson], codexHome);

    assert.equal(second.entries.length, 1);
    assert.equal(second.entries[0].id, first.entries[0].id);
    assert.equal(second.entries[0].sourceKind, "file");
    assert.equal(second.entries[0].sourcePath, path.resolve(tokenJson));

    const secretsPath = path.join(root, ".codex-profiles", "token-pool", "secrets.v1.json");
    const secrets = JSON.parse(await fs.readFile(secretsPath, "utf8"));
    assert.equal(secrets[second.entries[0].id].refreshToken, "refresh-new");
    assert.equal(secrets[second.entries[0].id].accessToken, "access-new");
    assert.equal(secrets[second.entries[0].id].sourcePath, path.resolve(tokenJson));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("token pool marks CLIProxy source files when imported from cli-proxy directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-pool-test-"));
  const codexHome = path.join(root, ".codex");
  const cliProxyDir = path.join(root, ".cli-proxy-api");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.mkdir(cliProxyDir, { recursive: true });

  try {
    const tokenJson = await createTokenJson(cliProxyDir, "codex-account", { refreshToken: "refresh-cli", accessToken: "access-cli" });

    const service = getTokenPoolService();
    const snapshot = await service.importFiles([tokenJson], codexHome);

    assert.equal(snapshot.entries.length, 1);
    assert.equal(snapshot.entries[0].sourceKind, "cliProxy");
    assert.equal(snapshot.entries[0].sourcePath, path.resolve(tokenJson));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("token pool re-import replaces same account and plan even when source path and tokens changed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-pool-test-"));
  const codexHome = path.join(root, ".codex");
  const firstDir = path.join(root, "first");
  const secondDir = path.join(root, "second");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.mkdir(firstDir, { recursive: true });
  await fs.mkdir(secondDir, { recursive: true });

  try {
    const firstJson = await createTokenJson(firstDir, "account", {
      plan: "team",
      refreshToken: "refresh-old",
      accessToken: "access-old"
    });
    const secondJson = await createTokenJson(secondDir, "account", {
      plan: "team",
      refreshToken: "refresh-new",
      accessToken: "access-new"
    });

    const service = getTokenPoolService();
    const first = await service.importFiles([firstJson], codexHome);
    const second = await service.importFiles([secondJson], codexHome);

    assert.equal(second.entries.length, 1);
    assert.equal(second.entries[0].id, first.entries[0].id);
    assert.equal(second.entries[0].sourcePath, path.resolve(secondJson));

    const secretsPath = path.join(root, ".codex-profiles", "token-pool", "secrets.v1.json");
    const secrets = JSON.parse(await fs.readFile(secretsPath, "utf8"));
    assert.equal(secrets[second.entries[0].id].refreshToken, "refresh-new");
    assert.equal(secrets[second.entries[0].id].accessToken, "access-new");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("token pool keeps different emails separate even when team accountId is shared", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-pool-test-"));
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(codexHome, { recursive: true });

  try {
    const firstJson = await createTokenJson(root, "team-a", {
      email: "team-a@example.com",
      accountId: "shared-team-account",
      plan: "team",
      refreshToken: "refresh-team-a",
      accessToken: "access-team-a"
    });
    const secondJson = await createTokenJson(root, "team-b", {
      email: "team-b@example.com",
      accountId: "shared-team-account",
      plan: "team",
      refreshToken: "refresh-team-b",
      accessToken: "access-team-b"
    });

    const service = getTokenPoolService();
    const snapshot = await service.importFiles([firstJson, secondJson], codexHome);

    assert.equal(snapshot.entries.length, 2);
    assert.deepEqual(
      snapshot.entries.map((entry) => entry.email).sort(),
      ["team-a@example.com", "team-b@example.com"]
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("token pool re-import collapses historical duplicate entries for the same account and plan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-pool-test-"));
  const codexHome = path.join(root, ".codex");
  const firstDir = path.join(root, "first");
  const secondDir = path.join(root, "second");
  const thirdDir = path.join(root, "third");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.mkdir(firstDir, { recursive: true });
  await fs.mkdir(secondDir, { recursive: true });
  await fs.mkdir(thirdDir, { recursive: true });

  try {
    const firstJson = await createTokenJson(firstDir, "account", {
      plan: "team",
      refreshToken: "refresh-old-a",
      accessToken: "access-old-a"
    });
    const secondJson = await createTokenJson(secondDir, "account", {
      plan: "team",
      refreshToken: "refresh-old-b",
      accessToken: "access-old-b"
    });
    const thirdJson = await createTokenJson(thirdDir, "account", {
      plan: "team",
      refreshToken: "refresh-new",
      accessToken: "access-new"
    });

    const service = getTokenPoolService();
    await service.importFiles([firstJson], codexHome);

    const metaPath = path.join(root, ".codex-profiles", "token-pool", "meta.v1.json");
    const secretsPath = path.join(root, ".codex-profiles", "token-pool", "secrets.v1.json");
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const secrets = JSON.parse(await fs.readFile(secretsPath, "utf8"));
    const duplicatedMeta = {
      ...meta.entries[0],
      id: `${meta.entries[0].id}-duplicate`,
      sourcePath: path.resolve(secondJson),
      updatedAt: new Date().toISOString()
    };
    meta.entries.push(duplicatedMeta);
    secrets[duplicatedMeta.id] = {
      ...secrets[meta.entries[0].id],
      accessToken: "access-old-b",
      refreshToken: "refresh-old-b",
      sourcePath: path.resolve(secondJson)
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
    await fs.writeFile(secretsPath, JSON.stringify(secrets, null, 2), "utf8");

    const snapshot = await service.importFiles([thirdJson], codexHome);
    const finalSecrets = JSON.parse(await fs.readFile(secretsPath, "utf8"));

    assert.equal(snapshot.entries.length, 1);
    assert.equal(Object.keys(finalSecrets).length, 1);
    assert.equal(finalSecrets[snapshot.entries[0].id].refreshToken, "refresh-new");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
