import type { ExportResult, ImportResult, PreviewResult } from "@codex-migration/shared-contracts";
import { formatTime } from "./desktopUi";

type Props = {
  codexHome: string;
  outputDir: string;
  defaultOutputDir: string;
  exportScope: "active" | "all";
  includeState: boolean;
  includeAuth: boolean;
  backupZip: string;
  importProfileName: string;
  replaceState: boolean;
  importAuth: boolean;
  previewData?: PreviewResult;
  exportResult?: ExportResult;
  importResult?: ImportResult;
  errorMessage?: string;
  onChange(field: string, value: string | boolean): void;
  onPickOutputDir(): void;
  onOpenOutputDir(): void;
  onPickZip(): void;
  onPickZipFromDefault(): void;
  onRunExport(): void;
  onPreviewImport(): void;
  onRunImport(): void;
  onRunImportToNewProfile(): void;
};

function statLine(label: string, value: number): JSX.Element {
  return (
    <div className="desktop-mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DesktopMigrationPage(props: Props): JSX.Element {
  const canExport = props.outputDir.trim().length > 0;
  const canImport = props.backupZip.trim().length > 0;

  return (
    <div className="desktop-panel-stack">
      {props.errorMessage ? <div className="error">{props.errorMessage}</div> : null}
      <div className="desktop-dual-grid">
        <section className="desktop-form-card">
          <header className="desktop-subsection-header">
            <div>
              <h3>导出</h3>
              <p>导出当前账号或全部账号，按需包含 state 和 auth。</p>
            </div>
          </header>

          <div className="desktop-form-grid">
            <label className="desktop-field">
              <span>Codex 目录</span>
              <input
                value={props.codexHome}
                onChange={(event) => props.onChange("codexHome", event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canExport) {
                    event.preventDefault();
                    props.onRunExport();
                  }
                }}
              />
            </label>

            <label className="desktop-field">
              <span>导出目录</span>
              <div className="desktop-input-with-actions">
                <input value={props.outputDir} onChange={(event) => props.onChange("outputDir", event.target.value)} />
                <button type="button" onClick={props.onOpenOutputDir}>打开</button>
                <button type="button" onClick={props.onPickOutputDir}>选择</button>
              </div>
            </label>

            <label className="desktop-field">
              <span>导出范围</span>
              <select value={props.exportScope} onChange={(event) => props.onChange("exportScope", event.target.value as "active" | "all")}>
                <option value="active">当前账号</option>
                <option value="all">全部账号（批量导出）</option>
              </select>
            </label>

            <div className="desktop-toggle-grid">
              <label className="desktop-toggle desktop-toggle-card">
                <span>包含 state_*.sqlite*</span>
                <input
                  type="checkbox"
                  checked={props.includeState}
                  onChange={(event) => props.onChange("includeState", event.target.checked)}
                />
              </label>
              <label className="desktop-toggle desktop-toggle-card">
                <span>包含 auth 文件（敏感）</span>
                <input
                  type="checkbox"
                  checked={props.includeAuth}
                  onChange={(event) => props.onChange("includeAuth", event.target.checked)}
                />
              </label>
            </div>
          </div>

          {!canExport ? <p className="warning">请先选择导出目录。</p> : null}

          <div className="desktop-inline-actions">
            <button className="primary" onClick={props.onRunExport} disabled={!canExport}>执行导出</button>
            <button onClick={props.onOpenOutputDir} disabled={(props.outputDir || props.defaultOutputDir).trim().length === 0}>打开当前导出目录</button>
          </div>
        </section>

        <section className="desktop-form-card">
          <header className="desktop-subsection-header">
            <div>
              <h3>导入</h3>
              <p>先预演，再导入到当前环境或新账号槽位。</p>
            </div>
          </header>

          <div className="desktop-form-grid">
            <label className="desktop-field">
              <span>Codex 目录</span>
              <input
                value={props.codexHome}
                onChange={(event) => props.onChange("codexHome", event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canImport) {
                    event.preventDefault();
                    props.onPreviewImport();
                  }
                }}
              />
            </label>

            <label className="desktop-field">
              <span>备份 ZIP</span>
              <div className="desktop-input-with-actions">
                <input value={props.backupZip} onChange={(event) => props.onChange("backupZip", event.target.value)} />
                <button type="button" onClick={props.onPickZip}>选择</button>
                <button type="button" onClick={props.onPickZipFromDefault}>默认目录</button>
              </div>
            </label>

            <label className="desktop-field">
              <span>导入为新账号</span>
              <input
                placeholder="例如：备份导入账号"
                value={props.importProfileName}
                onChange={(event) => props.onChange("importProfileName", event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canImport) {
                    event.preventDefault();
                    if (props.importProfileName.trim().length > 0) {
                      props.onRunImportToNewProfile();
                    } else {
                      props.onPreviewImport();
                    }
                  }
                }}
              />
            </label>

            <div className="desktop-toggle-grid">
              <label className="desktop-toggle desktop-toggle-card">
                <span>替换本地 state 文件</span>
                <input
                  type="checkbox"
                  checked={props.replaceState}
                  onChange={(event) => props.onChange("replaceState", event.target.checked)}
                />
              </label>
              <label className="desktop-toggle desktop-toggle-card">
                <span>导入 auth 文件（高风险）</span>
                <input
                  type="checkbox"
                  checked={props.importAuth}
                  onChange={(event) => props.onChange("importAuth", event.target.checked)}
                />
              </label>
            </div>
          </div>

          {!canImport ? <p className="warning">请先选择备份 ZIP 文件。</p> : null}

          <div className="desktop-inline-actions">
            <button onClick={props.onPreviewImport} disabled={!canImport}>预演导入</button>
            <button onClick={props.onRunImportToNewProfile} disabled={!canImport || props.importProfileName.trim().length === 0}>导入为新账号</button>
            <button className="primary" onClick={props.onRunImport} disabled={!canImport}>执行导入</button>
          </div>
        </section>
      </div>

      <div className="desktop-dual-grid">
        <section className="desktop-info-card desktop-result-surface">
          <h4>最近预演</h4>
          {!props.previewData ? <p>暂无预演结果。</p> : (
            <>
              <p className="desktop-result-headline">
                模式 {props.previewData.mode} · ZIP {props.previewData.backupZip}
              </p>
              <div className="desktop-mini-stat-grid">
                {statLine("会话新增", props.previewData.sessions.newCount)}
                {statLine("会话冲突", props.previewData.sessions.conflictCount)}
                {statLine("规则冲突", props.previewData.rules.conflictCount)}
                {statLine("技能冲突", props.previewData.skills.conflictCount)}
                {statLine("历史追加", props.previewData.history.appended)}
                {statLine("锁定项", props.previewData.sessions.lockedCount + props.previewData.rules.lockedCount + props.previewData.skills.lockedCount)}
              </div>
              {props.previewData.warnings.length > 0 ? (
                <div className="desktop-warning-list">
                  {props.previewData.warnings.map((warning) => <p key={warning} className="warning">{warning}</p>)}
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="desktop-info-card desktop-result-surface">
          <h4>最近导入 / 导出</h4>
          {props.exportResult ? (
            <div className="desktop-result-block">
              <strong>最近导出</strong>
              <p>ZIP：{props.exportResult.zipPath}</p>
              <p>范围：{props.exportResult.scope || "single"} · 模式：{props.exportResult.mode}</p>
              {props.exportResult.warnings.length > 0 ? <p className="warning">{props.exportResult.warnings.slice(0, 3).join("；")}</p> : null}
            </div>
          ) : null}
          {props.importResult ? (
            <div className="desktop-result-block">
              <strong>最近导入</strong>
              <p>报告：{props.importResult.reportPath}</p>
              <p>ZIP：{props.importResult.backupZip}</p>
              <p>模式：{props.importResult.mode}</p>
              {props.importResult.warnings.length > 0 ? <p className="warning">{props.importResult.warnings.slice(0, 3).join("；")}</p> : null}
            </div>
          ) : null}
          {!props.exportResult && !props.importResult ? <p>还没有执行导入或导出。</p> : null}
          <p className="desktop-result-footnote">最近更新时间：{formatTime(new Date().toISOString())}</p>
        </section>
      </div>
    </div>
  );
}
