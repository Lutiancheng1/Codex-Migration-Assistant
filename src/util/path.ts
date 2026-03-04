import * as os from "os";
import * as path from "path";

export function defaultCodexHome(): string {
  return path.resolve(os.homedir(), ".codex");
}

export function resolveCodexHome(override?: string): string {
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }

  const envHome = process.env.CODEX_HOME;
  if (envHome && envHome.trim().length > 0) {
    return path.resolve(envHome);
  }

  return defaultCodexHome();
}
