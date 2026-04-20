# Codex Migration Extension Rules

开始任何工作前，必须先读：

- `HANDOFF.md`

## 项目定位

这是一个面向 Codex 的 VS Code / Webview 扩展项目，不是通用 Flask/Streamlit 工具，也不是桌面 Tauri 项目。

当前重点方向是：

- 账号切换
- 数据迁移 / 备份恢复
- 会话清理
- 用量查询
- token pool / 自动切换

## 必做规则

1. 新对话进入本项目时，先基于 `HANDOFF.md` 总结当前状态，再开始工作。
2. 只要做了任何实际修改，结束前必须更新 `HANDOFF.md`。
3. 如果本次修改涉及当前进行中的 token pool 改动，必须在 `HANDOFF.md` 里同步记录：
   - 改到了哪里
   - 还差什么
   - 哪些文件不能误回滚
4. 如果发现 `HANDOFF.md` 与工作树现状不一致，先修正文档，再继续推进。
5. 只要本次修改会影响用户需要安装扩展后才能验证的行为或 UI，结束前必须本地重新打包 `.vsix`：
   - 默认执行 `npm run package:vsix`
   - 不要停留在“代码已改完但未打包”的状态
   - 回复里必须明确给出最新本地 `.vsix` 路径，方便用户直接安装验证

## 额外注意

- 本项目涉及 `auth.json`、`cap_sid`、token 等敏感数据，任何设计或文档都要明确风险边界
- 图标、打包、Webview 宿主适配属于高频问题，处理前优先确认 `package.json`、`src/extension.ts`、`media/` 与 `webview/` 的联动关系
