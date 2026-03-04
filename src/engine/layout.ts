import * as os from "os";
import * as path from "path";
import { fileExists, statSafe } from "./fileTree";

type EditorSpec = {
  id: string;
  label: string;
  darwinUserDir?: string;
  win32UserDir?: string;
  linuxUserDir?: string;
};

const EDITOR_SPECS: EditorSpec[] = [
  {
    id: "vscode",
    label: "VS Code",
    darwinUserDir: "Library/Application Support/Code/User",
    win32UserDir: "Code/User",
    linuxUserDir: ".config/Code/User"
  },
  {
    id: "vscode-insiders",
    label: "VS Code Insiders",
    darwinUserDir: "Library/Application Support/Code - Insiders/User",
    win32UserDir: "Code - Insiders/User",
    linuxUserDir: ".config/Code - Insiders/User"
  },
  {
    id: "cursor",
    label: "Cursor",
    darwinUserDir: "Library/Application Support/Cursor/User",
    win32UserDir: "Cursor/User",
    linuxUserDir: ".config/Cursor/User"
  },
  {
    id: "antigravity",
    label: "Antigravity",
    darwinUserDir: "Library/Application Support/Antigravity/User",
    win32UserDir: "Antigravity/User",
    linuxUserDir: ".config/Antigravity/User"
  },
  {
    id: "kiro",
    label: "Kiro",
    darwinUserDir: "Library/Application Support/Kiro/User",
    win32UserDir: "Kiro/User",
    linuxUserDir: ".config/Kiro/User"
  },
  {
    id: "trae",
    label: "Trae",
    darwinUserDir: "Library/Application Support/Trae/User",
    win32UserDir: "Trae/User",
    linuxUserDir: ".config/Trae/User"
  },
  {
    id: "qoder",
    label: "Qoder",
    darwinUserDir: "Library/Application Support/Qoder/User",
    win32UserDir: "Qoder/User",
    linuxUserDir: ".config/Qoder/User"
  }
];

export type BackupLayout = {
  extractRoot: string;
  coreRoot: string;
  editors: BackupEditorPayload[];
  metadataPath?: string;
};

export type BackupEditorPayload = {
  editorId: string;
  editorLabel: string;
  root: string;
  globalStorageDir?: string;
  workspaceStorageDir?: string;
};

export function editorLabelFromId(editorId: string): string {
  return EDITOR_SPECS.find((item) => item.id === editorId)?.label ?? editorId;
}

export async function resolveBackupLayout(extractRoot: string): Promise<BackupLayout> {
  const fs = await import("fs/promises");
  const metadataPath = path.join(extractRoot, "metadata.json");
  const payloadCore = path.join(extractRoot, "payload", "core");
  const payloadLegacy = path.join(extractRoot, "payload");

  let coreRoot = extractRoot;
  if ((await statSafe(payloadCore))?.isDirectory()) {
    coreRoot = payloadCore;
  } else if ((await statSafe(payloadLegacy))?.isDirectory()) {
    coreRoot = payloadLegacy;
  }

  const editors: BackupEditorPayload[] = [];
  const editorBaseRoot = path.join(extractRoot, "payload", "editor");
  if ((await statSafe(editorBaseRoot))?.isDirectory()) {
    const entries = await fs.readdir(editorBaseRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const editorId = entry.name;
      const editorRoot = path.join(editorBaseRoot, editorId);
      const globalStorageDir = path.join(editorRoot, "globalStorage");
      const workspaceStorageDir = path.join(editorRoot, "workspaceStorage");
      editors.push({
        editorId,
        editorLabel: editorLabelFromId(editorId),
        root: editorRoot,
        globalStorageDir: (await statSafe(globalStorageDir))?.isDirectory() ? globalStorageDir : undefined,
        workspaceStorageDir: (await statSafe(workspaceStorageDir))?.isDirectory() ? workspaceStorageDir : undefined
      });
    }
  }

  return {
    extractRoot,
    coreRoot,
    editors,
    metadataPath: (await fileExists(metadataPath)) ? metadataPath : undefined
  };
}

export async function resolveCompatSourceDir(coreRoot: string, name: string): Promise<string> {
  const direct = path.join(coreRoot, name);
  const directStat = await statSafe(direct);
  if (!directStat?.isDirectory()) {
    return direct;
  }

  const nested = path.join(direct, name);
  const nestedStat = await statSafe(nested);
  if (!nestedStat?.isDirectory()) {
    return direct;
  }

  return nested;
}

export type LocalEditorSource = {
  editors: EditorStorageTarget[];
};

export type EditorStorageTarget = {
  editorId: string;
  editorLabel: string;
  userDir: string;
  globalStorageDir?: string;
  workspaceStorageDir?: string;
  codexGlobalStorageDirs: string[];
  codexWorkspaceStorageDirs: string[];
};

function resolveEditorUserDir(spec: EditorSpec): string | undefined {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return spec.darwinUserDir ? path.join(home, spec.darwinUserDir) : undefined;
  }
  if (process.platform === "win32") {
    if (!spec.win32UserDir) {
      return undefined;
    }
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, spec.win32UserDir);
  }
  if (process.platform === "linux") {
    return spec.linuxUserDir ? path.join(home, spec.linuxUserDir) : undefined;
  }
  return undefined;
}

function isCodexStorageName(name: string): boolean {
  return /(codex|openai|chatgpt|antigravity)/i.test(name);
}

async function detectCodexWorkspaceStorageDir(dirPath: string): Promise<boolean> {
  const fs = await import("fs/promises");
  const workspaceJson = path.join(dirPath, "workspace.json");
  if ((await statSafe(workspaceJson))?.isFile()) {
    try {
      const content = await fs.readFile(workspaceJson, "utf8");
      if (/(codex|openai|chatgpt|antigravity)/i.test(content)) {
        return true;
      }
    } catch {
      // ignore parse/read failure for detection
    }
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (isCodexStorageName(entry.name)) {
      return true;
    }
  }
  return false;
}

export async function discoverLocalEditorSource(): Promise<LocalEditorSource> {
  const fs = await import("fs/promises");
  const editors: EditorStorageTarget[] = [];

  for (const spec of EDITOR_SPECS) {
    const userDir = resolveEditorUserDir(spec);
    if (!userDir) {
      continue;
    }

    const globalStorageDir = path.join(userDir, "globalStorage");
    const workspaceStorageDir = path.join(userDir, "workspaceStorage");
    const hasGlobalStorage = (await statSafe(globalStorageDir))?.isDirectory() ?? false;
    const hasWorkspaceStorage = (await statSafe(workspaceStorageDir))?.isDirectory() ?? false;

    if (!hasGlobalStorage && !hasWorkspaceStorage) {
      continue;
    }

    const codexGlobalStorageDirs: string[] = [];
    const codexWorkspaceStorageDirs: string[] = [];

    if (hasGlobalStorage) {
      const entries = await fs.readdir(globalStorageDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (isCodexStorageName(entry.name)) {
          codexGlobalStorageDirs.push(path.join(globalStorageDir, entry.name));
        }
      }
    }

    if (hasWorkspaceStorage) {
      const entries = await fs.readdir(workspaceStorageDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const fullPath = path.join(workspaceStorageDir, entry.name);
        if (await detectCodexWorkspaceStorageDir(fullPath)) {
          codexWorkspaceStorageDirs.push(fullPath);
        }
      }
    }

    editors.push({
      editorId: spec.id,
      editorLabel: spec.label,
      userDir,
      globalStorageDir: hasGlobalStorage ? globalStorageDir : undefined,
      workspaceStorageDir: hasWorkspaceStorage ? workspaceStorageDir : undefined,
      codexGlobalStorageDirs,
      codexWorkspaceStorageDirs
    });
  }

  return { editors };
}
