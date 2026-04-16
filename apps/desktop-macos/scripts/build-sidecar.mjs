import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const binariesDir = path.join(appRoot, "src-tauri", "binaries");
const runnerEntry = path.join(repoRoot, "dist", "desktop", "runner.js");

function run(cmd, args, cwd = repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} exited with code ${code ?? "unknown"}`));
    });
  });
}

function pkgTargetForCurrentMachine() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "node20-macos-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "node20-macos-x64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "node20-linux-x64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "node20-win-x64";
  }
  throw new Error(`Unsupported sidecar build host: ${process.platform}/${process.arch}`);
}

async function readStdout(cmd, args, cwd = repoRoot) {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`${cmd} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  await run("npm", ["run", "build:ext"], repoRoot);

  const targetTriple = await readStdout("rustc", ["--print", "host-tuple"]);
  if (!targetTriple) {
    throw new Error("Failed to resolve rust target triple for sidecar build.");
  }

  await mkdir(binariesDir, { recursive: true });
  const outputBase = path.join(binariesDir, `codex-desktop-runner-${targetTriple}`);
  const outputPath = process.platform === "win32" ? `${outputBase}.exe` : outputBase;
  await rm(outputPath, { force: true });

  await run(
    "npx",
    [
      "@yao-pkg/pkg",
      runnerEntry,
      "--targets",
      pkgTargetForCurrentMachine(),
      "--output",
      outputPath,
      "--public-packages",
      "*",
      "--compress",
      "Brotli"
    ],
    repoRoot
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
