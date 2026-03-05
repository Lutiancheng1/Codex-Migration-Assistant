import * as os from "os";
import * as path from "path";
import type { ClientProvider } from "../protocol/messages";

export type ProviderTarget = {
  key: string;
  sourcePath: string;
  destinationPath: string;
};

export type ProviderDescriptor = {
  id: ClientProvider;
  label: string;
  resolveTargets(codexHome: string): ProviderTarget[];
};

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: "codex",
    label: "Codex",
    resolveTargets(codexHome: string): ProviderTarget[] {
      const resolvedCodexHome = path.resolve(codexHome);
      return [
        {
          key: "home",
          sourcePath: resolvedCodexHome,
          destinationPath: resolvedCodexHome
        }
      ];
    }
  },
  {
    id: "antigravity",
    label: "Antigravity",
    resolveTargets(): ProviderTarget[] {
      const home = os.homedir();
      const userDir =
        process.platform === "darwin"
          ? path.join(home, "Library", "Application Support", "Antigravity", "User")
          : process.platform === "win32"
            ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Antigravity", "User")
            : path.join(home, ".config", "Antigravity", "User");
      return [
        {
          key: "home",
          sourcePath: path.join(home, ".antigravity"),
          destinationPath: path.join(home, ".antigravity")
        },
        {
          key: "user",
          sourcePath: userDir,
          destinationPath: userDir
        }
      ];
    }
  },
  {
    id: "claude",
    label: "Claude CLI",
    resolveTargets(): ProviderTarget[] {
      const home = os.homedir();
      return [
        {
          key: "home",
          sourcePath: path.join(home, ".claude"),
          destinationPath: path.join(home, ".claude")
        }
      ];
    }
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    resolveTargets(): ProviderTarget[] {
      const home = os.homedir();
      return [
        {
          key: "home",
          sourcePath: path.join(home, ".gemini"),
          destinationPath: path.join(home, ".gemini")
        }
      ];
    }
  },
  {
    id: "cursor",
    label: "Cursor",
    resolveTargets(): ProviderTarget[] {
      const home = os.homedir();
      return [
        {
          key: "home",
          sourcePath: path.join(home, ".cursor"),
          destinationPath: path.join(home, ".cursor")
        }
      ];
    }
  }
];

const DEFAULT_PROVIDERS: ClientProvider[] = ["codex", "antigravity"];

export function normalizeSelectedProviders(input?: ClientProvider[]): ClientProvider[] {
  const fallback = input && input.length > 0 ? input : DEFAULT_PROVIDERS;
  const known = new Set(PROVIDERS.map((item) => item.id));
  const deduped: ClientProvider[] = [];
  for (const item of fallback) {
    if (!known.has(item) || deduped.includes(item)) {
      continue;
    }
    deduped.push(item);
  }
  return deduped.length > 0 ? deduped : ["codex"];
}

export function getProvider(providerId: ClientProvider): ProviderDescriptor {
  const found = PROVIDERS.find((item) => item.id === providerId);
  if (!found) {
    throw new Error(`未知客户端: ${providerId}`);
  }
  return found;
}
