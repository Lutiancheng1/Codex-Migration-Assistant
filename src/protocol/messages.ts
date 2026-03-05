import type { AppError } from "./errors";

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

export type InitRequest = { type: "INIT" };
export type RefreshProfilesRequest = { type: "REFRESH_PROFILES"; payload?: { codexHome?: string } };
export type RefreshProfileUsageRequest = { type: "REFRESH_PROFILE_USAGE"; payload?: { codexHome?: string; profileId?: string } };
export type RefreshAntigravityProfilesRequest = { type: "REFRESH_ANTIGRAVITY_PROFILES" };
export type CreateAntigravityProfileRequest = { type: "CREATE_ANTIGRAVITY_PROFILE"; payload: { name: string } };
export type ActivateAntigravityProfileRequest = {
  type: "ACTIVATE_ANTIGRAVITY_PROFILE";
  payload: { profileId: string; backupCurrent: boolean };
};
export type DeleteAntigravityProfileRequest = { type: "DELETE_ANTIGRAVITY_PROFILE"; payload: { profileId: string } };
export type RefreshAntigravityUsageRequest = { type: "REFRESH_ANTIGRAVITY_USAGE" };
export type SetAntigravityUsageAuthRequest = {
  type: "SET_ANTIGRAVITY_USAGE_AUTH";
  payload: { mode: UsageAuthMode; refreshToken?: string };
};
export type PickPathRequest = { type: "PICK_PATH"; payload: { kind: "folder" | "file"; title: string; filters?: Record<string, string[]> } };
export type PickDefaultBackupRequest = { type: "PICK_DEFAULT_BACKUP"; payload?: { directory?: string } };
export type OpenInOsRequest = { type: "OPEN_IN_OS"; payload: { path: string } };
export type CreateProfileRequest = { type: "CREATE_PROFILE"; payload: { codexHome?: string; name: string } };
export type ActivateProfileRequest = {
  type: "ACTIVATE_PROFILE";
  payload: { codexHome?: string; profileId: string; backupCurrent: boolean; mergeFromCurrentCore?: boolean };
};
export type DeleteProfileRequest = { type: "DELETE_PROFILE"; payload: { codexHome?: string; profileId: string } };
export type StartExportRequest = {
  type: "START_EXPORT";
  payload: {
    codexHome?: string;
    outputDir: string;
    selectedProviders?: ClientProvider[];
    includeState: boolean;
    includeAuth: boolean;
    mode: MigrationMode;
  };
};
export type StartPreviewImportRequest = {
  type: "START_PREVIEW_IMPORT";
  payload: {
    codexHome?: string;
    backupZip: string;
    selectedProviders?: ClientProvider[];
    replaceState: boolean;
    importAuth: boolean;
    mode: MigrationMode;
  };
};
export type StartImportRequest = {
  type: "START_IMPORT";
  payload: {
    codexHome?: string;
    backupZip: string;
    selectedProviders?: ClientProvider[];
    replaceState: boolean;
    importAuth: boolean;
    mode: MigrationMode;
  };
};
export type StartImportToNewProfileRequest = {
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
};

export type KillProcessesRequest = {
  type: "KILL_PROCESSES";
  payload: {
    pids: number[];
    commands?: string[];
  };
};

export type RequestMessage =
  | InitRequest
  | RefreshProfilesRequest
  | RefreshProfileUsageRequest
  | RefreshAntigravityProfilesRequest
  | CreateAntigravityProfileRequest
  | ActivateAntigravityProfileRequest
  | DeleteAntigravityProfileRequest
  | RefreshAntigravityUsageRequest
  | SetAntigravityUsageAuthRequest
  | PickPathRequest
  | PickDefaultBackupRequest
  | OpenInOsRequest
  | CreateProfileRequest
  | ActivateProfileRequest
  | DeleteProfileRequest
  | StartExportRequest
  | StartPreviewImportRequest
  | StartImportRequest
  | StartImportToNewProfileRequest
  | KillProcessesRequest;

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

export type ExportResult = {
  codexHome: string;
  zipPath: string;
  selectedProviders: ClientProvider[];
  copiedItems: string[];
  mode: MigrationMode;
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

export type StateSnapshotEvent = {
  type: "STATE_SNAPSHOT";
  payload: {
    codexHome: string;
    platform: NodeJS.Platform;
    defaultOutputDir: string;
    profilesRoot: string;
    activeProfileId?: string;
    profiles: ProfileSummary[];
    availableProviders: Record<ClientProvider, boolean>;
    antigravityProfilesRoot: string;
    activeAntigravityProfileId?: string;
    antigravityProfiles: AntigravityProfileSummary[];
    antigravityUsage?: {
      mode: UsageAuthMode;
      summary?: ProfileUsageSummary;
      error?: string;
    };
  };
};

export type PathPickedEvent = {
  type: "PATH_PICKED";
  payload: {
    path?: string;
  };
};

export type TaskProgressEvent = {
  type: "TASK_PROGRESS";
  payload: {
    step: string;
    percent: number;
    message: string;
  };
};

export type TaskLogEvent = {
  type: "TASK_LOG";
  payload: {
    level: "info" | "warn" | "error";
    message: string;
  };
};

export type TaskResultEvent = {
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
};

export type TaskErrorEvent = {
  type: "TASK_ERROR";
  payload: AppError;
};

export type ResponseMessage = StateSnapshotEvent | PathPickedEvent | TaskProgressEvent | TaskLogEvent | TaskResultEvent | TaskErrorEvent;
