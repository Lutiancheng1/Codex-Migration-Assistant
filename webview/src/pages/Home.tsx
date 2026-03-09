export function Home(props: { platform: string; codexHome: string }): JSX.Element {
  return (
    <section className="card hero">
      <h2>Codex 迁移助手</h2>
      <p>把 Codex 的对话记录、历史状态和登录信息分成三类场景来处理：跨设备同步用导出 / 导入，本机完整多账号切换用账号槽位，只换登录态用账号池。</p>
      <div className="hero-points">
        <p>1. 想在多台设备之间同步之前的会话记录和上下文，用导出 / 导入 `.codex` 数据。</p>
        <p>2. 想在当前设备上管理多个完整账号目录，用账号槽位切换、切换并合并、切换并覆盖。</p>
        <p>3. 想在当前设备上只换登录态、不动记录，用账号池；账号池只操作 `pool-runner` 专用槽位，额度不足时可自动切到下一个账号。</p>
      </div>
      <p><strong>当前平台：</strong> {props.platform || "未知"}</p>
      <p><strong>检测到的 Codex 目录：</strong> {props.codexHome || "未解析"}</p>
    </section>
  );
}
