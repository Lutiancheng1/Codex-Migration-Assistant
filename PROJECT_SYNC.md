# Codex 迁移助手接力文档

最后更新：2026-04-29

## 项目定位

- 项目名：`codex-migration-extension`
- 展示名：`Codex 迁移助手`
- 项目类型：代码项目，按 `Git + PROJECT_SYNC.md` 接力
- 本地目录：`/Users/lutiancheng/lifeSpaces/codex-migration-extension`
- 远端仓库：`https://github.com/Lutiancheng1/Codex-Migration-Assistant.git`
- 技术栈：`VS Code Webview + React + TypeScript + Node.js`

## 当前主线

这个项目现在的核心不是基础导出导入，而是继续把 `pool-runner` 专用槽位、账号池切换、额度刷新、列表排序和大数据量场景下的性能问题收口。默认把它当成“Codex 迁移与账号池管理扩展”，不要再回到通用多客户端工具路线。

## 最近一次接力来源

- 归档会话：`019cdace-30e5-79e1-8738-0c935b5188dc`
- 历史 handoff：`/Users/lutiancheng/openclaw-workspace/workspace-hub/projects/codex-migration-extension/session-archive/019cdace-30e5-79e1-8738-0c935b5188dc/handoff.md`
- 项目内现有 handoff：`HANDOFF.md`

## 当前已知基线

- `.codex` 导出 / 导入 ZIP 已具备
- 多账号槽位、切换 / 合并 / 覆盖 / 删除已具备
- `pool-runner` 专用账号池运行模型已进入主线
- token pool 的导入、单条刷新、按分类批量刷新、定时整池顺序刷新和可选切换后自动重启已存在
- Codex 用量刷新已接入 CLIProxyAPI 同款 refresh_token 续期逻辑，刷新前会尝试续 access/id/refresh token 并写回本地
- 当前重点改动已经推进到：
  - profile 与 token pool 拖拽排序
  - `live` 行与可持久化 profile 排序解耦
  - token pool 列表最多显示 6 条、内部滚动并自动滚到当前账号
  - `SWITCH_TO_POOL_RUNNER` 行为修复
  - token pool 状态快照去重
  - token pool 按 Free / Plus / Team / Pro 分类批量刷新

## 当前未收口重点

1. `pool-runner` 专用槽位模型继续验证
2. 大量池账号下的性能与稳定性继续压测
3. 会话清理在损坏 SQLite 下的边界继续验证
4. 打包链路与 Node 版本兼容继续收口
5. refresh_token 失效、网络失败、并发刷新下的续期边界继续压测

## 接手顺序

1. 先读 `PROJECT_SYNC.md`
2. 再读 `HANDOFF.md`
3. 再看 `README.md`
4. 再根据任务进入 `src/engine/`、`src/ui-host/` 和 `webview/`

## 关键文件

- `HANDOFF.md`
- `src/engine/threadCleanup.ts`
- `src/engine/exporter.ts`
- `src/engine/stateReplace.ts`
- `src/engine/tokenPool.ts`
- `webview/src/pages/TokenPoolPanel.tsx`

## 同步规则

- 跨机器接力时，以仓库代码 + 本文件 + `HANDOFF.md` 为准
- 长聊天记录不是事实源，最多只做辅助追溯
- 每次做了真实改动，至少更新一次本文件或 `HANDOFF.md`

## 本次备注

- 本轮工作树里原本就存在未提交的 token pool / pool-runner 相关改动
- 这次提交会把这些已有改动与本文件一起收口，不应把它们误当成噪音回滚
