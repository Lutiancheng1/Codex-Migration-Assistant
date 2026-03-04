import type { MigrationMode } from "../api/types";

type Props = {
  codexHome: string;
  backupZip: string;
  importProfileName: string;
  replaceState: boolean;
  importAuth: boolean;
  mode: MigrationMode;
  onChange(field: string, value: string | boolean): void;
  onPickZip(): void;
  onPickZipFromDefault(): void;
  onPreview(): void;
  onRunImport(): void;
  onRunImportToNewProfile(): void;
};

export function ImportWizard(props: Props): JSX.Element {
  const canRun = props.backupZip.trim().length > 0;
  return (
    <section>
      <div className="grid">
        <label>
          Codex 目录
          <input value={props.codexHome} onChange={(e) => props.onChange("codexHome", e.target.value)} />
        </label>
        <label>
          备份 ZIP
          <div className="row import-zip-row">
            <input value={props.backupZip} onChange={(e) => props.onChange("backupZip", e.target.value)} />
            <button onClick={props.onPickZip}>选择</button>
            <button onClick={props.onPickZipFromDefault}>默认目录</button>
          </div>
        </label>
        <label>
          迁移模式
          <select value={props.mode} onChange={(e) => props.onChange("mode", e.target.value)}>
            <option value="core">仅核心 (.codex)</option>
            <option value="enhanced">核心 + 编辑器状态</option>
          </select>
        </label>
        <label>
          导入为新账号
          <input
            placeholder="输入新账号名称，例如：备份导入账号"
            value={props.importProfileName}
            onChange={(e) => props.onChange("importProfileName", e.target.value)}
          />
        </label>
        <div className="toggle-row">
          <label className="check-row">
            <span className="check-text">替换本地 state 文件</span>
            <input
              type="checkbox"
              checked={props.replaceState}
              onChange={(e) => props.onChange("replaceState", e.target.checked)}
              aria-label="替换本地 state 文件"
            />
          </label>
          <label className="check-row">
            <span className="check-text">导入 auth 文件（高风险）</span>
            <input
              type="checkbox"
              checked={props.importAuth}
              onChange={(e) => props.onChange("importAuth", e.target.checked)}
              aria-label="导入 auth 文件"
            />
          </label>
        </div>
      </div>
      {!canRun ? <p className="error">请先选择备份 ZIP 文件。</p> : null}
      <div className="action-row">
        <button onClick={props.onPreview} disabled={!canRun}>预演导入</button>
        <button onClick={props.onRunImportToNewProfile} disabled={!canRun || props.importProfileName.trim().length === 0}>导入为新账号</button>
        <button className="primary" onClick={props.onRunImport} disabled={!canRun}>执行导入</button>
      </div>
    </section>
  );
}
