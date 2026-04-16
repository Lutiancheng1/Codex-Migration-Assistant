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

export type DesktopStateSnapshot = {
  codexHome: string;
  platform: string;
  profilesRoot: string;
  activeProfileId?: string;
  profiles: ProfileSummary[];
  tokenPool: TokenPoolSnapshot;
  messages?: string[];
};

export type PendingThreadCleanupTask = {
  schemaVersion: 1;
  createdAt: string;
  codexHome: string;
  threadIds: string[];
  scope: ThreadCleanupScope;
  profileId?: string;
  backupEnabled: boolean;
};

export type PendingProfileSwitchTask = {
  schemaVersion: 1;
  createdAt: string;
  codexHome: string;
  profileId: string;
  backupCurrent: boolean;
  switchMode: ProfileSwitchMode;
};

export type StorageLockInfo = {
  schemaVersion: 1;
  owner: "desktop-macos" | "vscode-extension";
  pid: number;
  createdAt: string;
};

export type DesktopTab = "overview" | "accounts" | "tokenPool" | "migration" | "cleanup" | "settings";
