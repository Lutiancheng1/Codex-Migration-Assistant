type ConflictRow = {
  domain: "sessions" | "rules" | "skills" | "editorState";
  path: string;
  type: "conflict" | "locked";
};

export function ConflictTable(props: { rows: ConflictRow[] }): JSX.Element {
  return (
    <section className="card">
      <h3>冲突与锁定样本</h3>
      {props.rows.length === 0 ? <p>暂无冲突记录。</p> : (
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>域</th>
              <th>路径</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={`${row.type}:${row.domain}:${row.path}`}>
                <td>{row.type}</td>
                <td>{row.domain}</td>
                <td>{row.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
