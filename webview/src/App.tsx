import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "./api/vscodeBridge";
import type { ExportResult, ImportResult, PreviewResult as PreviewResultData, RequestMessage, ResponseMessage, SamplesByDomain } from "./api/types";
import { ConflictTable } from "./components/ConflictTable";
import { ProgressPanel } from "./components/ProgressPanel";
import { RiskConfirmDialog } from "./components/RiskConfirmDialog";
import { SummaryCard } from "./components/SummaryCard";
import { AccountsManager } from "./pages/AccountsManager";
import { Home } from "./pages/Home";
import { ExportWizard } from "./pages/ExportWizard";
import { ImportWizard } from "./pages/ImportWizard";
import { PreviewResult } from "./pages/PreviewResult";
import { RunResult } from "./pages/RunResult";
import { initialState, type UiState } from "./state/store";
import "./styles.css";

type Tab = "export" | "import" | "accounts";
type ResultData = ExportResult | PreviewResultData | ImportResult;
type ConflictRow = {
  domain: "sessions" | "rules" | "skills" | "editorState";
  path: string;
  type: "conflict" | "locked";
};

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

function dispatch(message: RequestMessage): void {
  post(message);
}

function hasSamples(data: ResultData): data is PreviewResultData | ImportResult {
  return "conflictSamples" in data && "lockedSamples" in data;
}

function mapRows(kind: "conflict" | "locked", samples: SamplesByDomain): ConflictRow[] {
  const domains: Array<keyof SamplesByDomain> = ["sessions", "rules", "skills", "editorState"];
  const out: ConflictRow[] = [];
  for (const domain of domains) {
    for (const item of samples[domain]) {
      out.push({ domain, path: item, type: kind });
    }
  }
  return out;
}

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("export");
  const [state, setState] = useState<UiState>(initialState);
  const [lastPreview, setLastPreview] = useState<PreviewResultData>();
  const pickTargetRef = useRef<"outputDir" | "backupZip">("outputDir");

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
        if (msg.payload.action === "previewImport") {
          setLastPreview(msg.payload.data as PreviewResultData);
        }
        setState((s) => ({ ...s, lastResult: msg.payload.data, lastError: undefined }));
        return;
      }

      if (msg.type === "TASK_ERROR") {
        setState((s) => ({ ...s, lastError: `${msg.payload.code}: ${msg.payload.message}` }));
      }
    };

    window.addEventListener("message", handler as EventListener);
    dispatch({ type: "INIT" });
    return () => window.removeEventListener("message", handler as EventListener);
  }, []);

  const hasRisk = useMemo(() => state.includeAuth || state.importAuth || state.replaceState, [state.includeAuth, state.importAuth, state.replaceState]);
  const isAccountsTab = tab === "accounts";
  const conflictRows = useMemo(() => {
    const rows: ConflictRow[] = [];
    if (lastPreview && hasSamples(lastPreview)) {
      rows.push(...mapRows("conflict", lastPreview.conflictSamples));
      rows.push(...mapRows("locked", lastPreview.lockedSamples));
    }
    if (state.lastResult && hasSamples(state.lastResult)) {
      const sampled = state.lastResult;
      rows.push(...mapRows("conflict", sampled.conflictSamples));
      rows.push(...mapRows("locked", sampled.lockedSamples));
    }
    return rows.slice(0, 200);
  }, [lastPreview, state.lastResult]);

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

      <nav className="tabs">
        <button className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>导出</button>
        <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}>导入</button>
        <button className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>账号</button>
      </nav>

      {tab === "export" ? (
        <ExportWizard
          codexHome={state.codexHome}
          outputDir={state.outputDir}
          includeState={state.includeState}
          includeAuth={state.includeAuth}
          mode={state.mode}
          onChange={onChange}
          onPickOutputDir={() => {
            pickTargetRef.current = "outputDir";
            dispatch({ type: "PICK_PATH", payload: { kind: "folder", title: "选择导出目录" } });
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
                mode: state.mode
              }
            });
          }}
        />
      ) : tab === "import" ? (
        <ImportWizard
          codexHome={state.codexHome}
          backupZip={state.backupZip}
          importProfileName={state.importProfileName}
          replaceState={state.replaceState}
          importAuth={state.importAuth}
          mode={state.mode}
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
                mode: state.mode
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
                mode: state.mode
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
                mode: state.mode,
                profileName
              }
            });
          }}
        />
      ) : (
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
            const target = state.profiles.find((item) => item.id === profileId);
            if (!target) {
              return;
            }
            if (!window.confirm(`确定切换到 "${target.name}" 并合并当前账号的聊天数据吗？`)) {
              return;
            }
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
      )}

      {!isAccountsTab ? (
        <>
          <RiskConfirmDialog enabled={hasRisk} />
          <ProgressPanel percent={state.progressPercent} message={state.progressMessage} />
          <SummaryCard title="执行日志">
            <pre className="log-pre">{state.logs.length ? state.logs.join("\n") : "暂无日志。"}</pre>
          </SummaryCard>
          <PreviewResult data={lastPreview} />
          <ConflictTable rows={conflictRows} />
          <RunResult data={state.lastResult} error={state.lastError} />
        </>
      ) : (
        <SummaryCard title="最近日志">
          <pre className="log-pre">{state.logs.length ? state.logs.slice(-8).join("\n") : "暂无日志。"}</pre>
        </SummaryCard>
      )}
    </main>
  );
}
