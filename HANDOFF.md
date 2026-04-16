# Codex Migration Extension Handoff

最后更新：2026-04-16（扩展版本升到 1.0.4，重打 VSIX；用量失败提示已收敛并拆分；桌面版已切到 Apple/macOS 风格新壳）

## 项目快照

- 项目名：`codex-migration-extension`
- 展示名：`Codex 迁移助手`
- 当前版本：`1.0.4`
- 形态：VS Code / Codex Webview 扩展
- 技术栈：TypeScript、React、VS Code Webview、Node.js 20+
- 目标：面向 Codex 用户的账号切换、数据迁移、备份恢复、会话清理与用量查看

## 历史路线与定位变化

根据历史对话，这个项目的路线已经明确收敛过：

- 一开始讨论过更通用的跨客户端形态
- 后来明确收敛到“只做 Codex”
- UI 方案也从通用网页工具思路，收敛成 `VS Code Webview + React + TypeScript` 扩展

当前不要再把它当成通用多客户端管理工具，默认定位仍然是“Codex 迁移助手扩展”。

但从本次更新开始，仓库内已经新增了 **Tauri 2 macOS 独立版衍生骨架**，用于逐步把现有扩展能力演进为独立 app。现状是：

- 扩展仍然是当前可直接使用的主产品形态
- 独立版已完成 monorepo 目录、共享 contracts、共享 UI 壳、Node runner、Tauri shell 与打包链路
- 后续新增功能如果同时面向扩展和桌面端，优先考虑共享协议与共享存储，而不是各写一套

## 当前仓库里已存在的主要能力

根据 README 和代码现状，当前已具备或已接近具备的能力包括：

- 导出 `.codex` 数据为 ZIP
- 导入备份 ZIP，并支持预演
- 多账号槽位管理
- 切换 / 切换并合并 / 切换并覆盖 / 删除
- 切换前目录占用检测
- 切换完成后尝试恢复被结束的客户端进程
- 每个账号单独刷新用量
- `history.jsonl` 与 `session_index.jsonl` 的迁移与合并
- 可选迁移 `state_*.sqlite*`
- 可选迁移 `auth.json / cap_sid`
- 生成导入报告
- 按会话 ID 批量预览和清理对话
- `pool-runner` 专用账号池运行槽位
- token pool 单条额度刷新、自动切换与可选自动重启 Codex

## 已明确的核心设计决策

- 账号切换通过“账号槽位目录 + `~/.codex` 软链接”实现
- 重点适配 Codex App / Codex VS Code 扩展场景
- `Webview + React` 是当前既定 UI 方案
- 导入前预演、敏感文件风险提示、备份恢复能力都是产品主线，不能砍

## 历史上已经暴露过的重要问题

1. 活动栏图标问题
   - 历史对话里明确出现过：把 PNG 转成 SVG 后，活动栏图标渲染成“白色一片”
   - 这属于需要持续验证的兼容问题
   - 处理图标问题时优先检查：
     - `package.json`
     - `media/codex-migration.svg`
     - `media/codex-migration.png`
     - 宿主环境对 monochrome/activity bar icon 的要求

2. 长对话上下文不可靠
   - 此项目对应历史会话 `019cb6c1-d2ed-7032-bd78-eec2c51a13c4` 已非常庞大
   - 后续不要再把聊天线程当成唯一事实源

## 当前工作树状态

截至本次更新，工作树里仍存在**未提交**改动，重点已经从“基础 token pool / pool-runner”推进到“共享存储 + 独立桌面版骨架”模型：

- 已修改：
  - `.vscodeignore`
  - `package.json`
  - `package-lock.json`
  - `HANDOFF.md`
  - `src/extension.ts`
  - `src/util/logger.ts`
  - `src/engine/profiles.ts`
  - `src/engine/tokenPool.ts`
  - `src/engine/threadCleanup.ts`
  - `src/engine/usage.ts`
  - `src/protocol/messages.ts`
  - `src/ui-host/bridge.ts`
  - `webview/src/api/types.ts`
  - `webview/src/pages/AccountsManager.tsx`
  - `webview/src/state/store.ts`
- 新增未提交：
  - `packages/shared-contracts/`
  - `packages/shared-ui/`
  - `apps/desktop-macos/`
  - `src/desktop/runner.ts`
  - `src/util/sharedData.ts`
  - `src/util/sharedLock.ts`
  - `test/usage.test.mjs`

不要把这批 token pool / pool-runner / 桌面版骨架相关改动当成无关噪音回滚掉。

## 当前 token pool 改动的已知方向

token pool 已经不再按“直接改当前活动槽位 auth”理解，而是收束成下面这套模型：

- token pool 元数据与敏感 token 存储
- 条目导入（单文件 / 多文件 / 目录首层 JSON）
- 单条额度刷新
- 删除、排序移动
- 自动切换开关与轮询间隔
- Webview 面板展示
- **pool-runner 专用槽位**
- **同步当前记录到 pool-runner**
- **账号池切换只允许在 pool-runner 槽位执行**
- **切换 token 后可选自动重启 Codex**

当前实现边界：

- 账号池切换只 patch `auth.json` 的 5 个字段：
  - `last_refresh`
  - `tokens.access_token`
  - `tokens.account_id`
  - `tokens.id_token`
  - `tokens.refresh_token`
- 明确保留：
  - `cap_sid`
  - `sessions`
  - `history`
  - `state`
  - `config.toml`
- 自动切换只在**当前活动槽位是 `pool-runner`** 时生效
- 池内**不支持全量查额度**
- 只允许：
  - 当前激活池账号定时检测
  - 单条账号手动刷新额度

## 本轮新增修复（未提交）

### 0. Tauri macOS 独立版骨架已落地

本轮首次把“独立 app”从纯计划推进到可构建、可打包的仓库内实现，现状如下：

- 仓库已改成 monorepo 形态
  - `packages/shared-contracts`
  - `packages/shared-ui`
  - `apps/desktop-macos`
- 独立版前端使用顶部横向 Tab 外壳，入口包括：
  - `总览`
  - `账号`
  - `账号池`
  - `迁移`
  - `对话清理`
  - `设置`
- 桌面端不是重写业务，而是通过 `src/desktop/runner.ts` 调用现有 engine
- Tauri shell 现在通过 **内置 sidecar runner** 返回 JSON 结果给 React 前端
- 已补独立 app 图标源文件并生成 Tauri 所需图标资产

当前已验证通过：

- `npm run build:desktop`
- `cargo check --manifest-path apps/desktop-macos/src-tauri/Cargo.toml`
- `npm --workspace @codex-migration/desktop-macos run tauri:build`
- `/usr/local/bin/node --test test/*.mjs`
- sidecar 直跑烟测：
  - `initAppState`
  - `previewThreadCleanup`（显式传入 `CODEX_SQLJS_WASM_PATH`）
- `.app` bundle 内实际文件校验：
  - `Contents/MacOS/codex-desktop-runner`
  - `Contents/Resources/desktop/sql-wasm.wasm`
  - 直接运行 bundle 内 sidecar 也已通过 `initAppState / previewThreadCleanup`

本地产物路径：

- `.app`
  - `apps/desktop-macos/src-tauri/target/release/bundle/macos/Codex Migration Assistant.app`
- `.dmg`
  - 当前提交口径下，桌面 app 版本仍保持 `1.0.2`
  - 本地曾试打 `1.0.3` 的 `.dmg`，但 `bundle_dmg.sh` 失败，这部分**不纳入本次 git 提交版本**

本轮又补了一次桌面端发行收口，当前状态变成：

- `apps/desktop-macos/scripts/build-sidecar.mjs` 会把 `dist/desktop/runner.js` 打成 `src-tauri/binaries/codex-desktop-runner-$TARGET_TRIPLE`
- `src-tauri/tauri.conf.json` 已补 `bundle.externalBin`
- `src-tauri/src/lib.rs` 已改成通过 `tauri-plugin-shell` 执行 sidecar，不再调用系统全局 `node`
- `sql.js` 的 wasm 已作为 Tauri resource 一起打包，Rust 启动 sidecar 时会通过环境变量把资源路径传给 runner
- `src/util/logger.ts` 已改成宿主自适应
  - 扩展内仍写 VS Code output channel
  - sidecar / CLI 下自动退化到 console logger

当前剩余边界：

- 桌面端虽然已经不再依赖系统全局 `node`，但 sidecar 仍是由 Node runner 打包而来，不是纯 Rust 原生实现
- 共享 UI 目前还是“复用现有 Webview 组件”，还没做彻底的桌面化拆分
- 签名 / 公证 / GitHub Release 还没接入

本轮随后又补了一次桌面端 UI 打磨：

- `AccountsManager` 新增 `sectionMode`
  - 独立 app 中同一页面可以按 `accounts / tokenPool / cleanup` 分页复用
  - 桌面端不再保留扩展里的折叠式标题交互
- 新增桌面专用样式文件
  - 补了 overview hero、统计卡片、结果卡片、内联操作区
  - 给桌面端表格加了窄宽度自动隐藏低优先级列的响应式策略
  - 当前桌面端的观感已经和扩展明显区分开，不再只是“把 Webview 原封不动塞进 Tauri”

相关文件补充：

- `apps/desktop-macos/src/desktop.css`
- `apps/desktop-macos/src/App.tsx`
- `webview/src/pages/AccountsManager.tsx`

相关文件：

- `package.json`
- `packages/shared-contracts/src/index.ts`
- `packages/shared-ui/src/DesktopChrome.tsx`
- `packages/shared-ui/src/index.ts`
- `packages/shared-ui/src/styles.css`
- `apps/desktop-macos/package.json`
- `apps/desktop-macos/scripts/build-sidecar.mjs`
- `apps/desktop-macos/src/App.tsx`
- `apps/desktop-macos/src/lib/desktopClient.ts`
- `apps/desktop-macos/src-tauri/capabilities/default.json`
- `apps/desktop-macos/src-tauri/src/lib.rs`
- `apps/desktop-macos/src-tauri/tauri.conf.json`
- `src/desktop/runner.ts`
- `src/util/logger.ts`
- `src/engine/threadCleanup.ts`

### 0.1 共享写锁与共享路径协议已补齐

为了让扩展与独立 app 能直接共用 `~/.codex` / `~/.codex-profiles`，本轮补了共享路径与单写锁基础设施：

- 新增 `src/util/sharedData.ts`
  - 统一推导 `profilesRoot`
  - 统一推导 token pool `meta.v1.json / secrets.v1.json`
  - 统一推导共享锁文件路径
- 新增 `src/util/sharedLock.ts`
  - 使用 `wx` 创建锁文件
  - 扩展与桌面端统一用 `owner` 标识写入方
  - 锁冲突时返回明确错误，而不是静默覆盖
- `src/ui-host/bridge.ts` 的主要写操作已统一包在共享写锁中
- `src/desktop/runner.ts` 的写操作也走同一把锁

这意味着之后如果扩展和桌面端同时打开，共享目录至少不会被两个入口同时无保护写入。

### 0.1.1 pending / metadata schema 已继续补齐

为了让扩展和桌面端对控制文件的兼容边界更清晰，本轮把 schema 又往前收了一步：

- `thread-cleanup-pending` 持久化文件现在会显式写入 `schemaVersion: 1`
- 扩展侧和桌面侧读取 pending 文件都兼容“旧文件无 schemaVersion”的情况
- token pool metadata 现在同时保留：
  - `schemaVersion: 1`
  - `version: 1`
  这样旧共享文件仍可读取，新写入也有明确 schema 标识

相关文件：

- `src/ui-host/bridge.ts`

### 0.1.2 账号列表与账号池的用量失败提示已拆分

之前账号管理页底部只汇总 `profiles[].usageError`，账号池面板没有自己的失败摘要区，导致用户在“账号池刷新失败”场景下，只能在账号列表区域看到统一警告，感知上像是提示串位。

本轮已改成：

- 新增共享 helper `webview/src/pages/usageErrorSummary.ts`
- `AccountsManager` 底部提示文案改成：
  - `最近一次账号列表用量刷新存在失败项`
- `TokenPoolPanel` 新增独立失败摘要区，文案为：
  - `最近一次账号池用量刷新存在失败项`
- 两块区域各自只汇总自己的数据源：
  - 账号列表只看 `profiles[].usageError`
  - 账号池只看 `tokenPool.entries[].usageError`

这块行为不要再合并回“单一底部提示”，否则会继续让用户误判错误来源。

相关文件：

- `webview/src/pages/AccountsManager.tsx`
- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/pages/usageErrorSummary.ts`

### 0.1.3 macOS 独立版 UI 已开始脱离扩展外观

用户明确要求桌面版不要继续复用扩展的视觉外观，改成更接近 Apple / macOS 的窗口式体验。本轮已经先把桌面端的主壳、页面信息架构和视觉令牌整体替换了一轮，重点不是继续套 `DesktopChrome`，而是直接把 app 改成：

- 顶部 window toolbar + traffic lights 风格头部
- 顶部 segmented tabs 横向导航
- 主内容区 + 右侧 inspector 双栏工作台
- 统一的 surface card / metric tile / toolbar chip 设计语言
- light/dark 两套基于材质和毛玻璃的 macOS 风格变量

当前落地状态：

- `apps/desktop-macos/src/App.tsx`
  - 不再使用共享 `DesktopChrome`
  - 改为桌面端本地 shell、页面标题区、toolbar、侧栏、结果卡片、进度卡片
  - `overview / accounts / tokenPool / migration / cleanup / settings` 六个 tab 都已接入新结构
- `apps/desktop-macos/src/desktop.css`
  - 已从旧桌面样式整文件重写
  - 新增 macOS 风格 token、toolbar、segmented control、surface、metric、inspector、嵌入式 legacy panel override
  - 继续兼容 `AccountsManager / ExportWizard / ImportWizard` 的底层功能，但视觉上已经压进新桌面体系

本轮验证已通过：

- `npm --workspace @codex-migration/desktop-macos run build`
- `npm run build:desktop`
- `cargo check --manifest-path apps/desktop-macos/src-tauri/Cargo.toml`
- `npm --workspace @codex-migration/desktop-macos run tauri:build`
- bundle 内 sidecar 烟测：
  - `initAppState`
  - `previewThreadCleanup`

本地产物已重新生成：

- `apps/desktop-macos/src-tauri/target/release/bundle/macos/Codex Migration Assistant.app`
- `apps/desktop-macos/src-tauri/target/release/bundle/dmg/Codex Migration Assistant_1.0.2_aarch64.dmg`

当前仍然保留的边界：

- 桌面版虽然视觉层已明显脱离扩展，但功能表单内部仍复用了共享 `AccountsManager / ExportWizard / ImportWizard`
- 如果后续继续抬高标准，下一步要做的是把这些页面再拆成完全桌面专属组件，而不是只靠 override

相关文件：

- `apps/desktop-macos/src/App.tsx`
- `apps/desktop-macos/src/desktop.css`
- `src/desktop/runner.ts`
- `src/engine/tokenPool.ts`

### 0.1.2 VSIX 打包已补忽略规则

由于仓库已经变成 workspace/monorepo，`vsce package` 会把 `apps/`、`packages/` 以及 `node_modules/@codex-migration/*` 的本地链接一起带进扩展包，导致：

- 包体异常膨胀
- 甚至触发 `not a file: node_modules/@codex-migration/desktop-macos`

本轮已补 `.vscodeignore`，显式排除：

- `apps/**`
- `packages/**`
- `node_modules/@codex-migration/**`
- 本地 handoff / project sync 文档与已有 `.vsix`

现在重新执行 `npm run package:vsix` 已通过，当前最新扩展包为：

- `codex-migration-assistant-1.0.3.vsix`

当前体积：

- 541 files
- 9.75 MB

本轮额外状态：

- 根扩展版本已升到 `1.0.4`
- `codex-migration-assistant-1.0.4.vsix` 已成功打出
- 包内 `dist/engine/usage.js` 已确认包含 `used_percent = 1` 不再按 `100%` 处理的修复逻辑
- 用量刷新失败现在会优先归一化常见认证问题：
  - `token_expired / 401` -> `登录态已过期，请切换到该账号重新登录后再刷新用量`
  - 一般 `401/403` -> `登录态无效或权限不足，请重新登录后再刷新用量`
- 账号管理列表底部的失败汇总也已改成按相同原因分组，不再直接拼接原始 URL 与 HTML 片段
- 桌面端源码会一起提交，但其 manifest 版本暂保持 `1.0.2`
- 桌面端单独版本迭代、`.dmg` 失败排查与发布，留到后续再做

### 0.2 token pool 已从 VS Code storage 迁到共享文件存储

这是这轮最关键的基础改造之一，因为不先把 token pool 从 VS Code 宿主私有存储里拿出来，桌面端无法复用。

本轮已完成：

- token pool 元数据改为写入共享文件：
  - `~/.codex-profiles/token-pool/meta.v1.json`
  - `~/.codex-profiles/token-pool/secrets.v1.json`
- 保留旧版扩展 `globalState / secrets` 到共享文件的迁移逻辑
- `TokenPoolService` 已去掉对 VS Code runtime 的硬依赖
  - 旧扩展路径通过 `initializeTokenPoolService(context, notifications)` 注入 legacy storage 与 UI 提示
  - 桌面端通过 `initializeDesktopTokenPoolService()` 直接复用同一服务
- 账号池的主要写接口都已支持显式 `codexHomeOverride`

这个改动之后，token pool 不再被锁死在 Webview 扩展内部，已经具备被独立 app 复用的前提。

### 1. 账号管理与账号池支持拖拽排序

本轮新增了两套列表的持久化拖拽排序：

- 账号管理列表：
  - profile 元数据新增 `order`
  - 不再按名称排序作为最终顺序
  - 首次迁移到新模型时，旧数据按当时页面可见的名称排序初始化 `order`
  - 新增协议：`REORDER_PROFILES`
  - 新账号默认追加到末尾
- 账号池列表：
  - 新增协议：`REORDER_TOKEN_POOL_ENTRIES`
  - 拖拽后直接按新顺序持久化
  - 自动切换继续按池内当前顺序轮转
  - 保留原有“上移 / 下移”菜单作为备选入口

随后又补了两处关键修正，避免这套拖拽排序带来新的问题：

- 账号管理拖拽现在**彻底剥离 `live` 行**
  - `live` 行仍然展示，但不参与拖拽排序集合
  - 前端拖拽目标和后端真实可持久化 profile 集合保持一致
  - 避免出现“拖到 live 附近，落点和最终保存顺序不一致”的问题
- 账号池列表恢复为**窗口化渲染**
  - 不再全量 `entries.map(...)` 渲染整张表
  - 当前改成固定行高的可见区窗口化，只渲染视口附近条目
  - 仍保留 table 样式、横向滚动、sticky 操作列和拖拽排序
  - 这是为了维持之前已经明确过的产品约束：几百 / 几千个池账号也不能因为全量渲染而明显卡顿

UI 上也同步统一：

- 两个列表都增加了拖拽把手列
- 当前高亮账号 / 当前池条目仍保留高亮
- 账号池已从虚拟列表改成普通 table 结构，以保证拖拽稳定、sticky 操作列与横向滚动行为一致

相关文件：

- `src/engine/profiles.ts`
- `src/engine/tokenPool.ts`
- `src/protocol/messages.ts`
- `src/protocol/schema.ts`
- `src/ui-host/bridge.ts`
- `webview/src/App.tsx`
- `webview/src/pages/AccountsManager.tsx`
- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/api/types.ts`
- `webview/src/styles.css`

### 2. pool-runner 按钮行为修复

此前账号池面板里的“切换到 pool-runner”在未创建槽位时是禁用态，用户侧容易表现成“点击没反应”。

本轮已改成：

- 新增协议：`SWITCH_TO_POOL_RUNNER`
- 点击该按钮时：
  - 如果 `pool-runner` 不存在，先自动执行“同步当前记录到 pool-runner”
  - 然后再执行普通切换
- UI 文案也改成：
  - `创建并切换到 pool-runner`

相关文件：

- `src/protocol/messages.ts`
- `src/protocol/schema.ts`
- `webview/src/api/types.ts`
- `src/ui-host/bridge.ts`
- `webview/src/App.tsx`
- `webview/src/pages/AccountsManager.tsx`
- `webview/src/pages/TokenPoolPanel.tsx`

### 3. token pool 重复快照刷新修复

此前 token pool 的多数操作会同时触发两次整页状态刷新：

- bridge 里手动 `emitStateSnapshot`
- `tokenPoolService.onDidChange` 再触发一次

这会放大 Webview 重渲染，叠加账号页定时刷新时，更容易出现 CPU 占用升高、风扇加速、点击卡顿。

本轮已改成：

- token pool 相关操作不再显式重复发整页 snapshot
- bridge 内增加了合并调度的 `scheduleStateSnapshot`
- 多次 token pool 变化会被 80ms 内合并成一次整页刷新

相关文件：

- `src/ui-host/bridge.ts`

### 4. 账号页自动刷新 interval 稳定化

此前 `AccountsManager` 的自动刷新 interval 依赖于 props 回调与 profile 列表，整页重渲染时会频繁重建 timer。

本轮已改成：

- interval 只依赖刷新间隔本身
- 用 `ref` 读取最新 `onRefreshUsage` 和 profile 数量
- 减少无意义定时器重建

相关文件：

- `webview/src/pages/AccountsManager.tsx`

### 4. 账号池列表已收窄

此前账号池表格常驻显示了过多低频列，`min-width` 过大，导致视觉上明显比上方账号管理表更宽。

本轮已改成：

- 删除常驻“过期时间”列
- 账号列只显示邮箱或账号标识，不再额外显示 `account_id`
- 过期时间改到账号标题的 tooltip
- 表格最小宽度从 `1080px` 收窄到 `790px`
- 右侧操作列继续 sticky，交互保持和账号管理一致
- 行高进一步从 `64` 收窄到 `52`，并压缩了垂直 padding，使其更接近上方账号管理表

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`

### 5. 会话清理兼容损坏 SQLite

用户现场已经出现过 `database disk image is malformed`，此前这会导致会话清理执行阶段在打开 `state_*.sqlite` 时直接中断：

- 预览阶段会忽略坏库，因此仍可能显示“命中线程 / 命中文件”
- 执行阶段一旦某个 `state_*.sqlite` 打不开，整条账号清理会提前失败
- 结果上会表现成：
  - 删除统计几乎全是 0
  - rollout 文件其实没有进入删除逻辑
  - UI 只看到错误，但不容易理解为什么“预览能命中，执行却没删掉”

本轮已修正为：

- 单个损坏 SQLite 只记录到该账号的 `errors`
- 不再阻断同账号后续的：
  - rollout/session 文件删除
  - `.codex-global-state.json` 线程标题与顺序清理
- 若存在 SQLite 清理错误，结果仍标记 `clean=false`，避免误报“已完全清理”
- 已补单测覆盖“SQLite 损坏但 rollout/global state 仍应清掉”的回归场景

相关文件：

- `src/engine/threadCleanup.ts`
- `test/thread-cleanup.test.mjs`

### 6. 账号池自动重启 Codex 逻辑已放宽

此前 token pool 的“切换后自动重启 Codex”只在检测到当前存在占用 `.codex` 目录的 Codex 进程时才会执行：

- 先检测 busy 进程
- 再 kill
- 再恢复启动

这会导致一种误解：用户已勾选“切换后自动重启 Codex”，但如果切换瞬间没检测到占用进程，就只会提示手动重启，看起来像功能失效。

本轮已改成：

- 若检测到 busy 进程：仍按原逻辑 kill 后再重启
- 若**没检测到** busy 进程：也会直接尝试启动 `Codex`

相关文件：

- `src/engine/tokenPool.ts`

### 7. 已用尽账号禁止手动切换

当前账号池规则新增一层显式保护：

- 若池条目状态为 `exhausted`
- 手动切换按钮会被禁用，并显示 `已用尽`
- 后端 `activateEntry(..., "manual")` 也会再次拦截

这样可以避免用户手动切到一个已知额度耗尽的账号。

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`
- `src/engine/tokenPool.ts`

本轮本地校验结果：

- `npm run typecheck` 通过
- `npm run build` 通过

### 8. 修复 `SWITCH_TO_POOL_RUNNER` 在 Windows 首次切换时卡住

用户在 Windows 端首次点击“创建并切换到 pool-runner”时，流程会先同步记录，再进入真正的账号切换。

此前若切换阶段抛出 `E_FILE_LOCKED`：

- bridge 只会把 `ACTIVATE_PROFILE` 请求记录到 `pendingActivateAfterKill`
- 但 `SWITCH_TO_POOL_RUNNER` 是在 bridge 内部封装调用 `runActivateProfileRequest(...)`
- 导致杀掉占用进程后，没有任何挂起切换可以继续执行
- UI 就会停在“准备切换账号”10%

现已修复：

- 当 `SWITCH_TO_POOL_RUNNER` 流程在切换阶段遇到 `E_FILE_LOCKED`
- bridge 会显式构造一条挂起的 `ACTIVATE_PROFILE(pool-runner)`
- 用户确认结束占用进程后，`KILL_PROCESSES` 分支会继续执行真正的切换

相关文件：

- `src/ui-host/bridge.ts`

### 9. token pool 手动切换前必须先刷新并校验额度

此前账号池条目刚导入后默认是 `neverChecked`，用户直接点“切换”会立即把 `auth.json` 改掉：

- 不会先请求一次额度
- 不会先把 5 小时 / 7 天结果刷出来
- 也不会在切换前拦截 `exhausted` / `authInvalid` / `incomplete`

现已改成：

- 手动点击账号池“切换”时，先执行单条额度刷新
- 刷新结果会写回列表
- 然后再按状态决定是否允许切换

当前拦截规则：

- `exhausted`：禁止切换
- `authInvalid`：禁止切换
- `incomplete` / `neverChecked`：禁止切换，并要求先确认额度

这样用户不会再出现“没刷额度就直接切过去，切完列表还是空”的问题。

相关文件：

- `src/engine/tokenPool.ts`

### 10. token pool 操作列背景与 Windows 商店版启动匹配

本轮还补了两处易感知问题：

- 账号池当前高亮行右侧三点操作列，之前 sticky 列背景和内部容器宽度叠在一起，会出现一块更深的矩形背景
- 现已改成：
  - sticky 操作列默认透明
  - 当前高亮行单独继承高亮背景
  - 内部 `.account-actions-menu` 不再强制撑满整列

- Windows 下自动重启 Codex 时，商店应用匹配原来太保守，只支持精确名字 / 前缀
- 现已放宽到：
  - 精确匹配
  - 前缀匹配
  - 包含匹配（`*Codex*`）

若用户在 Windows 端仍遇到“已勾选自动重启但未拉起 Codex”，下一步需要让用户提供：

```powershell
Get-StartApps | Where-Object { $_.Name -like "*Codex*" } | Format-Table Name, AppID
```

相关文件：

- `webview/src/styles.css`
- `src/engine/processGuard.ts`

## v1.0.1 本次发布修复点

这次版本重点修的是 token pool / pool-runner 在真实使用中的几个阻塞问题：

1. `pool-runner` 首次创建并切换时，如果遇到 `E_FILE_LOCKED`，此前会在杀掉占用进程后停在 10% 的“准备切换账号”阶段
   - 现已修复为：杀进程后继续恢复执行挂起的 `pool-runner` 切换

2. 账号池条目刚导入后，手动点击“切换”此前不会先请求额度
   - 现已修复为：手动切换前先做单条额度刷新，再根据状态决定是否允许切换
   - 现在会拦截：
     - `exhausted`
     - `authInvalid`
     - `incomplete`
     - `neverChecked`

3. Windows 下勾选“切换后自动重启 Codex”时，如果当前没检测到运行中的 Codex 进程，之前不会主动拉起
   - 现已修复为：无进程时也会直接尝试启动 Codex
   - 同时放宽了 Microsoft Store / StartApps 名称匹配

4. 账号池当前高亮行右侧三点操作列背景异常
   - 现已修复 sticky 操作列背景叠加，当前行高亮和三点菜单样式保持一致

5. token pool Webview 刷新过重导致 CPU 占用偏高、点击卡顿
   - 现已通过 bridge 快照合并和稳定定时器降低重复刷新

6. 账号页主布局调整
   - 账号池从原来嵌在账号管理区域内部，改成独立抽屉
   - 顺序调整为：
     - 账号池（上方，默认展开）
     - 账号管理与切换（下方，默认收起）
     - 对话清理
   - 这样更符合当前高频使用场景：优先用账号池做无感换号，低频时再展开账号管理

## 关键文件

- `HANDOFF.md`
- `README.md`
- `package.json`
- `src/extension.ts`
- `src/ui-host/bridge.ts`
- `src/engine/usage.ts`
- `src/engine/tokenPool.ts`
- `src/protocol/messages.ts`
- `src/protocol/schema.ts`
- `webview/src/state/store.ts`
- `webview/src/pages/TokenPoolPanel.tsx`
- `media/codex-migration.svg`

## 下次接手建议

新对话进入本项目时，固定顺序：

1. 先读 `HANDOFF.md`
2. 再读 `README.md`
3. 如果任务与 token pool 相关，再看：
   - `src/engine/tokenPool.ts`
   - `src/engine/profiles.ts`
   - `src/engine/usage.ts`
   - `src/ui-host/bridge.ts`
   - `webview/src/state/store.ts`
   - `webview/src/pages/TokenPoolPanel.tsx`
4. 如果任务与图标、侧边栏、打包相关，再看：
   - `package.json`
   - `src/extension.ts`
   - `media/`

## 下一步优先关注

如果用户说“继续推进这个扩展”，默认先确认以下事项：

1. token pool 这轮能力是否已经闭环接通
2. 相关消息协议、桥接和状态管理是否一致
3. `typecheck / build / test:unit / package:vsix` 是否还能通过
4. 活动栏 SVG 图标显示是否正常
5. pool-runner 语义是否还被保持：账号池不能再直接改普通账号槽位

## 文档维护规则

- 只要本项目有真实修改，结束前都要更新本文件
- 如果当前进行中的 token pool 范围发生变化，也要写回本文件
- 如果后续路线再次变化，例如从“Codex-only”重新扩展为别的形态，也必须先更新本文件再继续做


## 2026-03-10 本轮补充修复

这轮主要处理了账号管理 / 账号池列表交互上的两个实用问题：

1. 拖拽排序与滚动冲突
   - 账号池之前为了支持拖拽，尝试过窗口化渲染 + 内部纵向滚动，但实际在 Webview 里会导致：
     - 页面滚动到底部受阻
     - 拖拽排序落点不稳定
   - 现已改回普通 table + 页面级滚动，只保留横向滚动；拖拽排序继续保留
   - 当前实现优先稳定交互，不再在账号池里做内部纵向虚拟滚动

2. 账号管理的 live 行不再参与排序
   - 之前前端拖拽集合会把 `live` 行混进去，但后端持久化时又不会保存它，导致拖拽感知和最终结果不一致
   - 现已改成：只有真实 profile 参与排序，`live` 只展示，不参与拖拽

3. 从账号管理一键导入到账号池
   - 账号管理表格的操作列新增 `导入到账号池`
   - 会直接读取该账号槽位下的 `auth.json`，提取 token 并导入账号池
   - 仍按账号池既有去重规则处理：优先 `account_id`，其次 `email`，重复时覆盖旧条目

4. 账号池列表当前实现说明
   - 当前账号池列表继续支持：
     - 拖拽排序
     - 三点菜单操作
     - sticky 操作列
     - 单条刷新额度
   - 当前没有内部纵向滚动，页面整体可以滚到底

### 本轮涉及文件

- `src/engine/tokenPool.ts`
- `src/protocol/messages.ts`
- `src/protocol/schema.ts`
- `src/ui-host/bridge.ts`
- `webview/src/App.tsx`
- `webview/src/api/types.ts`
- `webview/src/pages/AccountsManager.tsx`
- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`

### 当前确认状态

- `npm run typecheck` 通过
- `npm run build` 通过
- 这轮修改尚未提交时，`AGENTS.md` 仍不应纳入提交

## 2026-04-16 CLIProxy usage 百分比修复

这轮处理了 `~/.cli-proxy-api/` 导入账号后的额度显示错误：

- 现象：
  - CLIProxy / `chatgpt.com/backend-api/wham/usage` 返回 `used_percent = 1`
  - 插件此前把 `1` 当成比例 `1.0` 处理，换算成 `100% used`
  - 结果导致账号页和 token pool 都把原本还剩 `99%` 的账号显示成 `0%` / `已用尽`

- 根因：
  - `src/engine/usage.ts` 的 `normalizePercent(...)` 采用了 `value <= 1` 就乘以 `100` 的策略
  - 这和 CLIProxy 当前 usage 接口的字段语义冲突
  - 当前这批接口返回的是 `0-100` 的百分比值，不是 `0-1` 比例

- 本轮修正：
  - 只有 `0 <= value < 1` 时才按比例换算
  - `value === 1` 现在保留为 `1%`
  - 账号管理页和 token pool 因为共用 `usage.ts`，会一起修复

- 回归校验：
  - 新增测试覆盖 `used_percent = 1 -> remainingPercent = 99`
  - 修复点已经通过显式 Node 测试命令校验

### 本轮涉及文件

- `src/engine/usage.ts`
- `test/usage.test.mjs`

## 2026-04-16 对话清理重启语义修复

这轮同时修了对话清理按钮语义和实际行为不一致的问题：

- 旧行为问题：
  - `确认删除（下次重启生效）` 实际上并不会登记待执行任务
  - 如果清理时遇到 SQLite / 目录占用，只会返回 `locked`，用户重启后还得手动再点一次
  - `确认删除并立即结束相关进程` 会执行 kill 后重试清理，但不会尝试恢复启动被结束的客户端

- 本轮修正：
  - `restartLater` 现在会把未完成的清理请求持久化到 `codex-profiles/.thread-cleanup-pending.json`
  - 下次 `INIT / REFRESH_PROFILES` 时会自动检查 pending 清理；如果占用已消失，会自动继续执行
  - `killNow` 完成后会复用现有客户端恢复启动逻辑，尝试重新拉起被结束的客户端
  - 对话清理结果新增：
    - `scheduledProfiles`
    - `relaunchedClients`
  - 结果弹窗会明确显示：
    - 哪些账号已登记为“重启后继续执行”
    - 哪些客户端已恢复启动

### 本轮涉及文件

- `src/ui-host/bridge.ts`
- `src/protocol/messages.ts`
- `webview/src/api/types.ts`
- `webview/src/pages/AccountsManager.tsx`

## 2026-04-16 对话清理备份默认值调整

这轮把“删除前备份”从默认开启改成默认关闭：

- 原因：
  - 当前对话清理更常见的诉求是快速删除
  - 默认开启会额外生成清理备份目录，和用户的预期不一致

- 本轮修正：
  - `threadCleanupBackupEnabled` 初始值从 `true` 改为 `false`
  - 界面文案同步从“默认开启”改为“默认关闭”

### 本轮涉及文件

- `webview/src/state/store.ts`
- `webview/src/pages/AccountsManager.tsx`
