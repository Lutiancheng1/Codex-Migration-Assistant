export type MigrationMode = "core";
export type ClientProvider = "codex" | "antigravity" | "claude" | "gemini" | "cursor";
export type UsageAuthMode = "local_extract" | "manual_token";

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

export type AntigravityProfileSummary = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  exists: boolean;
  hasHome: boolean;
  hasUser: boolean;
};

export type RequestMessage =
  | { type: "INIT" }
  | { type: "REFRESH_PROFILES"; payload?: { codexHome?: string } }
  | { type: "REFRESH_PROFILE_USAGE"; payload?: { codexHome?: string; profileId?: string } }
  | { type: "REFRESH_ANTIGRAVITY_PROFILES" }
  | { type: "CREATE_ANTIGRAVITY_PROFILE"; payload: { name: string } }
  | { type: "ACTIVATE_ANTIGRAVITY_PROFILE"; payload: { profileId: string; backupCurrent: boolean } }
  | { type: "DELETE_ANTIGRAVITY_PROFILE"; payload: { profileId: string } }
  | { type: "REFRESH_ANTIGRAVITY_USAGE" }
  | { type: "SET_ANTIGRAVITY_USAGE_AUTH"; payload: { mode: UsageAuthMode; refreshToken?: string } }
  | { type: "PICK_PATH"; payload: { kind: "folder" | "file"; title: string; filters?: Record<string, string[]> } }
  | { type: "PICK_DEFAULT_BACKUP"; payload?: { directory?: string } }
  | { type: "OPEN_IN_OS"; payload: { path: string } }
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
      selectedProviders?: ClientProvider[];
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
      selectedProviders?: ClientProvider[];
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
      selectedProviders?: ClientProvider[];
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
      selectedProviders?: ClientProvider[];
      replaceState: boolean;
      importAuth: boolean;
      mode: MigrationMode;
      profileName: string;
    };
  }
  | { type: "KILL_PROCESSES"; payload: { pids: number[]; commands?: string[] } };

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
  selectedProviders: ClientProvider[];
  copiedItems: string[];
  mode: MigrationMode;
  warnings: string[];
};

export type PreviewResult = {
  codexHome: string;
  backupZip: string;
  selectedProviders: ClientProvider[];
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
  selectedProviders: ClientProvider[];
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

export type SwitchProfileResult = {
  codexHome: string;
  targetProfileId: string;
  backupCurrent: boolean;
  mergeFromCurrentCore: boolean;
  relaunchedClients: string[];
  messages: string[];
};

export type SwitchAntigravityProfileResult = {
  targetProfileId: string;
  backupCurrent: boolean;
  relaunchedClients: string[];
  messages: string[];
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
      antigravityProfilesRoot: string;
      activeAntigravityProfileId?: string;
      antigravityProfiles: AntigravityProfileSummary[];
      antigravityUsage?: {
        mode: UsageAuthMode;
        summary?: ProfileUsageSummary;
        error?: string;
      };
    };
  }
  | { type: "PATH_PICKED"; payload: { path?: string } }
  | { type: "TASK_PROGRESS"; payload: { step: string; percent: number; message: string } }
  | { type: "TASK_LOG"; payload: { level: "info" | "warn" | "error"; message: string } }
  | {
    type: "TASK_RESULT";
    payload: {
      action:
      | "export"
      | "previewImport"
      | "import"
      | "switchProfile"
      | "switchAntigravityProfile"
      | "killProcesses"
      | "refreshAntigravityUsage";
      data:
      | ExportResult
      | PreviewResult
      | ImportResult
      | SwitchProfileResult
      | SwitchAntigravityProfileResult
      | { killedCount: number }
      | { mode: UsageAuthMode; summary: ProfileUsageSummary };
    };
  }
  | { type: "TASK_ERROR"; payload: { code: string; message: string; details?: Record<string, unknown> } };
