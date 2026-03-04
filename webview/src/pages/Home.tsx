export function Home(props: { platform: string; codexHome: string }): JSX.Element {
  return (
    <section className="card hero">
      <h2>Codex 迁移助手</h2>
      <p>支持 Codex App 与 VS Code 扩展之间的数据迁移。</p>
      <p><strong>当前平台：</strong> {props.platform || "未知"}</p>
      <p><strong>检测到的 Codex 目录：</strong> {props.codexHome || "未解析"}</p>
    </section>
  );
}
