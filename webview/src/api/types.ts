export type MigrationMode = "core" | "enhanced";

export type ProfileUsageWindow = {
  usedPercent: number;
  remainingPercent: number;
  resetAt?: string;
  windowSeconds: number;
};

export type ProfileUsageSummary = {
  fetchedAt: string;
  planType?: string;
  fiveHour?: ProfileUsageWindow;
  oneWeek?: ProfileUsageWindow;
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string;
  };
};

export type ProfileSummary = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  exists: boolean;
  hasAuth: boolean;
  hasState: boolean;
  usage?: ProfileUsageSummary;
  usageError?: string;
};

export type RequestMessage =
  | { type: "INIT" }
  | { type: "REFRESH_PROFILES"; payload?: { codexHome?: string } }
  | { type: "REFRESH_PROFILE_USAGE"; payload?: { codexHome?: string; profileId?: string } }
  | { type: "PICK_PATH"; payload: { kind: "folder" | "file"; title: string; filters?: Record<string, string[]> } }
  | { type: "PICK_DEFAULT_BACKUP"; payload?: { directory?: string } }
  | { type: "CREATE_PROFILE"; payload: { codexHome?: string; name: string } }
  | {
      type: "ACTIVATE_PROFILE";
      payload: { codexHome?: string; profileId: string; backupCurrent: boolean; mergeFromCurrentCore?: boolean };
    }
  | { type: "DELETE_PROFILE"; payload: { codexHome?: string; profileId: string } }
  | {
      type: "START_EXPORT";
      payload: {
        codexHome?: string;
        outputDir: string;
        includeState: boolean;
        includeAuth: boolean;
        mode: MigrationMode;
      };
    }
  | {
      type: "START_PREVIEW_IMPORT";
      payload: {
        codexHome?: string;
        backupZip: string;
        replaceState: boolean;
        importAuth: boolean;
        mode: MigrationMode;
      };
    }
  | {
      type: "START_IMPORT";
      payload: {
        codexHome?: string;
        backupZip: string;
        replaceState: boolean;
        importAuth: boolean;
        mode: MigrationMode;
      };
    }
  | {
      type: "START_IMPORT_TO_NEW_PROFILE";
      payload: {
        codexHome?: string;
        backupZip: string;
        replaceState: boolean;
        importAuth: boolean;
        mode: MigrationMode;
        profileName: string;
      };
    };

export type Stats = {
  newCount: number;
  sameCount: number;
  conflictCount: number;
  lockedCount: number;
};

export type SamplesByDomain = {
  sessions: string[];
  rules: string[];
  skills: string[];
  editorState: string[];
};

export type ExportResult = {
  codexHome: string;
  zipPath: string;
  copiedItems: string[];
  mode: MigrationMode;
  warnings: string[];
};

export type PreviewResult = {
  codexHome: string;
  backupZip: string;
  mode: MigrationMode;
  sessions: Stats;
  rules: Stats;
  skills: Stats;
  history: { appended: number; same: number };
  conflictSamples: SamplesByDomain;
  lockedSamples: SamplesByDomain;
  warnings: string[];
};

export type ImportResult = {
  codexHome: string;
  backupZip: string;
  mode: MigrationMode;
  sessions: Stats;
  rules: Stats;
  skills: Stats;
  history: { appended: number; same: number };
  conflictSamples: SamplesByDomain;
  lockedSamples: SamplesByDomain;
  warnings: string[];
  reportPath: string;
};

export type ResponseMessage =
  | {
      type: "STATE_SNAPSHOT";
      payload: {
        codexHome: string;
        platform: string;
        defaultOutputDir: string;
        profilesRoot: string;
        activeProfileId?: string;
        profiles: ProfileSummary[];
      };
    }
  | { type: "PATH_PICKED"; payload: { path?: string } }
  | { type: "TASK_PROGRESS"; payload: { step: string; percent: number; message: string } }
  | { type: "TASK_LOG"; payload: { level: "info" | "warn" | "error"; message: string } }
  | {
      type: "TASK_RESULT";
      payload: {
        action: "export" | "previewImport" | "import";
        data: ExportResult | PreviewResult | ImportResult;
      };
    }
  | { type: "TASK_ERROR"; payload: { code: string; message: string; details?: Record<string, unknown> } };
