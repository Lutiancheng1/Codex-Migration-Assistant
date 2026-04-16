import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { AccountsManager, ExportWizard, ImportWizard, PreviewResult } from "@codex-migration/shared-ui";
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
  TokenPoolEntry,
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

const TAB_META: Array<{ id: DesktopTab; label: string; detail: string }> = [
  { id: "overview", label: "总览", detail: "工作台" },
  { id: "accounts", label: "账号", detail: "槽位切换" },
  { id: "tokenPool", label: "账号池", detail: "pool-runner" },
  { id: "migration", label: "迁移", detail: "导入导出" },
  { id: "cleanup", label: "对话清理", detail: "会话维护" },
  { id: "settings", label: "设置", detail: "目录与状态" }
];

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

function toneFromCount(value: number): "neutral" | "good" | "caution" | "danger" {
  if (value <= 0) {
    return "good";
  }
  if (value === 1) {
    return "caution";
  }
  return "danger";
}

function statusForEntry(entry: TokenPoolEntry): string {
  switch (entry.status) {
    case "available":
      return "可切换";
    case "exhausted":
      return "已用尽";
    case "authInvalid":
      return "登录失效";
    case "incomplete":
      return "状态不完整";
    default:
      return "待检测";
  }
}

function TrafficLights(): JSX.Element {
  return (
    <div className="mac-traffic-lights" aria-hidden="true">
      <span className="mac-traffic-light mac-traffic-light-close" />
      <span className="mac-traffic-light mac-traffic-light-minimize" />
      <span className="mac-traffic-light mac-traffic-light-zoom" />
    </div>
  );
}

function ToolbarChip(props: { label: string; tone?: "neutral" | "good" | "caution" | "danger" }): JSX.Element {
  return <span className={`toolbar-chip toolbar-chip-${props.tone ?? "neutral"}`}>{props.label}</span>;
}

function SurfaceCard(props: {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: JSX.Element;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className={`surface-card ${props.className ?? ""}`.trim()}>
      {(props.title || props.subtitle || props.actions || props.eyebrow) ? (
        <header className="surface-card-header">
          <div className="surface-card-copy">
            {props.eyebrow ? <span className="surface-eyebrow">{props.eyebrow}</span> : null}
            {props.title ? <h2>{props.title}</h2> : null}
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>
          {props.actions ? <div className="surface-card-actions">{props.actions}</div> : null}
        </header>
      ) : null}
      <div className="surface-card-body">{props.children}</div>
    </section>
  );
}

function MetricTile(props: {
  label: string;
  value: string;
  meta: string;
  tone?: "neutral" | "good" | "caution" | "danger";
}): JSX.Element {
  return (
    <article className={`metric-tile metric-tile-${props.tone ?? "neutral"}`}>
      <span className="metric-label">{props.label}</span>
      <strong className="metric-value">{props.value}</strong>
      <span className="metric-meta">{props.meta}</span>
    </article>
  );
}

function SectionLead(props: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: JSX.Element;
  badges?: JSX.Element;
}): JSX.Element {
  return (
    <section className="section-lead">
      <div className="section-lead-copy">
        <span className="surface-eyebrow">{props.eyebrow}</span>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
        {props.badges ? <div className="section-lead-badges">{props.badges}</div> : null}
      </div>
      {props.actions ? <div className="section-lead-actions">{props.actions}</div> : null}
    </section>
  );
}

function ProgressCard(props: { percent: number; message: string }): JSX.Element {
  const width = Math.max(4, Math.min(100, props.percent));
  return (
    <SurfaceCard title="执行进度" subtitle="桌面端所有命令都通过同一套 runner 和共享写锁。">
      <div className="progress-card">
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${width}%` }} />
        </div>
        <div className="progress-copy">
          <strong>{props.message}</strong>
          <span>{props.percent}%</span>
        </div>
      </div>
    </SurfaceCard>
  );
}

function DefinitionList(props: { items: Array<{ label: string; value: string; tone?: "neutral" | "good" | "caution" | "danger" }> }): JSX.Element {
  return (
    <dl className="definition-list">
      {props.items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="definition-row">
          <dt>{item.label}</dt>
          <dd className={item.tone ? `text-${item.tone}` : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActivityLogCard(props: { logs: string[] }): JSX.Element {
  return (
    <SurfaceCard title="活动记录" subtitle="保留最近 80 条桌面端运行日志。">
      <div className="activity-log">
        {props.logs.length === 0 ? <p>暂无日志。</p> : null}
        {props.logs.slice(-80).reverse().map((line, index) => (
          <div key={`${index}-${line}`} className="activity-log-line">{line}</div>
        ))}
      </div>
    </SurfaceCard>
  );
}

function DesktopResultCard(props: { data?: ResultData; error?: string }): JSX.Element {
  const data = props.data;
  return (
    <SurfaceCard title="最近结果" subtitle="结果、警告和恢复启动信息都会保留在这里。">
      <div className="result-card-stack">
        {props.error ? <p className="error">{props.error}</p> : null}
        {!data ? <p>暂无最近执行结果。</p> : null}
        {isExportResult(data) ? (
          <DefinitionList
            items={[
              { label: "导出 ZIP", value: data.zipPath },
              { label: "导出模式", value: data.mode },
              {
                label: "警告",
                value: data.warnings.length > 0 ? data.warnings.slice(0, 3).join("；") : "无",
                tone: data.warnings.length > 0 ? "caution" : "good"
              }
            ]}
          />
        ) : null}
        {isImportResult(data) ? (
          <DefinitionList
            items={[
              { label: "导入报告", value: data.reportPath },
              { label: "导入模式", value: data.mode },
              {
                label: "警告",
                value: data.warnings.length > 0 ? data.warnings.slice(0, 3).join("；") : "无",
                tone: data.warnings.length > 0 ? "caution" : "good"
              }
            ]}
          />
        ) : null}
        {isSwitchResult(data) ? (
          <DefinitionList
            items={[
              { label: "切换目标", value: data.targetProfileId },
              { label: "切换模式", value: data.switchMode },
              { label: "恢复启动", value: data.relaunchedClients.length > 0 ? data.relaunchedClients.join("、") : "无" }
            ]}
          />
        ) : null}
        {isThreadCleanupPreviewResult(data) ? (
          <DefinitionList
            items={[
              { label: "命中线程", value: statValue(data.totalMatchedThreads) },
              { label: "命中文件", value: statValue(data.totalMatchedFiles) },
              { label: "未命中会话", value: statValue(data.notFoundThreadIds.length), tone: toneFromCount(data.notFoundThreadIds.length) }
            ]}
          />
        ) : null}
        {isThreadCleanupResult(data) ? (
          <DefinitionList
            items={[
              { label: "删除线程", value: statValue(data.profiles.reduce((sum, item) => sum + item.deleted.threads, 0)) },
              { label: "删除文件", value: statValue(data.profiles.reduce((sum, item) => sum + item.deleted.files, 0)) },
              { label: "恢复启动", value: data.relaunchedClients.length > 0 ? data.relaunchedClients.join("、") : "无" },
              {
                label: "待重启继续执行",
                value: data.scheduledProfiles.length > 0 ? data.scheduledProfiles.join("、") : "无",
                tone: toneFromCount(data.scheduledProfiles.length)
              }
            ]}
          />
        ) : null}
      </div>
    </SurfaceCard>
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

  const activeProfile = state.profiles.find((item) => item.id === state.activeProfileId);
  const activePoolEntry = state.tokenPool.entries.find((item) => item.current);
  const availableTokenCount = state.tokenPool.entries.filter((item) => item.status === "available").length;
  const exhaustedTokenCount = state.tokenPool.entries.filter((item) => item.status === "exhausted").length;
  const tokenAuthInvalidCount = state.tokenPool.entries.filter((item) => item.status === "authInvalid").length;
  const profileUsageFailures = state.profiles.filter((item) => item.usageError).length;
  const tokenPoolUsageFailures = state.tokenPool.entries.filter((item) => item.usageError).length;
  const pendingCleanupProfiles = state.threadCleanupResult?.scheduledProfiles.length ?? 0;
  const latestAutoSwitch = state.tokenPool.lastAutoSwitchAt ? formatLocalTime(state.tokenPool.lastAutoSwitchAt) : "暂无";
  const currentTabMeta = TAB_META.find((item) => item.id === tab) ?? TAB_META[0];

  const commonAccountsProps = {
    profilesRoot: state.profilesRoot,
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    codexHome: state.codexHome,
    tokenPool: state.tokenPool,
    backupBeforeSwitch: state.backupBeforeSwitch,
    newProfileName: state.newProfileName,
    threadCleanupInput: state.threadCleanupInput,
    threadCleanupScope: state.threadCleanupScope,
    threadCleanupProfileId: state.threadCleanupProfileId,
    threadCleanupBackupEnabled: state.threadCleanupBackupEnabled,
    threadCleanupPreview: state.threadCleanupPreview,
    threadCleanupResult: state.threadCleanupResult,
    onChange,
    onRefresh: () => void refresh()
  };

  const sharedSidebar = (
    <>
      <ProgressCard percent={state.progressPercent} message={state.progressMessage} />
      <DesktopResultCard data={state.lastResult} error={state.lastError} />
      <ActivityLogCard logs={state.logs} />
    </>
  );

  return (
    <div className="desktop-app">
      <div className="desktop-window">
        <header className="desktop-topbar">
          <div className="desktop-topbar-main">
            <TrafficLights />
            <div className="desktop-title-lockup">
              <span className="desktop-app-kicker">Codex Migration Assistant</span>
              <div>
                <h1>{currentTabMeta.label}</h1>
                <p>{currentTabMeta.detail} · 与扩展共享 `~/.codex` 与 `~/.codex-profiles`</p>
              </div>
            </div>
          </div>
          <div className="desktop-topbar-status">
            <ToolbarChip label={state.activeProfileId ? `当前槽位 ${state.activeProfileId}` : "未识别槽位"} />
            <ToolbarChip label={`${state.tokenPool.entries.length} 个池账号`} tone={availableTokenCount > 0 ? "good" : "neutral"} />
            <ToolbarChip label={`${profileUsageFailures + tokenPoolUsageFailures} 个刷新失败`} tone={toneFromCount(profileUsageFailures + tokenPoolUsageFailures)} />
          </div>
        </header>

        <div className="desktop-toolbar-band">
          <nav className="desktop-segmented-control" aria-label="主导航">
            {TAB_META.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`desktop-segment ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </button>
            ))}
          </nav>
          <div className="desktop-toolbar-actions">
            <button onClick={() => void refresh(state.codexHome)}>刷新状态</button>
            <button className="primary" onClick={() => void openPath(state.codexHome)}>打开 Codex 目录</button>
          </div>
        </div>

        {tab === "overview" ? (
          <main className="desktop-workbench">
            <section className="desktop-content-column">
              <SectionLead
                eyebrow="macOS Workbench"
                title="把账号切换、账号池和清理放进一个真正适合桌面的窗口。"
                description="这版桌面端按 macOS 的窗口、toolbar、材质分层和横向导航来重做。目标不是复制扩展，而是把高频操作放进一个更稳定、更像原生 app 的工作台。"
                badges={
                  <>
                    <ToolbarChip label={state.platform || "desktop"} />
                    <ToolbarChip label={`自动切换 ${state.tokenPool.settings.autoSwitchEnabled ? "已启用" : "未启用"}`} tone={state.tokenPool.settings.autoSwitchEnabled ? "good" : "neutral"} />
                    <ToolbarChip label={`清理待续跑 ${pendingCleanupProfiles}`} tone={toneFromCount(pendingCleanupProfiles)} />
                  </>
                }
                actions={
                  <>
                    <button className="primary" onClick={() => setTab("accounts")}>管理账号槽位</button>
                    <button onClick={() => setTab("tokenPool")}>打开账号池</button>
                    <button onClick={() => setTab("migration")}>导入 / 导出</button>
                  </>
                }
              />

              <div className="metric-grid">
                <MetricTile
                  label="账号槽位"
                  value={statValue(state.profiles.length)}
                  meta={activeProfile ? `当前 ${activeProfile.name}` : "尚未识别当前槽位"}
                />
                <MetricTile
                  label="可切换池账号"
                  value={statValue(availableTokenCount)}
                  meta={activePoolEntry ? `当前 ${activePoolEntry.email || activePoolEntry.accountId}` : "当前未使用账号池条目"}
                  tone={availableTokenCount > 0 ? "good" : "caution"}
                />
                <MetricTile
                  label="刷新失败"
                  value={statValue(profileUsageFailures + tokenPoolUsageFailures)}
                  meta={`账号 ${profileUsageFailures} · 账号池 ${tokenPoolUsageFailures}`}
                  tone={toneFromCount(profileUsageFailures + tokenPoolUsageFailures)}
                />
                <MetricTile
                  label="最近自动切换"
                  value={latestAutoSwitch}
                  meta={state.tokenPool.lastAutoSwitchMessage ?? "暂无自动切换记录"}
                  tone={state.tokenPool.lastAutoSwitchMessage ? "good" : "neutral"}
                />
              </div>

              <div className="bento-grid">
                <SurfaceCard
                  className="bento-span-2"
                  eyebrow="目录与共享状态"
                  title="共享一份数据，但保持单写锁。"
                  subtitle="桌面端与扩展直接共用本地目录，不做额外同步。高频动作都从同一套存储协议和 runner 进入。"
                >
                  <DefinitionList
                    items={[
                      { label: "Codex 目录", value: state.codexHome || "-" },
                      { label: "Profiles 根目录", value: state.profilesRoot || "-" },
                      { label: "默认导出目录", value: state.defaultOutputDir || "-" },
                      { label: "当前活动槽位", value: activeProfile ? `${activeProfile.name} (${activeProfile.id})` : "未识别" }
                    ]}
                  />
                </SurfaceCard>

                <SurfaceCard eyebrow="账号池健康度" title="pool-runner 运行面板" subtitle="桌面端把池账号状态单独暴露，不再藏在长列表里。">
                  <DefinitionList
                    items={[
                      { label: "池内账号", value: statValue(state.tokenPool.entries.length) },
                      { label: "状态可切换", value: statValue(availableTokenCount), tone: availableTokenCount > 0 ? "good" : "caution" },
                      { label: "已用尽", value: statValue(exhaustedTokenCount), tone: toneFromCount(exhaustedTokenCount) },
                      { label: "登录失效", value: statValue(tokenAuthInvalidCount), tone: toneFromCount(tokenAuthInvalidCount) }
                    ]}
                  />
                </SurfaceCard>

                <SurfaceCard eyebrow="对话清理" title="删除前预览，重启后续跑。" subtitle="清理链路保留预览、挂起任务和恢复启动，适合桌面长时间运行。">
                  <DefinitionList
                    items={[
                      { label: "待续跑账号", value: statValue(pendingCleanupProfiles), tone: toneFromCount(pendingCleanupProfiles) },
                      {
                        label: "最近命中线程",
                        value: state.threadCleanupPreview ? statValue(state.threadCleanupPreview.totalMatchedThreads) : "暂无",
                        tone: state.threadCleanupPreview ? "caution" : "neutral"
                      },
                      {
                        label: "最近删除文件",
                        value: state.threadCleanupResult
                          ? statValue(state.threadCleanupResult.profiles.reduce((sum, item) => sum + item.deleted.files, 0))
                          : "暂无"
                      }
                    ]}
                  />
                </SurfaceCard>
              </div>
            </section>

            <aside className="desktop-inspector-column">
              {sharedSidebar}
            </aside>
          </main>
        ) : null}

        {tab === "accounts" ? (
          <main className="desktop-workbench">
            <section className="desktop-content-column">
              <SectionLead
                eyebrow="Accounts"
                title="账号槽位现在是一块独立桌面工作区。"
                description="顶部摘要负责给你判断当前风险和状态，具体的切换、合并、覆盖、拖拽排序和单账号导出仍然走现有稳定逻辑。"
                badges={
                  <>
                    <ToolbarChip label={`当前 ${activeProfile?.name ?? "未识别"}`} />
                    <ToolbarChip label={`${state.profiles.length} 个槽位`} />
                    <ToolbarChip label={`${profileUsageFailures} 个用量失败`} tone={toneFromCount(profileUsageFailures)} />
                  </>
                }
                actions={
                  <>
                    <button onClick={() => void refresh(state.codexHome)}>刷新账号状态</button>
                    <button className="primary" onClick={() => void runCommand({ command: "refreshProfileUsage", payload: { codexHome: state.codexHome } }, { progressMessage: "刷新账号用量" })}>
                      刷新全部用量
                    </button>
                  </>
                }
              />

              <div className="metric-grid metric-grid-3">
                <MetricTile label="登录态完整" value={statValue(state.profiles.filter((item) => item.hasAuth).length)} meta="含 auth 的账号槽位" tone="good" />
                <MetricTile label="带 State" value={statValue(state.profiles.filter((item) => item.hasState).length)} meta="有本地 state 数据" />
                <MetricTile label="需要处理" value={statValue(profileUsageFailures)} meta="用量查询失败账号" tone={toneFromCount(profileUsageFailures)} />
              </div>

              <SurfaceCard className="desktop-embedded-surface" title="账号槽位控制台" subtitle="适合桌面宽窗口的槽位管理、切换和导出。">
                <AccountsManager
                  {...commonAccountsProps}
                  sectionMode="accounts"
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
              </SurfaceCard>
            </section>

            <aside className="desktop-inspector-column">
              <SurfaceCard title="当前槽位" subtitle="侧栏只负责上下文，不把账号操作挤到这里。">
                <DefinitionList
                  items={[
                    { label: "活动账号", value: activeProfile ? `${activeProfile.name} (${activeProfile.id})` : "未识别" },
                    { label: "最近激活", value: formatLocalTime(activeProfile?.lastActivatedAt) },
                    { label: "登录态", value: activeProfile?.hasAuth ? "已检测" : "未检测", tone: activeProfile?.hasAuth ? "good" : "caution" },
                    { label: "State", value: activeProfile?.hasState ? "已检测" : "未检测", tone: activeProfile?.hasState ? "good" : "neutral" }
                  ]}
                />
              </SurfaceCard>
              {sharedSidebar}
            </aside>
          </main>
        ) : null}

        {tab === "tokenPool" ? (
          <main className="desktop-workbench">
            <section className="desktop-content-column">
              <SectionLead
                eyebrow="Pool Runner"
                title="账号池不再是扩展侧栏里的附属区域。"
                description="桌面端把 pool-runner 当成一块独立工作区，强调条目健康度、自动切换配置、最近切换结果和失败状态来源。"
                badges={
                  <>
                    <ToolbarChip label={`池账号 ${state.tokenPool.entries.length}`} />
                    <ToolbarChip label={`可切换 ${availableTokenCount}`} tone={availableTokenCount > 0 ? "good" : "caution"} />
                    <ToolbarChip label={`刷新失败 ${tokenPoolUsageFailures}`} tone={toneFromCount(tokenPoolUsageFailures)} />
                  </>
                }
                actions={
                  <>
                    <button onClick={() => void refresh(state.codexHome)}>刷新池状态</button>
                    <button className="primary" onClick={() => setTab("accounts")}>去同步 pool-runner</button>
                  </>
                }
              />

              <div className="metric-grid metric-grid-3">
                <MetricTile label="当前条目" value={activePoolEntry ? activePoolEntry.email || activePoolEntry.accountId : "未启用"} meta={activePoolEntry ? statusForEntry(activePoolEntry) : "当前未切换池账号"} tone={activePoolEntry ? "good" : "neutral"} />
                <MetricTile label="自动切换" value={state.tokenPool.settings.autoSwitchEnabled ? "已启用" : "未启用"} meta={`检测间隔 ${Math.round(state.tokenPool.settings.pollIntervalMs / 60000) || 0} 分钟`} tone={state.tokenPool.settings.autoSwitchEnabled ? "good" : "neutral"} />
                <MetricTile label="最近切换" value={latestAutoSwitch} meta={state.tokenPool.lastAutoSwitchMessage ?? "暂无自动切换记录"} tone={state.tokenPool.lastAutoSwitchMessage ? "good" : "neutral"} />
              </div>

              <SurfaceCard className="desktop-embedded-surface" title="账号池控制台" subtitle="导入、单条刷新、排序、切换和自动化设置都留在桌面端的大视图里。">
                <AccountsManager
                  {...commonAccountsProps}
                  sectionMode="tokenPool"
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
              </SurfaceCard>
            </section>

            <aside className="desktop-inspector-column">
              <SurfaceCard title="池状态概览" subtitle="把自动换号决策需要的信息直接钉在右侧。">
                <DefinitionList
                  items={[
                    { label: "当前活动条目", value: activePoolEntry ? activePoolEntry.email || activePoolEntry.accountId : "未启用" },
                    { label: "已用尽", value: statValue(exhaustedTokenCount), tone: toneFromCount(exhaustedTokenCount) },
                    { label: "登录失效", value: statValue(tokenAuthInvalidCount), tone: toneFromCount(tokenAuthInvalidCount) },
                    { label: "自动重启 Codex", value: state.tokenPool.settings.autoRelaunchAfterSwitch ? "已启用" : "未启用" }
                  ]}
                />
              </SurfaceCard>
              {sharedSidebar}
            </aside>
          </main>
        ) : null}

        {tab === "migration" ? (
          <main className="desktop-workbench">
            <section className="desktop-content-column">
              <SectionLead
                eyebrow="Migration"
                title="导出、预演导入和导入到新槽位都保留，但放进更桌面的版式里。"
                description="导入导出本身不需要炫技。桌面端更适合把路径、风险项、最近结果和预演报告分开，让你在一个宽窗口里同时看清两边。"
                badges={
                  <>
                    <ToolbarChip label={`导出目录 ${state.outputDir || state.defaultOutputDir || "-"}`} />
                    <ToolbarChip label={state.backupZip ? "已选择备份 ZIP" : "未选择备份 ZIP"} tone={state.backupZip ? "good" : "neutral"} />
                  </>
                }
                actions={
                  <>
                    <button onClick={() => void openPath(state.outputDir || state.defaultOutputDir)}>打开导出目录</button>
                    <button className="primary" onClick={() => setTab("overview")}>返回工作台</button>
                  </>
                }
              />

              <div className="desktop-migration-stack">
                <SurfaceCard className="desktop-embedded-surface" title="导出" subtitle="保持原有功能，但放进更适合桌面宽屏的表单块。">
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
                </SurfaceCard>

                <SurfaceCard className="desktop-embedded-surface" title="导入" subtitle="预演、覆盖 state、导入 auth 和导入到新槽位都继续支持。">
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
                </SurfaceCard>
              </div>
            </section>

            <aside className="desktop-inspector-column">
              <SurfaceCard title="预演摘要" subtitle="这里保留最近一次预演的冲突统计和采样。">
                <PreviewResult data={state.lastResult as PreviewResultType | undefined} />
              </SurfaceCard>
              {sharedSidebar}
            </aside>
          </main>
        ) : null}

        {tab === "cleanup" ? (
          <main className="desktop-workbench">
            <section className="desktop-content-column">
              <SectionLead
                eyebrow="Conversation Cleanup"
                title="先预览，再删除，再决定是否立即结束占用进程。"
                description="桌面端保留完整的会话 ID 检测、结果弹层、restartLater 和 killNow 分支，让清理动作更像一套维护工作流，而不是隐藏按钮。"
                badges={
                  <>
                    <ToolbarChip label={`预览命中 ${state.threadCleanupPreview?.totalMatchedThreads ?? 0}`} tone={state.threadCleanupPreview ? "caution" : "neutral"} />
                    <ToolbarChip label={`待重启继续执行 ${pendingCleanupProfiles}`} tone={toneFromCount(pendingCleanupProfiles)} />
                    <ToolbarChip label={state.threadCleanupBackupEnabled ? "删除前备份已开启" : "删除前备份已关闭"} />
                  </>
                }
                actions={
                  <>
                    <button onClick={() => void refresh(state.codexHome)}>刷新状态</button>
                    <button className="primary" onClick={() => setTab("overview")}>回到总览</button>
                  </>
                }
              />

              <SurfaceCard className="desktop-embedded-surface" title="会话清理控制台" subtitle="支持按会话 ID 在当前账号、指定账号或全部账号里查找后执行。">
                <AccountsManager
                  {...commonAccountsProps}
                  sectionMode="cleanup"
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
              </SurfaceCard>
            </section>

            <aside className="desktop-inspector-column">
              <SurfaceCard title="清理状态" subtitle="先看命中范围，再决定是否立即结束占用进程。">
                <DefinitionList
                  items={[
                    { label: "最近预览命中线程", value: statValue(state.threadCleanupPreview?.totalMatchedThreads ?? 0), tone: state.threadCleanupPreview ? "caution" : "neutral" },
                    { label: "最近预览命中文件", value: statValue(state.threadCleanupPreview?.totalMatchedFiles ?? 0) },
                    {
                      label: "最近恢复启动",
                      value: state.threadCleanupResult?.relaunchedClients.length ? state.threadCleanupResult.relaunchedClients.join("、") : "无"
                    },
                    { label: "待重启继续执行", value: statValue(pendingCleanupProfiles), tone: toneFromCount(pendingCleanupProfiles) }
                  ]}
                />
              </SurfaceCard>
              {sharedSidebar}
            </aside>
          </main>
        ) : null}

        {tab === "settings" ? (
          <main className="desktop-workbench">
            <section className="desktop-content-column">
              <SectionLead
                eyebrow="Settings"
                title="保留最关键的共享目录、打包产物和运行边界。"
                description="设置页不做复杂配置迷宫，只保留你在桌面端真正需要核对的目录、产物和运行状态。"
                actions={
                  <>
                    <button onClick={() => void openPath(state.profilesRoot)}>打开 Profiles 根目录</button>
                    <button className="primary" onClick={() => void refresh(state.codexHome)}>刷新设置状态</button>
                  </>
                }
              />

              <div className="desktop-settings-stack">
                <SurfaceCard title="共享目录">
                  <DefinitionList
                    items={[
                      { label: "Codex 目录", value: state.codexHome || "-" },
                      { label: "Profiles 根目录", value: state.profilesRoot || "-" },
                      { label: "默认导出目录", value: state.defaultOutputDir || "-" }
                    ]}
                  />
                </SurfaceCard>

                <SurfaceCard title="桌面端运行状态">
                  <DefinitionList
                    items={[
                      { label: "窗口形态", value: "可自由缩放 + 顶部 segmented 导航" },
                      { label: "执行方式", value: "Tauri command + 内置 sidecar runner" },
                      { label: "共享模型", value: "直接共用 ~/.codex 与 ~/.codex-profiles" },
                      { label: "当前平台", value: state.platform || "-" }
                    ]}
                  />
                </SurfaceCard>

                <SurfaceCard title="桌面版产物">
                  <DefinitionList
                    items={[
                      { label: "App", value: "apps/desktop-macos/src-tauri/target/release/bundle/macos/Codex Migration Assistant.app" },
                      { label: "DMG", value: "apps/desktop-macos/src-tauri/target/release/bundle/dmg/Codex Migration Assistant_1.0.2_aarch64.dmg" }
                    ]}
                  />
                </SurfaceCard>
              </div>
            </section>

            <aside className="desktop-inspector-column">
              {sharedSidebar}
            </aside>
          </main>
        ) : null}
      </div>
    </div>
  );
}
