import type { AppError } from "./errors";

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

export type InitRequest = { type: "INIT" };
export type RefreshProfilesRequest = { type: "REFRESH_PROFILES"; payload?: { codexHome?: string } };
export type RefreshProfileUsageRequest = { type: "REFRESH_PROFILE_USAGE"; payload?: { codexHome?: string; profileId?: string } };
export type PickPathRequest = { type: "PICK_PATH"; payload: { kind: "folder" | "file"; title: string; filters?: Record<string, string[]> } };
export type PickDefaultBackupRequest = { type: "PICK_DEFAULT_BACKUP"; payload?: { directory?: string } };
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

export type KillProcessesRequest = {
  type: "KILL_PROCESSES";
  payload: {
    pids: number[];
  };
};

export type RequestMessage =
  | InitRequest
  | RefreshProfilesRequest
  | RefreshProfileUsageRequest
  | PickPathRequest
  | PickDefaultBackupRequest
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

export type StateSnapshotEvent = {
  type: "STATE_SNAPSHOT";
  payload: {
    codexHome: string;
    platform: NodeJS.Platform;
    defaultOutputDir: string;
    profilesRoot: string;
    activeProfileId?: string;
    profiles: ProfileSummary[];
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
    action: "export" | "previewImport" | "import" | "killProcesses";
    data: ExportResult | PreviewResult | ImportResult | { killedCount: number };
  };
};

export type TaskErrorEvent = {
  type: "TASK_ERROR";
  payload: AppError;
};

export type ResponseMessage = StateSnapshotEvent | PathPickedEvent | TaskProgressEvent | TaskLogEvent | TaskResultEvent | TaskErrorEvent;
