export function ProgressPanel(props: { percent: number; message: string }): JSX.Element {
  return (
    <section className="card">
      <h3>任务进度</h3>
      <div className="progress-track">
        <div className="progress-value" style={{ width: `${Math.max(0, Math.min(100, props.percent))}%` }} />
      </div>
      <p>{props.percent}% · {props.message}</p>
    </section>
  );
}
