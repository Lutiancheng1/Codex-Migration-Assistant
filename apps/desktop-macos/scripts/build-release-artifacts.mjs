import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const tauriRoot = path.join(workspaceRoot, "src-tauri");
const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8"));
const version = packageJson.version;
const productName = "Codex Migration Assistant";
const safeName = `${productName}_${version}_aarch64`;
const bundleRoot = path.join(tauriRoot, "target", "release", "bundle");
const appBundlePath = path.join(bundleRoot, "macos", `${productName}.app`);
const releaseRoot = path.join(workspaceRoot, "releases", version);
const zipPath = path.join(releaseRoot, `${safeName}.zip`);
const dmgPath = path.join(releaseRoot, `${safeName}.dmg`);
const checksumPath = path.join(releaseRoot, `${safeName}.sha256`);
const notesPath = path.join(releaseRoot, "RELEASE_NOTES.txt");

async function ensurePathExists(targetPath) {
  await fs.access(targetPath);
}

async function run(command, args) {
  await execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 16 });
}

async function writeChecksums(paths) {
  const lines = [];
  for (const targetPath of paths) {
    const { stdout } = await execFileAsync("shasum", ["-a", "256", targetPath], { maxBuffer: 1024 * 1024 * 4 });
    lines.push(stdout.trim());
  }
  await fs.writeFile(checksumPath, `${lines.join("\n")}\n`, "utf8");
}

await ensurePathExists(appBundlePath);
await fs.mkdir(releaseRoot, { recursive: true });
await fs.rm(zipPath, { force: true });
await fs.rm(dmgPath, { force: true });

await run("ditto", ["-c", "-k", "--keepParent", appBundlePath, zipPath]);
await run("hdiutil", [
  "create",
  "-volname",
  productName,
  "-srcfolder",
  appBundlePath,
  "-ov",
  "-format",
  "UDZO",
  dmgPath
]);

await writeChecksums([zipPath, dmgPath]);

const notes = [
  `Product: ${productName}`,
  `Version: ${version}`,
  "Channel: unsigned local build",
  "",
  "Artifacts:",
  `- ${path.basename(zipPath)}`,
  `- ${path.basename(dmgPath)}`,
  `- ${path.basename(checksumPath)}`,
  "",
  "Signing: not signed",
  "Notarization: not notarized",
  "Requirement: Apple Developer certificates and notarization credentials are required for the next release step."
].join("\n");

await fs.writeFile(notesPath, `${notes}\n`, "utf8");

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      version,
      releaseRoot,
      zipPath,
      dmgPath,
      checksumPath,
      notesPath
    },
    null,
    2
  ) + "\n"
);
