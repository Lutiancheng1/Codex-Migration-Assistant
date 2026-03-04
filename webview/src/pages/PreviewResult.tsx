import type { PreviewResult as PreviewResultType } from "../api/types";

function statLine(label: string, val: number): JSX.Element {
  return <li><strong>{label}:</strong> {val}</li>;
}

export function PreviewResult(props: { data?: PreviewResultType }): JSX.Element {
  const data = props.data;
  return (
    <section className="card">
      <h3>预演结果</h3>
      {!data ? <p>暂无预演结果。</p> : (
        <>
          <p><strong>模式：</strong> {data.mode}</p>
          <p><strong>备份 ZIP：</strong> {data.backupZip}</p>
          <div className="result-grid">
            <article>
              <h4>会话</h4>
              <ul>
                {statLine("新增", data.sessions.newCount)}
                {statLine("相同", data.sessions.sameCount)}
                {statLine("冲突", data.sessions.conflictCount)}
                {statLine("锁定", data.sessions.lockedCount)}
              </ul>
            </article>
            <article>
              <h4>规则</h4>
              <ul>
                {statLine("新增", data.rules.newCount)}
                {statLine("相同", data.rules.sameCount)}
                {statLine("冲突", data.rules.conflictCount)}
                {statLine("锁定", data.rules.lockedCount)}
              </ul>
            </article>
            <article>
              <h4>技能</h4>
              <ul>
                {statLine("新增", data.skills.newCount)}
                {statLine("相同", data.skills.sameCount)}
                {statLine("冲突", data.skills.conflictCount)}
                {statLine("锁定", data.skills.lockedCount)}
              </ul>
            </article>
            <article>
              <h4>历史</h4>
              <ul>
                {statLine("追加", data.history.appended)}
                {statLine("相同", data.history.same)}
              </ul>
            </article>
          </div>
          {data.warnings.length > 0 ? (
            <div className="warnings">
              <h4>告警</h4>
              <ul>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
