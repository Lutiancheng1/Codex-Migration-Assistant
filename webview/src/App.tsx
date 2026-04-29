import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "./api/vscodeBridge";
import type {
  RequestMessage,
  ResponseMessage,
  ThreadCleanupApplyMode,
  ThreadCleanupPreviewResult,
  ThreadCleanupResult,
  ThreadCleanupScope
} from "./api/types";
import { ProgressPanel } from "./components/ProgressPanel";
import { RiskConfirmDialog } from "./components/RiskConfirmDialog";
import { SummaryCard } from "./components/SummaryCard";
import { AccountsManager } from "./pages/AccountsManager";
import { Home } from "./pages/Home";
import { ExportWizard } from "./pages/ExportWizard";
import { ImportWizard } from "./pages/ImportWizard";
import { ProcessLockDialog, type BusyProcess } from "./components/ProcessLockDialog";
import { initialState, type UiState } from "./state/store";
import "./styles.css";

type Tab = "export" | "import" | "accounts";

function formatLogTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return new Date().toLocaleTimeString();
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return timestamp;
  }
  return new Date(parsed).toLocaleTimeString();
}

function formatLogLine(level: "info" | "warn" | "error", message: string, timestamp?: string): string {
  return `[${formatLogTimestamp(timestamp)}] [${level}] ${message}`;
}

function normalizeOutputDirValue(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  if (!trimmed.toLowerCase().endsWith(".zip")) {
    return trimmed;
  }
  const slashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slashIndex <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, slashIndex);
}

function parseThreadIds(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/[\s,]+/g).map((item) => item.trim())) {
    if (!part || seen.has(part)) {
      continue;
    }
    seen.add(part);
    out.push(part);
  }
  return out;
}

function isThreadCleanupRequest(message?: RequestMessage): message is Extract<RequestMessage, { type: "START_THREAD_CLEANUP" }> {
  return !!message && message.type === "START_THREAD_CLEANUP";
}

function isRetryableAfterKill(message?: RequestMessage): boolean {
  if (!message) {
    return false;
  }
  return message.type === "ACTIVATE_PROFILE" || message.type === "DELETE_PROFILE" || message.type === "START_THREAD_CLEANUP";
}

type LockDetails = {
  busy?: BusyProcess[];
};

export default function App(): JSX.Element {
  const [expandedTabs, setExpandedTabs] = useState<Set<Tab>>(new Set(["accounts"]));
  const [state, setState] = useState<UiState>(initialState);
  const pickTargetRef = useRef<"outputDir" | "backupZip">("outputDir");
  const lastRequestRef = useRef<RequestMessage | undefined>();
  const retryAfterKillRef = useRef<RequestMessage | undefined>();
  const [pendingLockDetails, setPendingLockDetails] = useState<LockDetails | undefined>();

  function dispatch(message: RequestMessage): void {
    lastRequestRef.current = message;
    if (isRetryableAfterKill(message)) {
      retryAfterKillRef.current = message;
    }
    post(message);
  }

  useEffect(() => {
    const handler = (event: MessageEvent<ResponseMessage>) => {
      const msg = event.data;

      if (msg.type === "STATE_SNAPSHOT") {
        setState((s) => ({
          ...s,
          codexHome: msg.payload.codexHome,
          platform: msg.payload.platform,
          profilesRoot: msg.payload.profilesRoot,
          activeProfileId: msg.payload.activeProfileId,
          profiles: msg.payload.profiles,
          tokenPool: msg.payload.tokenPool,
          outputDir: normalizeOutputDirValue(s.outputDir).trim().length > 0 ? normalizeOutputDirValue(s.outputDir) : msg.payload.defaultOutputDir,
          threadCleanupProfileId:
            s.threadCleanupProfileId.trim().length > 0 ? s.threadCleanupProfileId : (msg.payload.activeProfileId ?? msg.payload.profiles[0]?.id ?? "")
        }));
        return;
      }

      if (msg.type === "PATH_PICKED") {
        const pickedPath = msg.payload.path;
        if (!pickedPath) {
          return;
        }
        setState((s) => {
          if (pickTargetRef.current === "outputDir") {
            return { ...s, outputDir: normalizeOutputDirValue(pickedPath) };
          }
          return { ...s, backupZip: pickedPath };
        });
        return;
      }

      if (msg.type === "TASK_PROGRESS") {
        setState((s) => ({ ...s, progressPercent: msg.payload.percent, progressMessage: msg.payload.message }));
        return;
      }

      if (msg.type === "TASK_LOG") {
        setState((s) => ({ ...s, logs: [...s.logs, formatLogLine(msg.payload.level, msg.payload.message, msg.payload.timestamp)] }));
        return;
      }

      if (msg.type === "TASK_RESULT") {
        if (msg.payload.action === "killProcesses") {
          return;
        }
        if (msg.payload.action === "threadCleanupPreview") {
          setState((s) => ({
            ...s,
            threadCleanupPreview: msg.payload.data as ThreadCleanupPreviewResult,
            lastResult: msg.payload.data as ThreadCleanupPreviewResult
          }));
          return;
        }
        if (msg.payload.action === "threadCleanup") {
          setState((s) => ({
            ...s,
            threadCleanupResult: msg.payload.data as ThreadCleanupResult,
            lastResult: msg.payload.data as ThreadCleanupResult
          }));
          return;
        }
        setState((s) => ({ ...s, lastResult: msg.payload.data as UiState["lastResult"] }));
        return;
      }

      if (msg.type === "TASK_ERROR") {
        const lastRequest = lastRequestRef.current;
        if (msg.payload.code === "E_FILE_LOCKED" && isThreadCleanupRequest(lastRequest) && lastRequest.payload.applyMode === "restartLater") {
          setState((s) => ({
            ...s,
            logs: [...s.logs, formatLogLine("warn", msg.payload.message)],
            lastError: `${msg.payload.code}: ${msg.payload.message}`
          }));
          return;
        }
        if (msg.payload.code === "E_FILE_LOCKED") {
          setPendingLockDetails({ busy: msg.payload.details?.busy as BusyProcess[] });
          return;
        }
        retryAfterKillRef.current = undefined;
        setState((s) => ({ ...s, lastError: `${msg.payload.code}: ${msg.payload.message}` }));
      }
    };

    window.addEventListener("message", handler as EventListener);
    dispatch({ type: "INIT" });
    return () => window.removeEventListener("message", handler as EventListener);
  }, []);

  const hasRisk = useMemo(() => state.includeAuth || state.importAuth || state.replaceState, [state.includeAuth, state.importAuth, state.replaceState]);

  function toggleTab(targetTab: Tab): void {
    setExpandedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(targetTab)) {
        next.delete(targetTab);
      } else {
        next.add(targetTab);
      }
      return next;
    });
  }

  function onChange(field: string, value: string | boolean): void {
    setState((s) => {
      const next: UiState = { ...s, [field]: value } as UiState;
      if (field === "threadCleanupInput" || field === "threadCleanupScope" || field === "threadCleanupProfileId") {
        next.threadCleanupPreview = undefined;
      }
      return next;
    });
  }

  function pushLocalError(message: string): void {
    setState((s) => ({ ...s, lastError: message, logs: [...s.logs, formatLogLine("error", message)] }));
  }

  return (
    <main>
      <header>
        <h1>Codex 迁移助手</h1>
        <p>跨设备同步记录用导出 / 导入，当前设备无感换号用账号槽位与账号池</p>
      </header>

      <Home platform={state.platform} codexHome={state.codexHome} />

      <nav className="tabs" style={{ display: 'none' }}>
        {/* 已弃用 Tab，改为手风琴 */}
      </nav>

      <div className="accordion-container">
        {/* 账号与偏好面板 */}
        <section className={`accordion-card ${expandedTabs.has("accounts") ? "active" : ""}`}>
          <header className="accordion-header" onClick={() => toggleTab("accounts")}>
            <h2>账号管理与切换</h2>
            <span className="accordion-icon">{expandedTabs.has("accounts") ? "▼" : "▶"}</span>
          </header>
          {expandedTabs.has("accounts") && (
            <div className="accordion-body">
              <AccountsManager
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
                onRefresh={() => dispatch({ type: "REFRESH_PROFILES", payload: { codexHome: state.codexHome } })}
                onRefreshUsage={(profileId) => dispatch({ type: "REFRESH_PROFILE_USAGE", payload: { codexHome: state.codexHome, profileId } })}
                onImportTokenPoolSingle={() => dispatch({ type: "IMPORT_TOKEN_POOL_FILES", payload: { mode: "single" } })}
                onImportTokenPoolMultiple={() => dispatch({ type: "IMPORT_TOKEN_POOL_FILES", payload: { mode: "multiple" } })}
                onImportTokenPoolDirectory={() => dispatch({ type: "IMPORT_TOKEN_POOL_DIRECTORY" })}
                onImportProfileToTokenPool={(profileId) =>
                  dispatch({ type: "IMPORT_PROFILE_TO_TOKEN_POOL", payload: { codexHome: state.codexHome, profileId } })
                }
                onSyncCurrentToPoolRunner={() => dispatch({ type: "SYNC_CURRENT_TO_POOL_RUNNER", payload: { codexHome: state.codexHome } })}
                onSwitchToPoolRunner={() =>
                  dispatch({
                    type: "SWITCH_TO_POOL_RUNNER",
                    payload: { codexHome: state.codexHome, backupCurrent: state.backupBeforeSwitch }
                  })}
                onRefreshTokenPoolEntry={(entryId) =>
                  dispatch({ type: "REFRESH_TOKEN_POOL_ENTRY_USAGE", payload: { codexHome: state.codexHome, entryId } })
                }
                onRefreshTokenPoolGroup={(category) =>
                  dispatch({ type: "REFRESH_TOKEN_POOL_GROUP_USAGE", payload: { codexHome: state.codexHome, category } })
                }
                onActivateTokenPoolEntry={(entryId) =>
                  dispatch({ type: "ACTIVATE_TOKEN_POOL_ENTRY", payload: { codexHome: state.codexHome, entryId } })
                }
                onDeleteTokenPoolEntry={(entryId) => dispatch({ type: "DELETE_TOKEN_POOL_ENTRY", payload: { entryId } })}
                onMoveTokenPoolEntry={(entryId, direction) =>
                  dispatch({ type: "MOVE_TOKEN_POOL_ENTRY", payload: { entryId, direction } })
                }
                onReorderTokenPoolEntries={(orderedIds) =>
                  dispatch({ type: "REORDER_TOKEN_POOL_ENTRIES", payload: { orderedIds } })
                }
                onUpdateTokenPoolSettings={(payload) => dispatch({ type: "SET_TOKEN_POOL_SETTINGS", payload })}
                onExportProfile={(profileId) => {
                  if (state.outputDir.trim().length === 0) {
                    pushLocalError("请先在导出面板设置导出目录。");
                    return;
                  }
                  dispatch({
                    type: "START_EXPORT",
                    payload: {
                      codexHome: state.codexHome,
                      outputDir: state.outputDir,
                      includeState: state.includeState,
                      includeAuth: state.includeAuth,
                      mode: "core",
                      scope: "single",
                      profileId
                    }
                  });
                }}
                onCreate={() => {
                  if (state.newProfileName.trim().length === 0) {
                    pushLocalError("请输入新账号名称。");
                    return;
                  }
                  dispatch({ type: "CREATE_PROFILE", payload: { codexHome: state.codexHome, name: state.newProfileName.trim() } });
                  onChange("newProfileName", "");
                }}
                onActivate={(profileId) =>
                  dispatch({
                    type: "ACTIVATE_PROFILE",
                    payload: {
                      codexHome: state.codexHome,
                      profileId,
                      backupCurrent: state.backupBeforeSwitch,
                      switchMode: "plain"
                    }
                  })
                }
                onActivateAndMerge={(profileId) => {
                  dispatch({
                    type: "ACTIVATE_PROFILE",
                    payload: {
                      codexHome: state.codexHome,
                      profileId,
                      backupCurrent: state.backupBeforeSwitch,
                      switchMode: "merge"
                    }
                  });
                }}
                onActivateAndOverwrite={(profileId) => {
                  dispatch({
                    type: "ACTIVATE_PROFILE",
                    payload: {
                      codexHome: state.codexHome,
                      profileId,
                      backupCurrent: state.backupBeforeSwitch,
                      switchMode: "overwrite"
                    }
                  });
                }}
                onDelete={(profileId) => {
                  dispatch({ type: "DELETE_PROFILE", payload: { codexHome: state.codexHome, profileId } });
                }}
                onReorderProfiles={(orderedIds) =>
                  dispatch({ type: "REORDER_PROFILES", payload: { codexHome: state.codexHome, orderedIds } })
                }
                onPreviewThreadCleanup={() => {
                  const threadIds = parseThreadIds(state.threadCleanupInput);
                  if (threadIds.length === 0) {
                    pushLocalError("请先输入至少一个会话ID。");
                    return;
                  }
                  if (state.threadCleanupScope === "single" && state.threadCleanupProfileId.trim().length === 0) {
                    pushLocalError("单账号清理需要先选择账号。");
                    return;
                  }
                  dispatch({
                    type: "PREVIEW_THREAD_CLEANUP",
                    payload: {
                      codexHome: state.codexHome,
                      threadIds,
                      scope: state.threadCleanupScope,
                      profileId: state.threadCleanupScope === "single" ? state.threadCleanupProfileId.trim() : undefined
                    }
                  });
                }}
                onStartThreadCleanup={(applyMode: ThreadCleanupApplyMode) => {
                  const threadIds = parseThreadIds(state.threadCleanupInput);
                  if (threadIds.length === 0) {
                    pushLocalError("请先输入至少一个会话ID。");
                    return;
                  }
                  if (!state.threadCleanupPreview) {
                    pushLocalError("请先执行“查找匹配”预览，再确认删除。");
                    return;
                  }
                  dispatch({
                    type: "START_THREAD_CLEANUP",
                    payload: {
                      codexHome: state.codexHome,
                      threadIds,
                      scope: state.threadCleanupScope,
                      profileId: state.threadCleanupScope === "single" ? state.threadCleanupProfileId.trim() : undefined,
                      backupEnabled: state.threadCleanupBackupEnabled,
                      applyMode
                    }
                  });
                }}
              />
            </div>
          )}
        </section>

        {/* 导出面板 */}
        <section className={`accordion-card ${expandedTabs.has("export") ? "active" : ""}`}>
          <header className="accordion-header" onClick={() => toggleTab("export")}>
            <h2>导出任务</h2>
            <span className="accordion-icon">{expandedTabs.has("export") ? "▼" : "▶"}</span>
          </header>
          {expandedTabs.has("export") && (
            <div className="accordion-body">
              <ExportWizard
                codexHome={state.codexHome}
                outputDir={state.outputDir}
                exportScope={state.exportScope}
                includeState={state.includeState}
                includeAuth={state.includeAuth}
                onChange={onChange}
                onPickOutputDir={() => {
                  pickTargetRef.current = "outputDir";
                  dispatch({ type: "PICK_PATH", payload: { kind: "folder", title: "选择导出目录" } });
                }}
                onOpenOutputDir={() => {
                  const pathname = state.outputDir.trim();
                  if (pathname.length === 0) {
                    return;
                  }
                  dispatch({ type: "OPEN_IN_OS", payload: { path: pathname } });
                }}
                onRun={() => {
                  if (state.outputDir.trim().length === 0) {
                    pushLocalError("请先选择导出目录，再执行导出。");
                    return;
                  }
                  dispatch({
                    type: "START_EXPORT",
                    payload: {
                      codexHome: state.codexHome,
                      outputDir: state.outputDir,
                      includeState: state.includeState,
                      includeAuth: state.includeAuth,
                      mode: "core",
                      scope: state.exportScope
                    }
                  });
                }}
              />
            </div>
          )}
        </section>

        {/* 导入面板 */}
        <section className={`accordion-card ${expandedTabs.has("import") ? "active" : ""}`}>
          <header className="accordion-header" onClick={() => toggleTab("import")}>
            <h2>导入任务</h2>
            <span className="accordion-icon">{expandedTabs.has("import") ? "▼" : "▶"}</span>
          </header>
          {expandedTabs.has("import") && (
            <div className="accordion-body">
              <ImportWizard
                codexHome={state.codexHome}
                backupZip={state.backupZip}
                importProfileName={state.importProfileName}
                replaceState={state.replaceState}
                importAuth={state.importAuth}
                onChange={onChange}
                onPickZip={() => {
                  pickTargetRef.current = "backupZip";
                  dispatch({ type: "PICK_PATH", payload: { kind: "file", title: "选择备份 ZIP 文件", filters: { Zip: ["zip"] } } });
                }}
                onPickZipFromDefault={() => {
                  pickTargetRef.current = "backupZip";
                  dispatch({ type: "PICK_DEFAULT_BACKUP", payload: { directory: state.outputDir } });
                }}
                onPreview={() => {
                  if (state.backupZip.trim().length === 0) {
                    pushLocalError("请先选择备份 ZIP 文件，再执行预演。");
                    return;
                  }
                  dispatch({
                    type: "START_PREVIEW_IMPORT",
                    payload: {
                      codexHome: state.codexHome,
                      backupZip: state.backupZip,
                      replaceState: state.replaceState,
                      importAuth: state.importAuth,
                      mode: "core"
                    }
                  });
                }}
                onRunImport={() => {
                  if (state.backupZip.trim().length === 0) {
                    pushLocalError("请先选择备份 ZIP 文件，再执行导入。");
                    return;
                  }
                  dispatch({
                    type: "START_IMPORT",
                    payload: {
                      codexHome: state.codexHome,
                      backupZip: state.backupZip,
                      replaceState: state.replaceState,
                      importAuth: state.importAuth,
                      mode: "core"
                    }
                  });
                }}
                onRunImportToNewProfile={() => {
                  if (state.backupZip.trim().length === 0) {
                    pushLocalError("请先选择备份 ZIP 文件，再执行导入。");
                    return;
                  }
                  const profileName = state.importProfileName.trim();
                  if (profileName.length === 0) {
                    pushLocalError("请先输入新账号名称。");
                    return;
                  }
                  dispatch({
                    type: "START_IMPORT_TO_NEW_PROFILE",
                    payload: {
                      codexHome: state.codexHome,
                      backupZip: state.backupZip,
                      replaceState: state.replaceState,
                      importAuth: state.importAuth,
                      mode: "core",
                      profileName
                    }
                  });
                }}
              />
            </div>
          )}
        </section>
      </div>

      <div className="status-footer-area">
        <RiskConfirmDialog enabled={hasRisk} />
        <ProgressPanel percent={state.progressPercent} message={state.progressMessage} />
        <SummaryCard title="执行与操作日志">
          <pre className="log-pre">{state.logs.length ? state.logs.join("\n") : "暂无日志。"}</pre>
        </SummaryCard>
      </div>

      <ProcessLockDialog
        isOpen={!!pendingLockDetails}
        busy={pendingLockDetails?.busy}
        onCancel={() => setPendingLockDetails(undefined)}
        onConfirmKill={() => {
          if (!pendingLockDetails?.busy) return;
          const pids = pendingLockDetails.busy.map(item => item.pid);
          const commands = pendingLockDetails.busy.map(item => item.command);
          setPendingLockDetails(undefined);
          post({ type: "KILL_PROCESSES", payload: { pids, commands } });
        }}
      />
    </main>
  );
}
