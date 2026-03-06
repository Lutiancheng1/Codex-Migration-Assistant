import type { ExportResult, ImportResult, PreviewResult, SwitchProfileResult } from "../api/types";

type ResultData = ExportResult | ImportResult | PreviewResult | SwitchProfileResult;

function isExportResult(data: ResultData): data is ExportResult {
  return "zipPath" in data;
}

function isImportResult(data: ResultData): data is ImportResult {
  return "reportPath" in data;
}

function isSwitchResult(data: ResultData): data is SwitchProfileResult {
  return "targetProfileId" in data;
}

export function RunResult(props: { data?: ResultData; error?: string }): JSX.Element {
  const data = props.data;
  return (
    <section className="card">
      <h3>最新结果</h3>
      {props.error ? <p className="error">{props.error}</p> : null}
      {!data ? <p>暂无执行结果。</p> : (
        <>
          {"mode" in data ? <p><strong>模式：</strong> {data.mode}</p> : null}
          {isExportResult(data) ? (
            <>
              <p><strong>导出 ZIP：</strong> {data.zipPath}</p>
              <p><strong>导出项：</strong> {data.copiedItems.join(", ") || "(无)"}</p>
              {data.warnings.length > 0 ? <ul>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
            </>
          ) : null}
          {isImportResult(data) ? (
            <>
              <p><strong>报告路径：</strong> {data.reportPath}</p>
              {data.warnings.length > 0 ? <ul>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
            </>
          ) : null}
          {isSwitchResult(data) ? (
            <>
              <p><strong>目标账号：</strong> {data.targetProfileId}</p>
              <p><strong>切换前备份：</strong> {data.backupCurrent ? "是" : "否"}</p>
              <p><strong>切换模式：</strong> {data.switchMode === "overwrite" ? "切换并覆盖" : data.switchMode === "merge" ? "切换并合并" : "普通切换"}</p>
              <p><strong>恢复启动：</strong> {data.relaunchedClients.length > 0 ? data.relaunchedClients.join(", ") : "(无)"}</p>
              {data.messages.length > 0 ? <ul>{data.messages.map((m) => <li key={m}>{m}</li>)}</ul> : null}
            </>
          ) : null}
          {!isExportResult(data) && !isImportResult(data) && !isSwitchResult(data) ? (
            <p><strong>预演已完成。</strong> 请查看上方统计卡片与冲突表。</p>
          ) : null}
        </>
      )}
    </section>
  );
}
