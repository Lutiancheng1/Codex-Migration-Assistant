import { InfoHint } from "../components/InfoHint";

type Props = {
  codexHome: string;
  backupZip: string;
  importProfileName: string;
  replaceState: boolean;
  importAuth: boolean;
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
          导入为新账号
          <input
            placeholder="输入新账号名称，例如：备份导入账号"
            value={props.importProfileName}
            onChange={(e) => props.onChange("importProfileName", e.target.value)}
          />
        </label>
        <div className="toggle-row">
          <label className="check-row">
            <span className="check-text">
              替换本地 state 文件
              <InfoHint
                label="替换 state 说明"
                tip="用于恢复导入包里的本地索引与界面状态。可能覆盖当前本机缓存，建议先备份。"
              />
            </span>
            <input
              type="checkbox"
              checked={props.replaceState}
              onChange={(e) => props.onChange("replaceState", e.target.checked)}
              aria-label="替换本地 state 文件"
            />
          </label>
          <label className="check-row">
            <span className="check-text">
              导入 auth 文件（高风险）
              <InfoHint
                label="导入 auth 说明"
                tip="导入登录态文件。适合可信设备的快速迁移，不建议跨人共享，可能触发重新登录或权限异常。"
              />
            </span>
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
