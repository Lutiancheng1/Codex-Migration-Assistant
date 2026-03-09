import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type BusyProcess = {
  pid: number;
  command: string;
};

function normalizePath(input: string): string {
  return input.trim();
}

export function parseLsofProcessOutput(stdout: string): BusyProcess[] {
  const lines = stdout.split(/\r?\n/);
  const out: BusyProcess[] = [];
  let currentPid: number | undefined;
  let currentCommand = "unknown";

  for (const line of lines) {
    if (!line) {
      continue;
    }
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const pid = Number(value);
      currentPid = Number.isFinite(pid) ? pid : undefined;
      currentCommand = "unknown";
      continue;
    }
    if (tag === "c") {
      currentCommand = value || "unknown";
      if (currentPid && currentPid > 0) {
        out.push({ pid: currentPid, command: currentCommand });
      }
      continue;
    }
  }

  const dedup = new Map<number, BusyProcess>();
  for (const item of out) {
    if (!dedup.has(item.pid)) {
      dedup.set(item.pid, item);
    }
  }
  return [...dedup.values()].sort((a, b) => a.pid - b.pid);
}

async function readPpid(pid: number): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "ppid=", "-p", String(pid)], { timeout: 2000 });
    const parsed = Number(stdout.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function collectCurrentPidLineage(maxDepth = 8): Promise<Set<number>> {
  const out = new Set<number>();
  let pid: number | undefined = process.pid;
  let depth = 0;

  while (pid && pid > 0 && depth < maxDepth) {
    if (out.has(pid)) {
      break;
    }
    out.add(pid);
    pid = await readPpid(pid);
    depth += 1;
  }

  if (process.ppid > 0) {
    out.add(process.ppid);
  }
  return out;
}

async function lsofByDirectory(pathname: string): Promise<BusyProcess[]> {
  const target = normalizePath(pathname);
  if (target.length === 0) {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-w", "-F", "pc", "+D", target], { maxBuffer: 10 * 1024 * 1024, timeout: 5000 });
    return parseLsofProcessOutput(stdout);
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string };
    if (err.code === "ENOENT") {
      return [];
    }
    if (typeof err.stdout === "string" && err.stdout.length > 0) {
      return parseLsofProcessOutput(err.stdout);
    }
    return [];
  }
}

type WindowsProcessRow = {
  ProcessId?: number;
  Name?: string;
  CommandLine?: string;
};

async function detectWindowsBusyProcesses(paths: string[]): Promise<BusyProcess[]> {
  const targets = paths.map((item) => item.toLowerCase());
  const selfPids = new Set<number>([process.pid, process.ppid].filter((item) => item > 0));

  const script = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,Name,CommandLine |",
    "ConvertTo-Json -Compress"
  ].join(" ");

  try {
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], { maxBuffer: 20 * 1024 * 1024, timeout: 8000 });
    const raw = JSON.parse(stdout) as WindowsProcessRow | WindowsProcessRow[];
    const rows = Array.isArray(raw) ? raw : [raw];
    const out: BusyProcess[] = [];
    for (const row of rows) {
      const pid = Number(row?.ProcessId);
      if (!Number.isFinite(pid) || pid <= 0 || selfPids.has(pid)) {
        continue;
      }
      const cmdline = String(row?.CommandLine ?? "").toLowerCase();
      const processName = String(row?.Name ?? "").toLowerCase();

      const isTargetMatch = cmdline && targets.some((target) => cmdline.includes(target));
      const knownBlockers = ["codex.exe", "codex-windows-sandbox.exe", "codex-app.exe"];
      const isKnownBlocker = knownBlockers.some((k) => processName.includes(k) || cmdline.includes(k));

      if (!isTargetMatch && !isKnownBlocker) {
        continue;
      }
      out.push({ pid, command: processName || "process" });
    }
    const dedup = new Map<number, BusyProcess>();
    for (const item of out) {
      dedup.set(item.pid, item);
    }
    return [...dedup.values()].sort((a, b) => a.pid - b.pid);
  } catch {
    return [];
  }
}

export async function detectExternalBusyProcesses(paths: string[]): Promise<BusyProcess[]> {
  if (process.platform === "win32") {
    return detectWindowsBusyProcesses(paths);
  }

  const selfLineage = await collectCurrentPidLineage();
  const dedup = new Map<number, BusyProcess>();
  for (const pathname of paths) {
    const entries = await lsofByDirectory(pathname);
    for (const item of entries) {
      if (selfLineage.has(item.pid)) {
        continue;
      }
      dedup.set(item.pid, item);
    }
  }
  return [...dedup.values()].sort((a, b) => a.pid - b.pid);
}

export function formatBusyProcessSummary(processes: BusyProcess[]): string {
  if (processes.length === 0) {
    return "";
  }
  return processes.slice(0, 8).map((item) => `${item.command}(${item.pid})`).join(", ");
}

export async function forceKillProcesses(pids: number[]): Promise<{ killedCount: number }> {
  let killedCount = 0;
  for (const pid of pids) {
    if (!Number.isFinite(pid) || pid <= 0) {
      continue;
    }
    if (pid === process.pid || pid === process.ppid) {
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
      killedCount += 1;
    } catch {
      // ignore
    }
  }
  if (killedCount > 0) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { killedCount };
}

export type RelaunchResult = {
  attempted: string[];
  succeeded: string[];
  failed: string[];
};

function normalizeCommands(commands: string[]): string[] {
  const dedup = new Set<string>();
  for (const raw of commands) {
    const value = raw.trim().toLowerCase();
    if (!value) {
      continue;
    }
    dedup.add(value);
  }
  return [...dedup.values()];
}

function resolveMacAppCandidates(command: string): string[] {
  if (command.includes("codex")) return ["Codex"];
  if (command.includes("antigravity")) return ["Antigravity"];
  if (command.includes("cursor")) return ["Cursor"];
  if (command.includes("windsurf")) return ["Windsurf"];
  if (command.includes("kiro")) return ["Kiro"];
  if (command.includes("trae")) return ["Trae"];
  if (command.includes("qoder")) return ["Qoder"];
  if (command === "code" || command.includes("visual studio code")) return ["Visual Studio Code", "Code"];
  if (command.includes("code - insiders") || command.includes("code-insiders")) return ["Visual Studio Code - Insiders", "Code - Insiders"];
  return [];
}

type WindowsLaunchTarget = {
  exeCandidates: string[];
  storeAppNames: string[];
};

function resolveWindowsLaunchTarget(command: string): WindowsLaunchTarget {
  if (command.includes("codex")) {
    return {
      exeCandidates: ["codex.exe", "Codex.exe", "codex-app.exe"],
      storeAppNames: ["Codex", "OpenAI Codex"]
    };
  }
  if (command.includes("antigravity")) {
    return {
      exeCandidates: ["Antigravity.exe", "antigravity.exe"],
      storeAppNames: ["Antigravity"]
    };
  }
  if (command.includes("cursor")) {
    return {
      exeCandidates: ["Cursor.exe", "cursor.exe"],
      storeAppNames: ["Cursor"]
    };
  }
  if (command.includes("windsurf")) {
    return {
      exeCandidates: ["Windsurf.exe", "windsurf.exe"],
      storeAppNames: ["Windsurf"]
    };
  }
  if (command.includes("kiro")) {
    return {
      exeCandidates: ["Kiro.exe", "kiro.exe"],
      storeAppNames: ["Kiro"]
    };
  }
  if (command.includes("trae")) {
    return {
      exeCandidates: ["Trae.exe", "trae.exe"],
      storeAppNames: ["Trae"]
    };
  }
  if (command.includes("qoder")) {
    return {
      exeCandidates: ["Qoder.exe", "qoder.exe"],
      storeAppNames: ["Qoder"]
    };
  }
  if (command === "code" || command.includes("visual studio code")) {
    return {
      exeCandidates: ["Code.exe", "code.exe"],
      storeAppNames: ["Visual Studio Code"]
    };
  }
  if (command.includes("code-insiders") || command.includes("visual studio code - insiders")) {
    return {
      exeCandidates: ["Code - Insiders.exe", "code-insiders.exe"],
      storeAppNames: ["Visual Studio Code - Insiders"]
    };
  }
  const exe = command.endsWith(".exe") ? command : `${command}.exe`;
  return { exeCandidates: [exe], storeAppNames: [] };
}

async function relaunchDarwin(commands: string[]): Promise<RelaunchResult> {
  const attempted: string[] = [];
  const succeeded: string[] = [];
  const failed: string[] = [];
  const appNames = new Set<string>();
  for (const command of commands) {
    for (const app of resolveMacAppCandidates(command)) {
      appNames.add(app);
    }
  }

  for (const appName of appNames) {
    attempted.push(appName);
    try {
      await execFileAsync("open", ["-a", appName], { timeout: 5000 });
      succeeded.push(appName);
    } catch {
      failed.push(appName);
    }
  }

  return { attempted, succeeded, failed };
}

async function tryStartWindowsExe(exe: string): Promise<boolean> {
  try {
    await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", `Start-Process -FilePath '${exe.replace(/'/g, "''")}'`],
      { timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function tryStartWindowsStoreApp(appName: string): Promise<boolean> {
  const escaped = appName.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop';",
    `$app = Get-StartApps | Where-Object { $_.Name -eq '${escaped}' -or $_.Name -like '${escaped}*' -or $_.Name -like '*${escaped}*' } | Select-Object -First 1;`,
    "if (-not $app) { throw 'APP_NOT_FOUND' }",
    'Start-Process explorer.exe -ArgumentList ("shell:AppsFolder\\" + $app.AppID)'
  ].join(" ");

  try {
    await execFileAsync("powershell", ["-NoProfile", "-Command", script], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function relaunchWindows(commands: string[]): Promise<RelaunchResult> {
  const attempted: string[] = [];
  const succeeded: string[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();

  for (const command of commands) {
    const target = resolveWindowsLaunchTarget(command);
    let launched = false;

    for (const exe of target.exeCandidates) {
      const key = `exe:${exe.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      attempted.push(exe);
      if (await tryStartWindowsExe(exe)) {
        succeeded.push(exe);
        launched = true;
        break;
      }
      failed.push(exe);
    }

    if (launched) {
      continue;
    }

    for (const appName of target.storeAppNames) {
      const key = `store:${appName.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      attempted.push(`${appName} (store)`);
      if (await tryStartWindowsStoreApp(appName)) {
        succeeded.push(`${appName} (store)`);
        launched = true;
        break;
      }
      failed.push(`${appName} (store)`);
    }
  }
  return { attempted, succeeded, failed };
}

export async function relaunchKilledProcesses(commands: string[]): Promise<RelaunchResult> {
  const normalized = normalizeCommands(commands);
  if (normalized.length === 0) {
    return { attempted: [], succeeded: [], failed: [] };
  }

  if (process.platform === "darwin") {
    return relaunchDarwin(normalized);
  }
  if (process.platform === "win32") {
    return relaunchWindows(normalized);
  }
  return { attempted: [], succeeded: [], failed: [] };
}
