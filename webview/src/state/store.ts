import type { ClientProvider, ExportResult, ImportResult, PreviewResult, ProfileSummary, SwitchProfileResult } from "../api/types";

type ResultData = ExportResult | PreviewResult | ImportResult | SwitchProfileResult;

export type UiState = {
  codexHome: string;
  platform: string;
  profilesRoot: string;
  profiles: ProfileSummary[];
  activeProfileId?: string;
  backupBeforeSwitch: boolean;
  newProfileName: string;
  outputDir: string;
  exportProviders: ClientProvider[];
  backupZip: string;
  importProviders: ClientProvider[];
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
  outputDir: "",
  exportProviders: ["codex", "antigravity"],
  backupZip: "",
  importProviders: ["codex", "antigravity"],
  importProfileName: "",
  includeState: false,
  includeAuth: false,
  replaceState: false,
  importAuth: false,
  progressPercent: 0,
  progressMessage: "待命",
  logs: []
};
