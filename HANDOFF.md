# Codex Migration Extension Handoff

最后更新：2026-04-20（已按用户要求移除 Tauri/macOS 独立 app 架构，仓库重新收回为纯扩展主线；当前扩展版本 `1.0.5`）

## 项目快照

- 项目名：`codex-migration-extension`
- 展示名：`Codex 迁移助手`
- 当前版本：`1.0.5`
- 当前形态：VS Code / Codex Webview 扩展
- 技术栈：TypeScript、React、VS Code Webview、Node.js 20+
- 当前定位：面向 Codex 用户的账号切换、数据迁移、备份恢复、会话清理与用量查看

## 当前结论

这个仓库现在不要再按“扩展 + 独立 app 双线演进”理解。

本轮已经明确回滚掉独立桌面版路线：

- 删除 `apps/desktop-macos/`
- 删除 `packages/shared-ui/`
- 删除 `packages/shared-contracts/`
- 删除 `src/desktop/runner.ts`
- 根 `package.json` 已去掉 workspace 与 Tauri 相关脚本
- `package-lock.json` 已重新生成，回到单包扩展结构
- 根 `build` 脚本现在会先执行 `clean`，避免旧的桌面编译产物残留进 `.vsix`

后续默认只维护扩展主线，不再继续推进 Tauri / macOS app 架构。

## 当前仓库里应保留的主能力

- 导出 `.codex` 数据为 ZIP
- 导入备份 ZIP，并支持预演
- 多账号槽位管理
- 切换 / 切换并合并 / 切换并覆盖 / 删除
- 切换前目录占用检测
- 切换完成后尝试恢复被结束的客户端进程
- 每个账号单独刷新用量
- 可选迁移 `state_*.sqlite*`
- 可选迁移 `auth.json / cap_sid`
- 生成导入报告
- 按会话 ID 批量预览和清理对话
- `pool-runner` 专用账号池运行槽位
- token pool 单条额度刷新、自动切换与可选自动重启 Codex

## 已明确的核心设计决策

- 账号切换通过“账号槽位目录 + `~/.codex` 软链接”实现
- 重点适配 Codex App / Codex VS Code 扩展场景
- `Webview + React` 是唯一既定 UI 方案
- 导入前预演、敏感文件风险提示、备份恢复能力都是主线，不能砍
- 不再为桌面独立 app 保留额外架构层

## 当前仍保留但不是桌面版专属的基础设施

有两块能力虽然是在“双端时期”引入，但现在仍服务扩展本身，不要误删：

- `src/util/sharedData.ts`
  - 负责统一推导 `~/.codex-profiles`、token pool 元数据路径等
- `src/util/sharedLock.ts`
  - 负责扩展写共享数据时的单写锁

这两块现在已经是扩展自身的数据一致性基础，不属于桌面 app UI 架构。

## 最近仍然有效的重要修复

### 0.1 账号池已修复同邮箱 free/team 导入互相覆盖

之前 `TokenPoolService.upsertSecret` 用的是：

- 同 `accountId`
- 或同 `email`

就视为同一个条目。这会导致 `cli-proxy` 导出的同邮箱双登录态（例如 free / team）在第二次导入时直接覆盖第一次。

现在的行为改成：

- 账号池只会在“同一份 token 指纹”时覆盖旧条目
  - `refreshToken`
  - `idToken`
  - `accessToken`
- 只要 token 指纹不同，即使：
  - `email` 相同
  - `accountId` 相同
  也允许同时作为两个独立条目存在

同时补了“当前激活池条目”的识别逻辑：

- 现在会优先比对当前 `auth.json` 中的：
  - `refresh_token`
  - `id_token`
  - `access_token`
- 只有精确 token 指纹匹配失败时，才退回到 `accountId`

新增测试：

- `test/token-pool.test.mjs`

相关文件：

- `src/engine/tokenPool.ts`
- `test/token-pool.test.mjs`

### 0.2 账号池列表已明确显示 FREE / TEAM 标签

在修好“同邮箱 free/team 不再互相覆盖”之后，又补了列表识别层：

- Webview 扩展里的账号池列表
  - 在账号主标题右侧明确显示 `FREE` / `TEAM` badge

badge 来源优先使用：

- `usage.planType`
- 回退到 `planTypeHint`

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`

### 0.3 账号池表已移除“套餐”列，并合并为 `5h/7d`

在账号池列表已经明确显示 `FREE / TEAM` 标签之后，原来的“套餐”列变得冗余。

当前表格已收缩为：

- 删除“套餐”列
- 原来的：
  - `5小时`
  - `7天`
  两列合并为单个 `5h/7d` 列
- 单元格文案改为：
  - `xx%/yy%`

同时把账号池表的最小宽度从 `760px` 收到了 `680px`，让窄侧栏下横向滚动更少。

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`

### 0.4 用量失败提示已做短消息归一化

之前账号用量刷新失败时，界面会把多条 endpoint 失败、HTML 片段和 URL 原样拼接出来，底部提示很脏。

现在的行为改成：

- `token_expired / 401`
  - 归一化为“登录态已过期，请切换到该账号重新登录后再刷新用量”
- 一般 `401/403`
  - 归一化为“登录态无效或权限不足，请重新登录后再刷新用量”
- 账号列表和账号池各自独立汇总自己的失败项，不再串位

相关文件：

- `src/engine/usage.ts`
- `webview/src/pages/AccountsManager.tsx`
- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/pages/usageErrorSummary.ts`

### 0.5 对话清理已修复 restartLater / killNow 行为

之前的问题是：

- `restartLater` 点击后并不会真正登记为“重启后继续清理”
- `killNow` 会结束相关进程，但不会自动恢复启动客户端

现在的行为：

- `restartLater`
  - 会把待清理任务登记到 pending 文件，下次打开面板或刷新时继续执行
- `killNow`
  - 清理完成后会尝试恢复启动客户端

同时：

- 遇到损坏的 `state_*.sqlite` 时，不再让整次清理直接中断
- rollout/session 文件和全局状态仍会继续删除

相关文件：

- `src/ui-host/bridge.ts`
- `src/engine/threadCleanup.ts`
- `test/thread-cleanup.test.mjs`

## 当前应注意的历史风险

1. 活动栏图标问题
   - 历史上出现过把 PNG 转成 SVG 后，活动栏图标渲染成“白色一片”
   - 处理图标问题时优先检查：
     - `package.json`
     - `media/codex-migration.svg`
     - `media/codex-migration.png`
     - 宿主环境对 monochrome/activity bar icon 的要求

2. 长对话上下文不可靠
   - 历史会话 `019cb6c1-d2ed-7032-bd78-eec2c51a13c4` 很大
   - 真实状态以仓库文件为准，不要依赖聊天线程记忆

## 本轮验证目标

本轮移除桌面版架构后，至少应验证：

- `npm run build:webview`
- `npm run build:ext`
- `npm run package:vsix`
- `/usr/local/bin/node --test test/token-pool.test.mjs test/usage.test.mjs test/thread-cleanup.test.mjs`

## 后续默认方向

后续需求默认只在扩展主线上继续推进：

- 账号池
- 会话清理
- 用量刷新
- 导入导出与切换体验
- Webview UI 打磨

不要再默认重启独立桌面 app 方案，除非用户以后明确重新立项。
