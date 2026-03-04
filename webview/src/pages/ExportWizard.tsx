import type { MigrationMode } from "../api/types";

type Props = {
  codexHome: string;
  outputDir: string;
  includeState: boolean;
  includeAuth: boolean;
  mode: MigrationMode;
  onChange(field: string, value: string | boolean): void;
  onPickOutputDir(): void;
  onRun(): void;
};

export function ExportWizard(props: Props): JSX.Element {
  const canRun = props.outputDir.trim().length > 0;
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
            <button onClick={props.onPickOutputDir}>选择</button>
          </div>
        </label>
        <label>
          迁移模式
          <select value={props.mode} onChange={(e) => props.onChange("mode", e.target.value)}>
            <option value="core">仅核心 (.codex)</option>
            <option value="enhanced">核心 + 编辑器状态</option>
          </select>
        </label>
        <div className="toggle-row">
          <label className="check-row">
            <span className="check-text">包含 state_*.sqlite*</span>
            <input
              type="checkbox"
              checked={props.includeState}
              onChange={(e) => props.onChange("includeState", e.target.checked)}
              aria-label="包含 state 数据"
            />
          </label>
          <label className="check-row">
            <span className="check-text">包含 auth 文件（敏感）</span>
            <input
              type="checkbox"
              checked={props.includeAuth}
              onChange={(e) => props.onChange("includeAuth", e.target.checked)}
              aria-label="包含 auth 文件"
            />
          </label>
        </div>
      </div>
      {!canRun ? <p className="error">请先选择导出目录。</p> : null}
      <button className="primary" onClick={props.onRun} disabled={!canRun}>执行导出</button>
    </section>
  );
}
