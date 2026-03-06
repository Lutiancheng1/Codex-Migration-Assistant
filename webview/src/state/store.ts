import type {
  ExportResult,
  ImportResult,
  PreviewResult,
  ProfileSummary,
  SwitchProfileResult,
  ThreadCleanupPreviewResult,
  ThreadCleanupResult,
  ThreadCleanupScope
} from "../api/types";

type ResultData = ExportResult | PreviewResult | ImportResult | SwitchProfileResult | ThreadCleanupPreviewResult | ThreadCleanupResult;

export type UiState = {
  codexHome: string;
  platform: string;
  profilesRoot: string;
  profiles: ProfileSummary[];
  activeProfileId?: string;
  backupBeforeSwitch: boolean;
  newProfileName: string;
  outputDir: string;
  exportScope: "active" | "all";
  threadCleanupInput: string;
  threadCleanupScope: ThreadCleanupScope;
  threadCleanupProfileId: string;
  threadCleanupBackupEnabled: boolean;
  threadCleanupPreview?: ThreadCleanupPreviewResult;
  threadCleanupResult?: ThreadCleanupResult;
  backupZip: string;
  importProfileName: string;
  includeState: boolean;
  includeAuth: boolean;
  replaceState: boolean;
  importAuth: boolean;
  progressPercent: number;
  progressMessage: string;
  logs: string[];
  lastResult?: ResultData;
  lastError?: string;
};

export const initialState: UiState = {
  codexHome: "",
  platform: "",
  profilesRoot: "",
  profiles: [],
  activeProfileId: undefined,
  backupBeforeSwitch: false,
  newProfileName: "",
  outputDir: "",
  exportScope: "active",
  threadCleanupInput: "",
  threadCleanupScope: "all",
  threadCleanupProfileId: "",
  threadCleanupBackupEnabled: true,
  threadCleanupPreview: undefined,
  threadCleanupResult: undefined,
  backupZip: "",
  importProfileName: "",
  includeState: false,
  includeAuth: false,
  replaceState: false,
  importAuth: false,
  progressPercent: 0,
  progressMessage: "待命",
  logs: []
};
