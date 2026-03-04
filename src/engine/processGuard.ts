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
    // lsof exits with non-zero when no open files found
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

      // 如果有详细命令行，查看是否命中目标目录；或者看是否名字属于黑名单
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
    // 不要杀向自己以及父进程，防止插件自毁
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
  // 给杀伤留出退散和系统文件锁释放时间
  if (killedCount > 0) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { killedCount };
}
