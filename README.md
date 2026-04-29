# Codex 迁移助手

面向 Codex 的 VS Code / Codex Webview 扩展，用于管理本机 `.codex` 数据、跨设备迁移记录、多账号槽位切换、账号池登录态切换、用量刷新和按会话 ID 清理对话。

当前主线是纯扩展形态，不包含 Tauri / Electron 独立桌面 App。

## 核心价值

Codex 的真实使用数据分散在 `.codex` 目录、SQLite state、会话文件、历史索引、配置文件和登录态里。手工复制这些文件很容易出现会话丢失、账号串号、状态不同步、SQLite 残留、token 过期、删除不干净等问题。

Codex 迁移助手的核心价值是把这些高风险本地操作做成可视化、可预演、可回滚、可追踪的工具链。

- **跨设备迁移不再靠手工拷目录**
  - 插件知道哪些文件是会话记录、哪些是状态缓存、哪些是敏感登录态。
  - 导出 / 导入支持预演和报告，先看到风险再执行。
  - 适合把旧机器的 Codex 工作上下文迁到新机器。

- **多账号使用不再混写同一份 `.codex`**
  - 账号槽位把每个账号隔离成独立目录。
  - 切换通过软链接完成，避免把多个账号的记录、配置和状态混在一起。
  - 支持合并和覆盖，能处理“保留记录但换账号”这类真实工作流。

- **账号池只切登录态，不破坏当前工作记录**
  - `pool-runner` 专用槽位承接 token 切换。
  - 普通账号槽位和当前会话记录不被账号池直接改写。
  - 同邮箱的 Free / Team / Plus / Pro token 可以共存，不会互相覆盖。

- **用量刷新更稳定**
  - 旧版本只拿现有 `access_token` 查用量，过期后只能报错。
  - 当前版本接入 Codex OAuth `refresh_token` 续期逻辑，刷新前会自动换新 token。
  - 账号池可以单条刷新、按套餐分类批量刷新，也可以按频率整池串行刷新。

- **危险操作可观察**
  - 导入、切换、清理都有日志。
  - 对话清理支持预览、备份和残留校验。
  - 损坏 SQLite、进程占用、登录态失效都会显式提示，不做静默吞错。

一句话：这个扩展不是单纯的 ZIP 备份工具，而是 Codex 本地数据、账号槽位、账号池 token 和会话清理的安全操作台。

## 适用场景

- 在不同电脑之间迁移 Codex 会话、历史、配置和本地状态。
- 在同一台设备上维护多个完整 Codex 账号目录。
- 保留现有会话记录，只切换当前使用的账号登录态。
- 批量导入 cli-proxy / Codex token JSON 到账号池。
- 查询账号 5 小时 / 7 天窗口用量，必要时自动续期 token。
- 按会话 ID 批量预览和删除本地对话记录。

## 核心功能

- 导出当前 `.codex` 为 ZIP 备份。
- 导入备份 ZIP，支持导入前预演、冲突提示和导入报告。
- 多账号槽位管理：新增、切换、切换并合并、切换并覆盖、删除。
- 切换前检测占用 `.codex` 的外部进程，支持结束进程后继续。
- 切换完成后尝试恢复启动被结束的 Codex 客户端。
- 账号池导入单个 JSON、多个 JSON 或目录中的 JSON。
- 同邮箱 / 同 accountId 的 Free、Team 等不同 token 可同时存在，不会互相覆盖。
- 账号池列表显示 `FREE / TEAM / PLUS / PRO` 标签。
- 账号池支持单条刷新、按分类批量刷新、定时整池顺序刷新。
- 用量刷新前自动使用 Codex OAuth `refresh_token` 续期 access/id/refresh token。
- 对话清理支持预览、下次重启生效、立即结束相关进程后生效。
- 操作日志带时间前缀，便于排查。

## 功能边界

### 导出 / 导入

用于跨设备同步记录和上下文。

会处理：
- `sessions/`
- `history.jsonl`
- `session_index.jsonl`
- `rules/`
- `skills/`
- `config.toml`
- `version.json`
- `.codex-global-state.json`
- 可选 `state_*.sqlite*`
- 可选 `auth.json / cap_sid`

适合：
- 新电脑恢复旧电脑的 Codex 记录。
- Mac / Windows 之间迁移会话。
- 重要操作前做备份。

### 账号槽位

用于在本机维护多个完整账号目录。

实现方式：
- 首次初始化会把当前 `~/.codex` 纳入默认槽位。
- 每个账号槽位存放在 `~/.codex-profiles/<profileId>`。
- 当前活动账号通过 `~/.codex -> ~/.codex-profiles/<profileId>` 软链接切换。

支持操作：
- `切换`：直接切到目标槽位。
- `切换并合并`：把当前账号记录合并到目标槽位。
- `切换并覆盖`：用当前记录覆盖目标槽位记录，但保留目标登录态。
- `删除`：删除非当前激活槽位。

### 账号池

用于保留当前工作记录，只切换认证 token。

实现方式：
- 账号池使用 `pool-runner` 专用槽位承接登录态切换。
- 普通账号槽位不直接被账号池改写。
- 切换账号池条目时只 patch `pool-runner/auth.json` 的认证字段。

会改写：
- `last_refresh`
- `expired`
- `tokens.access_token`
- `tokens.account_id`
- `tokens.id_token`
- `tokens.refresh_token`
- `tokens.expired`

不会改写：
- `cap_sid`
- `sessions/`
- `history.jsonl`
- `session_index.jsonl`
- `state_*.sqlite*`
- `config.toml`

推荐流程：
1. 在普通账号槽位里整理好要继续使用的记录。
2. 点击“同步当前记录到池槽位”。
3. 切换到 `pool-runner`。
4. 在账号池里手动切换 token，或开启自动检测刷新整池用量。

## 用量刷新与 token 续期

用量查询会读取 Codex `auth.json` 或账号池 secret 中的 token。

刷新前会尝试按 Codex OAuth refresh_token 流程续期：
- Token URL：`https://auth.openai.com/oauth/token`
- Grant Type：`refresh_token`
- Client ID：`app_EMoamEEZ73f0CkXaXp7hrann`
- Refresh Lead：过期前 5 天开始尝试续期
- 续期成功后写回新的 `access_token / id_token / refresh_token / expired / last_refresh`

这套逻辑参考并移植自 CLIProxyAPI 的 Codex token refresh 策略。之前 token 容易过期的原因是旧版本只拿现有 `access_token` 查询用量，不会主动用 `refresh_token` 换新 token。

失败边界：
- `refresh_token` 已失效时，需要重新登录。
- 网络失败时会保留原 token，并在日志中展示失败原因。
- 续期失败但旧 `access_token` 仍有效时，会继续尝试查询用量。

## 账号池刷新规则

账号池支持三种刷新方式：

- 单条刷新：只刷新当前行。
- 分类批量刷新：按 `全部账号 / Free / Plus / Team / Pro` 筛选后串行刷新。
- 自动检测：开启后按设置频率串行刷新整个账号池。

分类来源：
- 优先使用最近一次用量接口返回的 `usage.planType`。
- 如果尚未刷新过，则回退到导入 token 时从 `id_token` 解析出的 `planTypeHint`。

额度状态：
- `free`：主要看 7 天窗口。
- `plus / team / pro`：同时看 5 小时和 7 天窗口。

当前版本不做无人值守自动换号。账号池切换写入 token 后，仍以手动重启 Codex 或 Reload Window 生效为主。

## 对话清理

对话清理按会话 ID 执行。

流程：
1. 输入一个或多个会话 ID。
2. 执行预览，确认命中线程、日志、工具记录和文件。
3. 选择作用范围：全部账号、当前账号或指定账号。
4. 选择生效方式：下次重启生效或立即结束相关进程。
5. 执行删除。

SQLite 边界：
- 损坏的 `state_*.sqlite` 会显式报错。
- 对话文件、rollout/global state 等非 SQLite 残留仍会尽量清理。
- 不会静默吞掉数据库损坏问题。

## 核心架构

```text
VS Code / Codex Extension Host
├─ src/extension.ts
│  └─ 注册命令、Activity Bar View、Webview Provider
├─ src/ui-host/
│  └─ Webview 消息桥接、任务日志、写锁调度
├─ src/protocol/
│  └─ 前后端消息类型与 Zod 校验
├─ src/engine/
│  ├─ exporter.ts              导出 ZIP
│  ├─ importer.ts              执行导入
│  ├─ scanner.ts               导入预演
│  ├─ profiles.ts              账号槽位与 ~/.codex 软链接
│  ├─ tokenPool.ts             账号池、pool-runner、批量刷新
│  ├─ usage.ts                 用量查询与 Codex token 续期
│  ├─ threadCleanup.ts         会话清理
│  ├─ processGuard.ts          占用进程检测、kill、relaunch
│  └─ stateReplace.ts          state_*.sqlite 替换
├─ src/util/
│  ├─ sharedData.ts            共享数据路径
│  └─ sharedLock.ts            写操作单写锁
└─ webview/
   └─ React UI
```

## 数据目录

默认使用：
- `~/.codex`
- `~/.codex-profiles`

账号池元数据和 secret 文件通过 `src/util/sharedData.ts` 推导，放在 `~/.codex-profiles` 体系下。

写操作会经过单写锁：
- 账号槽位切换
- 账号池导入 / 删除 / 排序 / 切换
- 用量刷新后写回 token
- 导入备份
- 对话清理

如果另一端正在写入，会提示稍后重试，避免同时改写 `.codex`。

## 安全说明

- `auth.json`、`cap_sid`、`refresh_token`、`access_token` 属于敏感凭据。
- 不建议把包含 auth 的备份传给他人或提交到仓库。
- 导出 auth 只适合自己的可信设备之间迁移。
- `refresh_token` 失效时只能重新登录，插件不会绕过服务端鉴权。
- 账号池 secret 仅保存在本机本地文件中，不上传远端服务。

## 安装

从 GitHub Release 下载最新 `.vsix` 后安装：

```bash
code --install-extension codex-migration-assistant-<version>.vsix
```

如果使用 Codex / VS Code 兼容环境，也可以在扩展管理页面选择“从 VSIX 安装”。

## 开发

环境要求：
- Node.js 20+
- npm
- VS Code 或兼容 VS Code Extension Host 的环境

安装依赖：

```bash
npm install
```

开发监听：

```bash
npm run watch:webview
npm run watch:ext
```

然后按 `F5` 启动 Extension Host。

## 构建、测试、打包

```bash
npm run typecheck
npm run build
npm run test:unit
npm run package:vsix
```

如果本机默认 Node 低于 20：

```bash
npm run package:vsix:node20
```

## 发布

当前发布物是 VSIX：

```bash
npm run package:vsix
git tag v<version>
git push origin v<version>
gh release create v<version> codex-migration-assistant-<version>.vsix --title "v<version>" --notes-file RELEASE_NOTES.md
```

## 已知限制

- 当前只维护扩展主线，不维护独立 App。
- 删除账号槽位只能删除非当前激活槽位。
- `.codex` 或槽位目录被客户端占用时，需要结束相关进程后继续。
- 跨平台迁移后可能需要重启 Codex / Reload Window 才能完全刷新状态。
- 损坏 SQLite 不做静默修复，会显式报告。

## 相关文档

- 数据说明：[docs/CODEX_DATA_GUIDE.zh-CN.md](docs/CODEX_DATA_GUIDE.zh-CN.md)
- 接力文档：[HANDOFF.md](HANDOFF.md)
- 项目同步说明：[PROJECT_SYNC.md](PROJECT_SYNC.md)
