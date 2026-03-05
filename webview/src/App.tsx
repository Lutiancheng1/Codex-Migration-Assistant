import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "./api/vscodeBridge";
import type { RequestMessage, ResponseMessage } from "./api/types";
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

type LockDetails = {
  busy?: BusyProcess[];
};

export default function App(): JSX.Element {
  const [expandedTabs, setExpandedTabs] = useState<Set<Tab>>(new Set(["accounts"]));
  const [state, setState] = useState<UiState>(initialState);
  const pickTargetRef = useRef<"outputDir" | "backupZip">("outputDir");
  const lastRequestRef = useRef<RequestMessage | undefined>();
  const [pendingLockDetails, setPendingLockDetails] = useState<LockDetails | undefined>();

  function dispatch(message: RequestMessage): void {
    lastRequestRef.current = message;
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
          outputDir: normalizeOutputDirValue(s.outputDir).trim().length > 0 ? normalizeOutputDirValue(s.outputDir) : msg.payload.defaultOutputDir
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
        setState((s) => ({ ...s, logs: [...s.logs, `[${msg.payload.level}] ${msg.payload.message}`] }));
        return;
      }

      if (msg.type === "TASK_RESULT") {
        if (msg.payload.action === "killProcesses") {
          // 接续之前的挂起操作
          if (lastRequestRef.current) {
            post(lastRequestRef.current);
          }
          return;
        }
        return;
      }

      if (msg.type === "TASK_ERROR") {
        if (msg.payload.code === "E_FILE_LOCKED") {
          setPendingLockDetails({ busy: msg.payload.details?.busy as BusyProcess[] });
          return;
        }
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
    setState((s) => ({ ...s, [field]: value }));
  }

  function pushLocalError(message: string): void {
    setState((s) => ({ ...s, lastError: message, logs: [...s.logs, `[error] ${message}`] }));
  }

  return (
    <main>
      <header>
        <h1>Codex 迁移助手</h1>
        <p>VS Code 扩展 · TypeScript 迁移引擎</p>
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
                backupBeforeSwitch={state.backupBeforeSwitch}
                newProfileName={state.newProfileName}
                onChange={onChange}
                onRefresh={() => dispatch({ type: "REFRESH_PROFILES", payload: { codexHome: state.codexHome } })}
                onRefreshUsage={(profileId) => dispatch({ type: "REFRESH_PROFILE_USAGE", payload: { codexHome: state.codexHome, profileId } })}
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
                      mergeFromCurrentCore: false
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
                      mergeFromCurrentCore: true
                    }
                  });
                }}
                onDelete={(profileId) => {
                  dispatch({ type: "DELETE_PROFILE", payload: { codexHome: state.codexHome, profileId } });
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
                      mode: "core"
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
