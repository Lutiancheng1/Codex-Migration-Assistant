export function RiskConfirmDialog(props: { enabled: boolean }): JSX.Element {
  return (
    <section className="card risk">
      <h3>风险提示</h3>
      {props.enabled ? <p>已启用高风险选项，请确认后再执行导入/导出。</p> : <p>当前未启用高风险选项。</p>}
    </section>
  );
}
