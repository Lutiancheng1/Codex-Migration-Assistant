import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  DesktopChrome,
  AccountsManager,
  ExportWizard,
  Home,
  ImportWizard,
  PreviewResult,
  ProgressPanel,
  SummaryCard
} from "@codex-migration/shared-ui";
import type {
  DesktopTab,
  ExportResult,
  ImportResult,
  PreviewResult as PreviewResultType,
  ProfileSummary,
  SwitchProfileResult,
  ThreadCleanupApplyMode,
  ThreadCleanupPreviewResult,
  ThreadCleanupResult,
  ThreadCleanupScope,
  TokenPoolSnapshot
} from "@codex-migration/shared-contracts";
import { runDesktopCommand } from "./lib/desktopClient";
import "./desktop.css";

type ResultData = ExportResult | ImportResult | PreviewResultType | SwitchProfileResult | ThreadCleanupPreviewResult | ThreadCleanupResult;

type DesktopStateSnapshot = {
  codexHome: string;
  platform: string;
  defaultOutputDir: string;
  profilesRoot: string;
  activeProfileId?: string;
  profiles: ProfileSummary[];
  tokenPool: TokenPoolSnapshot;
};

type UiState = {
  codexHome: string;
  platform: string;
  defaultOutputDir: string;
  profilesRoot: string;
  profiles: ProfileSummary[];
  activeProfileId?: string;
  tokenPool: TokenPoolSnapshot;
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

const initialState: UiState = {
  codexHome: "",
  platform: "",
  defaultOutputDir: "",
  profilesRoot: "",
  profiles: [],
  activeProfileId: undefined,
  tokenPool: {
    activeEntryId: undefined,
    settings: {
      autoSwitchEnabled: false,
      pollIntervalMs: 5 * 60 * 1000,
      autoRelaunchAfterSwitch: false
    },
    entries: []
  },
  backupBeforeSwitch: false,
  newProfileName: "",
  outputDir: "",
  exportScope: "active",
  threadCleanupInput: "",
  threadCleanupScope: "all",
  threadCleanupProfileId: "",
  threadCleanupBackupEnabled: false,
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

function parseThreadIds(input: string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const part of input.split(/[\s,]+/g).map((item) => item.trim())) {
    if (!part || seen.has(part)) {
      continue;
    }
    seen.add(part);
    output.push(part);
  }
  return output;
}

function applySnapshot(current: UiState, snapshot?: DesktopStateSnapshot): UiState {
  if (!snapshot) {
    return current;
  }
  return {
    ...current,
    codexHome: snapshot.codexHome,
    platform: snapshot.platform,
    defaultOutputDir: snapshot.defaultOutputDir,
    profilesRoot: snapshot.profilesRoot,
    activeProfileId: snapshot.activeProfileId,
    profiles: snapshot.profiles,
    tokenPool: snapshot.tokenPool,
    outputDir: current.outputDir.trim().length > 0 ? current.outputDir : snapshot.defaultOutputDir,
    threadCleanupProfileId:
      current.threadCleanupProfileId.trim().length > 0
        ? current.threadCleanupProfileId
        : (snapshot.activeProfileId ?? snapshot.profiles[0]?.id ?? "")
  };
}

function formatLocalTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
}

function statValue(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function isThreadCleanupPreviewResult(data: ResultData | undefined): data is ThreadCleanupPreviewResult {
  return !!data && "totalMatchedThreads" in data && "profiles" in data && !("backupEnabled" in data);
}

function isThreadCleanupResult(data: ResultData | undefined): data is ThreadCleanupResult {
  return !!data && "backupEnabled" in data && "profiles" in data;
}

function isSwitchResult(data: ResultData | undefined): data is SwitchProfileResult {
  return !!data && "targetProfileId" in data;
}

function isExportResult(data: ResultData | undefined): data is ExportResult {
  return !!data && "zipPath" in data;
}

function isImportResult(data: ResultData | undefined): data is ImportResult {
  return !!data && "reportPath" in data;
}

function DesktopResultCard(props: { data?: ResultData; error?: string }): JSX.Element {
  const data = props.data;
  return (
    <SummaryCard title="最近结果">
      <div className="desktop-result-card">
        {props.error ? <p className="error">{props.error}</p> : null}
        {!data ? <p>暂无最近执行结果。</p> : null}
        {isExportResult(data) ? (
          <>
            <p><strong>导出 ZIP：</strong> {data.zipPath}</p>
            <p><strong>导出模式：</strong> {data.mode}</p>
            {data.exportedProfiles && data.exportedProfiles.length > 1 ? <p><strong>批量导出：</strong> {data.exportedProfiles.length} 个账号</p> : null}
            {data.warnings.length > 0 ? <p className="warning">{data.warnings.slice(0, 3).join("；")}</p> : null}
          </>
        ) : null}
        {isImportResult(data) ? (
          <>
            <p><strong>导入报告：</strong> {data.reportPath}</p>
            <p><strong>导入模式：</strong> {data.mode}</p>
            {data.warnings.length > 0 ? <p className="warning">{data.warnings.slice(0, 3).join("；")}</p> : null}
          </>
        ) : null}
        {isSwitchResult(data) ? (
          <>
            <p><strong>切换目标：</strong> {data.targetProfileId}</p>
            <p><strong>切换模式：</strong> {data.switchMode}</p>
            <p><strong>恢复启动：</strong> {data.relaunchedClients.length > 0 ? data.relaunchedClients.join(", ") : "无"}</p>
          </>
        ) : null}
        {isThreadCleanupPreviewResult(data) ? (
          <>
            <p><strong>预览命中线程：</strong> {data.totalMatchedThreads}</p>
            <p><strong>预览命中文件：</strong> {data.totalMatchedFiles}</p>
            <p><strong>未命中会话：</strong> {data.notFoundThreadIds.length}</p>
          </>
        ) : null}
        {isThreadCleanupResult(data) ? (
          <>
            <p><strong>删除线程：</strong> {data.profiles.reduce((sum, item) => sum + item.deleted.threads, 0)}</p>
            <p><strong>删除文件：</strong> {data.profiles.reduce((sum, item) => sum + item.deleted.files, 0)}</p>
            <p><strong>恢复启动：</strong> {data.relaunchedClients.length > 0 ? data.relaunchedClients.join(", ") : "无"}</p>
            {data.scheduledProfiles.length > 0 ? <p className="warning">待重启继续执行：{data.scheduledProfiles.join("、")}</p> : null}
          </>
        ) : null}
      </div>
    </SummaryCard>
  );
}

function OverviewStat(props: { label: string; value: string; meta: string }): JSX.Element {
  return (
    <article className="desktop-stat-card">
      <span className="desktop-stat-label">{props.label}</span>
      <strong className="desktop-stat-value">{props.value}</strong>
      <span className="desktop-stat-meta">{props.meta}</span>
    </article>
  );
}

export default function App(): JSX.Element {
  const [tab, setTab] = useState<DesktopTab>("overview");
  const [state, setState] = useState<UiState>(initialState);

  async function refresh(codexHome?: string): Promise<void> {
    try {
      const response = await runDesktopCommand<DesktopStateSnapshot>({
        command: "refreshState",
        payload: { codexHome: codexHome ?? state.codexHome ?? undefined }
      });
      setState((current) => ({
        ...applySnapshot(current, response.snapshot),
        logs: [
          ...current.logs,
          ...response.messages.map((item) => `[info] ${item}`),
          ...response.warnings.map((item) => `[warn] ${item}`),
          ...response.errors.map((item) => `[error] ${item}`)
        ]
      }));
    } catch (error) {
      setState((current) => ({ ...current, lastError: (error as Error).message }));
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await runDesktopCommand<DesktopStateSnapshot>({ command: "initAppState" });
        setState((current) => ({
          ...applySnapshot(current, response.snapshot),
          logs: [
            ...current.logs,
            ...response.messages.map((item) => `[info] ${item}`),
            ...response.warnings.map((item) => `[warn] ${item}`),
            ...response.errors.map((item) => `[error] ${item}`)
          ]
        }));
      } catch (error) {
        setState((current) => ({ ...current, lastError: (error as Error).message }));
      }
    })();
  }, []);

  async function runCommand<TResult = unknown>(
    request: unknown,
    options?: {
      progressMessage?: string;
      progressPercent?: number;
      onSuccess?: (data: TResult | undefined) => Partial<UiState>;
    }
  ): Promise<void> {
    setState((current) => ({
      ...current,
      progressPercent: options?.progressPercent ?? 30,
      progressMessage: options?.progressMessage ?? "执行中",
      lastError: undefined
    }));

    try {
      const response = await runDesktopCommand<DesktopStateSnapshot, TResult>(request);
      setState((current) => {
        const next = applySnapshot(current, response.snapshot);
        const extra = options?.onSuccess?.(response.data) ?? {};
        return {
          ...next,
          ...extra,
          progressPercent: 100,
          progressMessage: "完成",
          logs: [
            ...next.logs,
            ...response.messages.map((item) => `[info] ${item}`),
            ...response.warnings.map((item) => `[warn] ${item}`),
            ...response.errors.map((item) => `[error] ${item}`)
          ]
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        lastError: (error as Error).message,
        progressPercent: 100,
        progressMessage: "失败"
      }));
    }
  }

  function onChange(field: string, value: string | boolean): void {
    setState((current) => ({ ...current, [field]: value } as UiState));
  }

  async function pickDirectory(target: "outputDir" | "tokenDir"): Promise<string | undefined> {
    const result = await open({
      directory: true,
      multiple: false,
      defaultPath: target === "outputDir" ? state.outputDir || state.defaultOutputDir : undefined
    });
    return typeof result === "string" ? result : undefined;
  }

  async function pickZip(): Promise<string | undefined> {
    const result = await open({
      multiple: false,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
      defaultPath: state.defaultOutputDir || undefined
    });
    return typeof result === "string" ? result : undefined;
  }

  const logsView = useMemo(
    () => (
      <SummaryCard title="运行日志">
        <div className="desktop-pane-grid">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "12px", lineHeight: 1.6 }}>
            {state.logs.slice(-80).join("\n") || "暂无日志"}
          </pre>
        </div>
      </SummaryCard>
    ),
    [state.logs]
  );

  const activeProfile = state.profiles.find((item) => item.id === state.activeProfileId);
  const availableTokenCount = state.tokenPool.entries.filter((item) => item.status === "available").length;
  const pendingCleanupProfiles = state.threadCleanupResult?.scheduledProfiles.length ?? 0;
  const latestAutoSwitch = state.tokenPool.lastAutoSwitchAt ? formatLocalTime(state.tokenPool.lastAutoSwitchAt) : "暂无";

  return (
    <DesktopChrome
      title="Codex 迁移助手"
      subtitle="macOS 独立版 · 顶部横向导航 · 与扩展共享 ~/.codex 与 ~/.codex-profiles"
      activeTab={tab}
      onSelectTab={setTab}
      status={
        <>
          <span className="desktop-toolbar-pill">{state.activeProfileId ? `当前槽位 ${state.activeProfileId}` : "未识别槽位"}</span>
          <span className="desktop-toolbar-pill">{state.tokenPool.entries.length} 个池账号</span>
        </>
      }
    >
      {tab === "overview" ? (
        <div className="desktop-pane-grid desktop-overview-grid">
          <section className="desktop-hero-card">
            <div className="desktop-hero-copy">
              <span className="desktop-section-eyebrow">Independent App</span>
              <h2>Codex 数据、账号槽位、账号池和对话清理已经进入桌面端。</h2>
              <p>当前桌面版直接复用现有 engine，并与扩展共用同一份 `~/.codex` / `~/.codex-profiles` 数据。默认目标不是做另一个壳，而是逐步取代扩展的日常操作入口。</p>
            </div>
            <div className="desktop-hero-actions">
              <button className="primary" onClick={() => setTab("accounts")}>管理账号</button>
              <button onClick={() => setTab("tokenPool")}>打开账号池</button>
              <button onClick={() => setTab("migration")}>导入 / 导出</button>
            </div>
          </section>

          <div className="desktop-stat-grid">
            <OverviewStat label="账号槽位" value={statValue(state.profiles.length)} meta={activeProfile ? `当前 ${activeProfile.name}` : "尚未识别当前槽位"} />
            <OverviewStat label="池内账号" value={statValue(state.tokenPool.entries.length)} meta={`${availableTokenCount} 个状态可切换`} />
            <OverviewStat label="待补做清理" value={statValue(pendingCleanupProfiles)} meta={pendingCleanupProfiles > 0 ? "存在重启后继续执行任务" : "当前没有挂起清理"} />
            <OverviewStat label="最近自动切换" value={latestAutoSwitch} meta={state.tokenPool.lastAutoSwitchMessage ?? "暂无自动切换记录"} />
          </div>

          <div className="desktop-overview-panels">
            <Home platform={state.platform} codexHome={state.codexHome} />
            <ProgressPanel percent={state.progressPercent} message={state.progressMessage} />
          </div>

          <DesktopResultCard data={state.lastResult} error={state.lastError} />
          {logsView}
        </div>
      ) : null}

      {tab === "accounts" ? (
        <AccountsManager
          sectionMode="accounts"
          profilesRoot={state.profilesRoot}
          profiles={state.profiles}
          activeProfileId={state.activeProfileId}
          codexHome={state.codexHome}
          tokenPool={state.tokenPool}
          backupBeforeSwitch={state.backupBeforeSwitch}
          newProfileName={state.newProfileName}
          threadCleanupInput={state.threadCleanupInput}
          threadCleanupScope={state.threadCleanupScope}
          threadCleanupProfileId={state.threadCleanupProfileId}
          threadCleanupBackupEnabled={state.threadCleanupBackupEnabled}
          threadCleanupPreview={state.threadCleanupPreview}
          threadCleanupResult={state.threadCleanupResult}
          onChange={onChange}
          onRefresh={() => void refresh()}
          onRefreshUsage={(profileId) =>
            void runCommand(
              { command: "refreshProfileUsage", payload: { codexHome: state.codexHome, profileId } },
              { progressMessage: "刷新账号用量" }
            )}
          onImportTokenPoolSingle={() => {}}
          onImportTokenPoolMultiple={() => {}}
          onImportTokenPoolDirectory={() => {}}
          onImportProfileToTokenPool={(profileId) =>
            void runCommand({ command: "importProfileToTokenPool", payload: { codexHome: state.codexHome, profileId } }, { progressMessage: "导入账号到池" })}
          onSyncCurrentToPoolRunner={() =>
            void runCommand({ command: "syncCurrentToPoolRunner", payload: { codexHome: state.codexHome } }, { progressMessage: "同步到 pool-runner" })}
          onSwitchToPoolRunner={() =>
            void runCommand(
              { command: "switchToPoolRunner", payload: { codexHome: state.codexHome, backupCurrent: state.backupBeforeSwitch } },
              { progressMessage: "切换到 pool-runner" }
            )}
          onRefreshTokenPoolEntry={() => {}}
          onActivateTokenPoolEntry={() => {}}
          onDeleteTokenPoolEntry={() => {}}
          onMoveTokenPoolEntry={() => {}}
          onReorderTokenPoolEntries={() => {}}
          onUpdateTokenPoolSettings={() => {}}
          onExportProfile={(profileId) =>
            void runCommand<ExportResult>(
              {
                command: "startExport",
                payload: {
                  codexHome: state.codexHome,
                  outputDir: state.outputDir || state.defaultOutputDir,
                  includeState: state.includeState,
                  includeAuth: state.includeAuth,
                  mode: "enhanced",
                  scope: "single",
                  profileId
                }
              },
              { progressMessage: "导出账号", onSuccess: (data) => ({ lastResult: data as ResultData }) }
            )}
          onCreate={() => void runCommand({ command: "createProfile", payload: { codexHome: state.codexHome, name: state.newProfileName } }, { progressMessage: "新建账号" })}
          onActivate={(profileId) =>
            void runCommand<SwitchProfileResult>(
              { command: "activateProfile", payload: { codexHome: state.codexHome, profileId, backupCurrent: state.backupBeforeSwitch, switchMode: "plain" } },
              { progressMessage: "切换账号", onSuccess: (data) => ({ lastResult: data as ResultData }) }
            )}
          onActivateAndMerge={(profileId) =>
            void runCommand<SwitchProfileResult>(
              { command: "activateProfile", payload: { codexHome: state.codexHome, profileId, backupCurrent: state.backupBeforeSwitch, switchMode: "merge" } },
              { progressMessage: "切换并合并", onSuccess: (data) => ({ lastResult: data as ResultData }) }
            )}
          onActivateAndOverwrite={(profileId) =>
            void runCommand<SwitchProfileResult>(
              { command: "activateProfile", payload: { codexHome: state.codexHome, profileId, backupCurrent: state.backupBeforeSwitch, switchMode: "overwrite" } },
              { progressMessage: "切换并覆盖", onSuccess: (data) => ({ lastResult: data as ResultData }) }
            )}
          onDelete={(profileId) => void runCommand({ command: "deleteProfile", payload: { codexHome: state.codexHome, profileId } }, { progressMessage: "删除账号" })}
          onReorderProfiles={(orderedIds) =>
            void runCommand({ command: "reorderProfiles", payload: { codexHome: state.codexHome, orderedIds } }, { progressMessage: "保存账号顺序" })}
          onPreviewThreadCleanup={() => {}}
          onStartThreadCleanup={() => {}}
        />
      ) : null}

      {tab === "tokenPool" ? (
        <AccountsManager
          sectionMode="tokenPool"
          profilesRoot={state.profilesRoot}
          profiles={state.profiles}
          activeProfileId={state.activeProfileId}
          codexHome={state.codexHome}
          tokenPool={state.tokenPool}
          backupBeforeSwitch={state.backupBeforeSwitch}
          newProfileName={state.newProfileName}
          threadCleanupInput={state.threadCleanupInput}
          threadCleanupScope={state.threadCleanupScope}
          threadCleanupProfileId={state.threadCleanupProfileId}
          threadCleanupBackupEnabled={state.threadCleanupBackupEnabled}
          threadCleanupPreview={state.threadCleanupPreview}
          threadCleanupResult={state.threadCleanupResult}
          onChange={onChange}
          onRefresh={() => void refresh()}
          onRefreshUsage={() => {}}
          onImportTokenPoolSingle={() =>
            void (async () => {
              const result = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
              if (typeof result === "string") {
                await runCommand({ command: "importTokenPoolFiles", payload: { codexHome: state.codexHome, filePaths: [result] } }, { progressMessage: "导入单个 token" });
              }
            })()}
          onImportTokenPoolMultiple={() =>
            void (async () => {
              const result = await open({ multiple: true, filters: [{ name: "JSON", extensions: ["json"] }] });
              if (Array.isArray(result) && result.length > 0) {
                await runCommand({ command: "importTokenPoolFiles", payload: { codexHome: state.codexHome, filePaths: result as string[] } }, { progressMessage: "导入多个 token" });
              }
            })()}
          onImportTokenPoolDirectory={() =>
            void (async () => {
              const directoryPath = await pickDirectory("tokenDir");
              if (directoryPath) {
                await runCommand({ command: "importTokenPoolDirectory", payload: { codexHome: state.codexHome, directoryPath } }, { progressMessage: "导入 token 目录" });
              }
            })()}
          onImportProfileToTokenPool={(profileId) =>
            void runCommand({ command: "importProfileToTokenPool", payload: { codexHome: state.codexHome, profileId } }, { progressMessage: "导入当前账号到池" })}
          onSyncCurrentToPoolRunner={() =>
            void runCommand({ command: "syncCurrentToPoolRunner", payload: { codexHome: state.codexHome } }, { progressMessage: "同步 pool-runner" })}
          onSwitchToPoolRunner={() =>
            void runCommand({ command: "switchToPoolRunner", payload: { codexHome: state.codexHome, backupCurrent: state.backupBeforeSwitch } }, { progressMessage: "切换到 pool-runner" })}
          onRefreshTokenPoolEntry={(entryId) =>
            void runCommand({ command: "refreshTokenPoolEntryUsage", payload: { codexHome: state.codexHome, entryId } }, { progressMessage: "刷新池账号额度" })}
          onActivateTokenPoolEntry={(entryId) =>
            void runCommand({ command: "activateTokenPoolEntry", payload: { codexHome: state.codexHome, entryId } }, { progressMessage: "切换池账号" })}
          onDeleteTokenPoolEntry={(entryId) =>
            void runCommand({ command: "deleteTokenPoolEntry", payload: { codexHome: state.codexHome, entryId } }, { progressMessage: "删除池账号" })}
          onMoveTokenPoolEntry={(entryId, direction) => {
            const orderedIds = state.tokenPool.entries.map((item) => item.id);
            const currentIndex = orderedIds.indexOf(entryId);
            const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
            if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) {
              return;
            }
            const nextIds = [...orderedIds];
            const [moved] = nextIds.splice(currentIndex, 1);
            nextIds.splice(targetIndex, 0, moved);
            void runCommand({ command: "reorderTokenPoolEntries", payload: { codexHome: state.codexHome, orderedIds: nextIds } }, { progressMessage: "更新池账号顺序" });
          }}
          onReorderTokenPoolEntries={(orderedIds) =>
            void runCommand({ command: "reorderTokenPoolEntries", payload: { codexHome: state.codexHome, orderedIds } }, { progressMessage: "保存池顺序" })}
          onUpdateTokenPoolSettings={(next) =>
            void runCommand({ command: "setTokenPoolSettings", payload: { codexHome: state.codexHome, ...next } }, { progressMessage: "保存账号池设置" })}
          onExportProfile={() => {}}
          onCreate={() => {}}
          onActivate={() => {}}
          onActivateAndMerge={() => {}}
          onActivateAndOverwrite={() => {}}
          onDelete={() => {}}
          onReorderProfiles={() => {}}
          onPreviewThreadCleanup={() => {}}
          onStartThreadCleanup={() => {}}
        />
      ) : null}

      {tab === "migration" ? (
        <div className="desktop-pane-grid desktop-migration-grid">
          <ExportWizard
            codexHome={state.codexHome}
            outputDir={state.outputDir}
            exportScope={state.exportScope}
            includeState={state.includeState}
            includeAuth={state.includeAuth}
            onChange={onChange}
            onPickOutputDir={() =>
              void (async () => {
                const outputDir = await pickDirectory("outputDir");
                if (outputDir) {
                  onChange("outputDir", outputDir);
                }
              })()}
            onOpenOutputDir={() => void openPath(state.outputDir || state.defaultOutputDir)}
            onRun={() =>
              void runCommand<ExportResult>(
                {
                  command: "startExport",
                  payload: {
                    codexHome: state.codexHome,
                    outputDir: state.outputDir || state.defaultOutputDir,
                    includeState: state.includeState,
                    includeAuth: state.includeAuth,
                    mode: "enhanced",
                    scope: state.exportScope
                  }
                },
                { progressMessage: "执行导出", onSuccess: (data) => ({ lastResult: data as ResultData }) }
              )}
          />

          <ImportWizard
            codexHome={state.codexHome}
            backupZip={state.backupZip}
            importProfileName={state.importProfileName}
            replaceState={state.replaceState}
            importAuth={state.importAuth}
            onChange={onChange}
            onPickZip={() =>
              void (async () => {
                const zipPath = await pickZip();
                if (zipPath) {
                  onChange("backupZip", zipPath);
                }
              })()}
            onPickZipFromDefault={() =>
              void (async () => {
                const zipPath = await pickZip();
                if (zipPath) {
                  onChange("backupZip", zipPath);
                }
              })()}
            onPreview={() =>
              void runCommand<PreviewResultType>(
                {
                  command: "previewImport",
                  payload: {
                    codexHome: state.codexHome,
                    backupZip: state.backupZip,
                    replaceState: state.replaceState,
                    importAuth: state.importAuth,
                    mode: "enhanced"
                  }
                },
                { progressMessage: "预演导入", onSuccess: (data) => ({ lastResult: data as ResultData }) }
              )}
            onRunImport={() =>
              void runCommand<ImportResult>(
                {
                  command: "startImport",
                  payload: {
                    codexHome: state.codexHome,
                    backupZip: state.backupZip,
                    replaceState: state.replaceState,
                    importAuth: state.importAuth,
                    mode: "enhanced"
                  }
                },
                { progressMessage: "执行导入", onSuccess: (data) => ({ lastResult: data as ResultData }) }
              )}
            onRunImportToNewProfile={() =>
              void runCommand<ImportResult>(
                {
                  command: "startImportToNewProfile",
                  payload: {
                    codexHome: state.codexHome,
                    backupZip: state.backupZip,
                    replaceState: state.replaceState,
                    importAuth: state.importAuth,
                    mode: "enhanced",
                    profileName: state.importProfileName
                  }
                },
                { progressMessage: "导入到新账号", onSuccess: (data) => ({ lastResult: data as ResultData }) }
              )}
          />

          <PreviewResult data={state.lastResult as PreviewResultType | undefined} />
          <DesktopResultCard data={state.lastResult} error={state.lastError} />
        </div>
      ) : null}

      {tab === "cleanup" ? (
        <AccountsManager
          sectionMode="cleanup"
          profilesRoot={state.profilesRoot}
          profiles={state.profiles}
          activeProfileId={state.activeProfileId}
          codexHome={state.codexHome}
          tokenPool={state.tokenPool}
          backupBeforeSwitch={state.backupBeforeSwitch}
          newProfileName={state.newProfileName}
          threadCleanupInput={state.threadCleanupInput}
          threadCleanupScope={state.threadCleanupScope}
          threadCleanupProfileId={state.threadCleanupProfileId}
          threadCleanupBackupEnabled={state.threadCleanupBackupEnabled}
          threadCleanupPreview={state.threadCleanupPreview}
          threadCleanupResult={state.threadCleanupResult}
          onChange={onChange}
          onRefresh={() => void refresh()}
          onRefreshUsage={() => {}}
          onImportTokenPoolSingle={() => {}}
          onImportTokenPoolMultiple={() => {}}
          onImportTokenPoolDirectory={() => {}}
          onImportProfileToTokenPool={() => {}}
          onSyncCurrentToPoolRunner={() => {}}
          onSwitchToPoolRunner={() => {}}
          onRefreshTokenPoolEntry={() => {}}
          onActivateTokenPoolEntry={() => {}}
          onDeleteTokenPoolEntry={() => {}}
          onMoveTokenPoolEntry={() => {}}
          onReorderTokenPoolEntries={() => {}}
          onUpdateTokenPoolSettings={() => {}}
          onExportProfile={() => {}}
          onCreate={() => {}}
          onActivate={() => {}}
          onActivateAndMerge={() => {}}
          onActivateAndOverwrite={() => {}}
          onDelete={() => {}}
          onReorderProfiles={() => {}}
          onPreviewThreadCleanup={() =>
            void runCommand<ThreadCleanupPreviewResult>(
              {
                command: "previewThreadCleanup",
                payload: {
                  codexHome: state.codexHome,
                  threadIds: parseThreadIds(state.threadCleanupInput),
                  scope: state.threadCleanupScope,
                  profileId: state.threadCleanupScope === "single" ? state.threadCleanupProfileId : undefined
                }
              },
              { progressMessage: "预览清理范围", onSuccess: (data) => ({ threadCleanupPreview: data, lastResult: data as ResultData }) }
            )}
          onStartThreadCleanup={(applyMode: ThreadCleanupApplyMode) =>
            void runCommand<ThreadCleanupResult>(
              {
                command: "startThreadCleanup",
                payload: {
                  codexHome: state.codexHome,
                  threadIds: parseThreadIds(state.threadCleanupInput),
                  scope: state.threadCleanupScope,
                  profileId: state.threadCleanupScope === "single" ? state.threadCleanupProfileId : undefined,
                  backupEnabled: state.threadCleanupBackupEnabled,
                  applyMode
                }
              },
              { progressMessage: "执行对话清理", onSuccess: (data) => ({ threadCleanupResult: data, lastResult: data as ResultData }) }
            )}
        />
      ) : null}

      {tab === "settings" ? (
        <div className="desktop-pane-grid desktop-settings-grid">
          <SummaryCard title="共享目录">
            <p><strong>Codex 目录：</strong> {state.codexHome || "-"}</p>
            <p><strong>Profiles 根目录：</strong> {state.profilesRoot || "-"}</p>
            <p><strong>默认导出目录：</strong> {state.defaultOutputDir || "-"}</p>
            <div className="desktop-inline-actions">
              <button onClick={() => void openPath(state.codexHome)}>打开 Codex 目录</button>
              <button onClick={() => void openPath(state.profilesRoot)}>打开 Profiles 根目录</button>
            </div>
          </SummaryCard>
          <SummaryCard title="桌面端状态">
            <p>窗口可自由缩放，顶部 Tab 导航已启用。</p>
            <p>后端通过 Tauri command 调内置 sidecar runner，复用现有 engine 与共享写锁。</p>
            <p>当前桌面版已不再依赖系统全局 `node` 才能执行核心能力。</p>
            <div className="desktop-inline-actions">
              <button onClick={() => void refresh(state.codexHome)}>刷新状态</button>
              <button onClick={() => void setTab("overview")}>返回总览</button>
            </div>
          </SummaryCard>
          <SummaryCard title="桌面版打包产物">
            <p><strong>App：</strong> `apps/desktop-macos/src-tauri/target/release/bundle/macos/Codex Migration Assistant.app`</p>
            <p><strong>DMG：</strong> `apps/desktop-macos/src-tauri/target/release/bundle/dmg/Codex Migration Assistant_1.0.2_aarch64.dmg`</p>
            <div className="desktop-inline-actions">
              <button onClick={() => void openPath("/Users/tiancheng/lifeSpaces/codex-migration-extension/apps/desktop-macos/src-tauri/target/release/bundle/macos")}>
                打开 .app 目录
              </button>
              <button onClick={() => void openPath("/Users/tiancheng/lifeSpaces/codex-migration-extension/apps/desktop-macos/src-tauri/target/release/bundle/dmg")}>
                打开 .dmg 目录
              </button>
            </div>
          </SummaryCard>
          {logsView}
        </div>
      ) : null}
    </DesktopChrome>
  );
}
