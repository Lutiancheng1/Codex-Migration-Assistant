import type { AppError } from "./errors";

export type MigrationMode = "core" | "enhanced";
export type ExportScope = "active" | "all" | "single";
export type ThreadCleanupScope = "active" | "all" | "single";
export type ThreadCleanupApplyMode = "killNow" | "restartLater";
export type ProfileSwitchMode = "plain" | "merge" | "overwrite";

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
  order: number;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  exists: boolean;
  hasAuth: boolean;
  hasState: boolean;
  usage?: ProfileUsageSummary;
  usageError?: string;
};

export type TokenPoolStatus = "neverChecked" | "available" | "exhausted" | "authInvalid" | "incomplete";

export type TokenPoolSettings = {
  autoSwitchEnabled: boolean;
  pollIntervalMs: number;
  autoRelaunchAfterSwitch: boolean;
};

export type TokenPoolEntry = {
  id: string;
  email?: string;
  accountId: string;
  type?: string;
  expired?: string;
  lastRefresh?: string;
  importedAt: string;
  updatedAt: string;
  planTypeHint?: string;
  usage?: ProfileUsageSummary;
  usageError?: string;
  status: TokenPoolStatus;
  current: boolean;
};

export type TokenPoolSnapshot = {
  activeEntryId?: string;
  settings: TokenPoolSettings;
  lastAutoSwitchAt?: string;
  lastAutoSwitchMessage?: string;
  entries: TokenPoolEntry[];
};

export type InitRequest = { type: "INIT" };
export type RefreshProfilesRequest = { type: "REFRESH_PROFILES"; payload?: { codexHome?: string } };
export type RefreshProfileUsageRequest = { type: "REFRESH_PROFILE_USAGE"; payload?: { codexHome?: string; profileId?: string } };
export type PickPathRequest = { type: "PICK_PATH"; payload: { kind: "folder" | "file"; title: string; filters?: Record<string, string[]> } };
export type PickDefaultBackupRequest = { type: "PICK_DEFAULT_BACKUP"; payload?: { directory?: string } };
export type OpenInOsRequest = { type: "OPEN_IN_OS"; payload: { path: string } };
export type CreateProfileRequest = { type: "CREATE_PROFILE"; payload: { codexHome?: string; name: string } };
export type ActivateProfileRequest = {
  type: "ACTIVATE_PROFILE";
  payload: {
    codexHome?: string;
    profileId: string;
    backupCurrent: boolean;
    mergeFromCurrentCore?: boolean;
    switchMode?: ProfileSwitchMode;
  };
};
export type DeleteProfileRequest = { type: "DELETE_PROFILE"; payload: { codexHome?: string; profileId: string } };
export type ReorderProfilesRequest = { type: "REORDER_PROFILES"; payload: { codexHome?: string; orderedIds: string[] } };
export type ImportTokenPoolFilesRequest = { type: "IMPORT_TOKEN_POOL_FILES"; payload: { mode: "single" | "multiple" } };
export type ImportTokenPoolDirectoryRequest = { type: "IMPORT_TOKEN_POOL_DIRECTORY" };
export type ImportProfileToTokenPoolRequest = {
  type: "IMPORT_PROFILE_TO_TOKEN_POOL";
  payload: { codexHome?: string; profileId: string };
};
export type SyncCurrentToPoolRunnerRequest = {
  type: "SYNC_CURRENT_TO_POOL_RUNNER";
  payload?: { codexHome?: string };
};
export type SwitchToPoolRunnerRequest = {
  type: "SWITCH_TO_POOL_RUNNER";
  payload?: { codexHome?: string; backupCurrent?: boolean };
};
export type RefreshTokenPoolEntryUsageRequest = {
  type: "REFRESH_TOKEN_POOL_ENTRY_USAGE";
  payload: { codexHome?: string; entryId: string };
};
export type ActivateTokenPoolEntryRequest = {
  type: "ACTIVATE_TOKEN_POOL_ENTRY";
  payload: { codexHome?: string; entryId: string };
};
export type DeleteTokenPoolEntryRequest = {
  type: "DELETE_TOKEN_POOL_ENTRY";
  payload: { entryId: string };
};
export type MoveTokenPoolEntryRequest = {
  type: "MOVE_TOKEN_POOL_ENTRY";
  payload: { entryId: string; direction: "up" | "down" };
};
export type ReorderTokenPoolEntriesRequest = {
  type: "REORDER_TOKEN_POOL_ENTRIES";
  payload: { orderedIds: string[] };
};
export type SetTokenPoolSettingsRequest = {
  type: "SET_TOKEN_POOL_SETTINGS";
  payload: { autoSwitchEnabled?: boolean; pollIntervalMs?: number; autoRelaunchAfterSwitch?: boolean };
};
export type StartExportRequest = {
  type: "START_EXPORT";
  payload: {
    codexHome?: string;
    outputDir: string;
    includeState: boolean;
    includeAuth: boolean;
    mode: MigrationMode;
    scope?: ExportScope;
    profileId?: string;
  };
};
export type StartPreviewImportRequest = {
  type: "START_PREVIEW_IMPORT";
  payload: {
    codexHome?: string;
    backupZip: string;
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
    replaceState: boolean;
    importAuth: boolean;
    mode: MigrationMode;
    profileName: string;
  };
};

export type PreviewThreadCleanupRequest = {
  type: "PREVIEW_THREAD_CLEANUP";
  payload: {
    codexHome?: string;
    threadIds: string[];
    scope: ThreadCleanupScope;
    profileId?: string;
  };
};

export type StartThreadCleanupRequest = {
  type: "START_THREAD_CLEANUP";
  payload: {
    codexHome?: string;
    threadIds: string[];
    scope: ThreadCleanupScope;
    profileId?: string;
    backupEnabled: boolean;
    applyMode: ThreadCleanupApplyMode;
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
  | PickPathRequest
  | PickDefaultBackupRequest
  | OpenInOsRequest
  | CreateProfileRequest
  | ActivateProfileRequest
  | DeleteProfileRequest
  | ReorderProfilesRequest
  | ImportTokenPoolFilesRequest
  | ImportTokenPoolDirectoryRequest
  | ImportProfileToTokenPoolRequest
  | SyncCurrentToPoolRunnerRequest
  | SwitchToPoolRunnerRequest
  | RefreshTokenPoolEntryUsageRequest
  | ActivateTokenPoolEntryRequest
  | DeleteTokenPoolEntryRequest
  | MoveTokenPoolEntryRequest
  | ReorderTokenPoolEntriesRequest
  | SetTokenPoolSettingsRequest
  | StartExportRequest
  | StartPreviewImportRequest
  | StartImportRequest
  | StartImportToNewProfileRequest
  | PreviewThreadCleanupRequest
  | StartThreadCleanupRequest
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
  copiedItems: string[];
  mode: MigrationMode;
  warnings: string[];
  scope?: ExportScope;
  profileId?: string;
  profileName?: string;
  exportedProfiles?: Array<{
    profileId: string;
    profileName: string;
    codexHome: string;
    zipPath: string;
    copiedItems: string[];
    warnings: string[];
  }>;
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

export type SwitchProfileResult = {
  codexHome: string;
  targetProfileId: string;
  backupCurrent: boolean;
  mergeFromCurrentCore: boolean;
  switchMode: ProfileSwitchMode;
  relaunchedClients: string[];
  messages: string[];
};

export type ThreadCleanupThreadMatch = {
  id: string;
  title?: string;
  archived: boolean;
  rolloutPath?: string;
  rolloutFiles: string[];
};

export type ThreadCleanupProfilePreview = {
  profileId: string;
  profileName: string;
  codexHome: string;
  matches: ThreadCleanupThreadMatch[];
  matchedFileCount: number;
  missingThreadIds: string[];
  potentialBusyProcesses: Array<{
    pid: number;
    command: string;
  }>;
};

export type ThreadCleanupPreviewResult = {
  codexHome: string;
  scope: ThreadCleanupScope;
  profileId?: string;
  threadIds: string[];
  profiles: ThreadCleanupProfilePreview[];
  notFoundThreadIds: string[];
  totalMatchedThreads: number;
  totalMatchedFiles: number;
};

export type ThreadCleanupProfileResult = {
  profileId: string;
  profileName: string;
  codexHome: string;
  deleted: {
    threads: number;
    logs: number;
    dynamicTools: number;
    files: number;
    globalStateTitles: number;
    globalStateOrder: number;
  };
  verification: {
    dbResidual: number;
    fileResidual: number;
    globalStateResidual: number;
    clean: boolean;
  };
  locked: boolean;
  busyProcesses: Array<{
    pid: number;
    command: string;
  }>;
  warnings: string[];
  errors: string[];
};

export type ThreadCleanupResult = {
  codexHome: string;
  scope: ThreadCleanupScope;
  profileId?: string;
  threadIds: string[];
  backupEnabled: boolean;
  backupPath?: string;
  applyMode: ThreadCleanupApplyMode;
  killTriggered: boolean;
  killedCount: number;
  relaunchedClients: string[];
  scheduledProfiles: string[];
  notFoundThreadIds: string[];
  profiles: ThreadCleanupProfileResult[];
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
    tokenPool: TokenPoolSnapshot;
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
    action: "export" | "previewImport" | "import" | "switchProfile" | "killProcesses" | "threadCleanupPreview" | "threadCleanup";
    data:
      | ExportResult
      | PreviewResult
      | ImportResult
      | SwitchProfileResult
      | ThreadCleanupPreviewResult
      | ThreadCleanupResult
      | { killedCount: number };
  };
};

export type TaskErrorEvent = {
  type: "TASK_ERROR";
  payload: AppError;
};

export type ResponseMessage = StateSnapshotEvent | PathPickedEvent | TaskProgressEvent | TaskLogEvent | TaskResultEvent | TaskErrorEvent;
