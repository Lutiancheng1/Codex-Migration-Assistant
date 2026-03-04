import type { ExportResult, ImportResult, PreviewResult, ProfileSummary } from "../api/types";

type ResultData = ExportResult | PreviewResult | ImportResult;

export type UiState = {
  codexHome: string;
  platform: string;
  profilesRoot: string;
  profiles: ProfileSummary[];
  activeProfileId?: string;
  backupBeforeSwitch: boolean;
  newProfileName: string;
  mode: "core" | "enhanced";
  outputDir: string;
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
  backupBeforeSwitch: true,
  newProfileName: "",
  mode: "core",
  outputDir: "",
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
