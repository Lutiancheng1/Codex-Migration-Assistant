import type { ClientProvider } from "../api/types";
import { InfoHint } from "../components/InfoHint";

type Props = {
  codexHome: string;
  outputDir: string;
  selectedProviders: ClientProvider[];
  includeState: boolean;
  includeAuth: boolean;
  onChange(field: string, value: string | boolean): void;
  onPickOutputDir(): void;
  onOpenOutputDir(): void;
  onToggleProvider(providerId: ClientProvider): void;
  onRun(): void;
};

const PROVIDER_OPTIONS: Array<{ id: ClientProvider; label: string }> = [
  { id: "codex", label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "cursor", label: "Cursor" }
];

export function ExportWizard(props: Props): JSX.Element {
  const canRun = props.outputDir.trim().length > 0 && props.selectedProviders.length > 0;
  return (
    <section>
      <h3>配置与执行</h3>
      <div className="grid">
        <label>
          Codex 目录
          <input value={props.codexHome} onChange={(e) => props.onChange("codexHome", e.target.value)} />
        </label>
        <label>
          导出目录
          <div className="file-pick-row">
            <input value={props.outputDir} onChange={(e) => props.onChange("outputDir", e.target.value)} />
            <button
              className="path-icon-btn"
              onClick={props.onOpenOutputDir}
              title="打开导出目录（系统文件管理器）"
              aria-label="打开导出目录"
            >
              ↗
            </button>
            <button onClick={props.onPickOutputDir}>选择</button>
          </div>
        </label>
        <div>
          <div className="label-title">客户端选择</div>
          <div className="toggle-row">
            {PROVIDER_OPTIONS.map((item) => (
              <label key={item.id} className="check-row">
                <span className="check-text">{item.label}</span>
                <input
                  type="checkbox"
                  checked={props.selectedProviders.includes(item.id)}
                  onChange={() => props.onToggleProvider(item.id)}
                  aria-label={`导出 ${item.label}`}
                />
              </label>
            ))}
          </div>
        </div>
        <div className="toggle-row">
          <label className="check-row">
            <span className="check-text">
              包含 state_*.sqlite*
              <InfoHint
                label="state 文件说明"
                tip="主要是本地索引和界面状态缓存。不包含时仍可迁移核心数据，但首次切换后列表可能短暂不同步。"
              />
            </span>
            <input
              type="checkbox"
              checked={props.includeState}
              onChange={(e) => props.onChange("includeState", e.target.checked)}
              aria-label="包含 state 数据"
            />
          </label>
          <label className="check-row">
            <span className="check-text">
              包含 auth 文件（敏感）
              <InfoHint
                label="auth 文件说明"
                tip="登录态文件。勾选后可快捷迁移登录状态，但有账号串用或会话失效风险，建议仅在可信设备使用。"
              />
            </span>
            <input
              type="checkbox"
              checked={props.includeAuth}
              onChange={(e) => props.onChange("includeAuth", e.target.checked)}
              aria-label="包含 auth 文件"
            />
          </label>
        </div>
      </div>
      {!canRun ? <p className="error">请先选择导出目录并至少勾选一个客户端。</p> : null}
      <button className="primary" onClick={props.onRun} disabled={!canRun}>执行导出</button>
    </section>
  );
}
