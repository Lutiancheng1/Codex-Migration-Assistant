# Codex 迁移助手

面向 Codex 用户的账号管理、数据迁移、账号池轮换与会话清理扩展，基于 `VS Code Webview + React + TypeScript` 实现。

这套插件现在主要解决两类问题：
- **跨设备同步记录**
  - 当你想把上一台设备里用过的 Codex 会话、历史、状态带到另一台设备继续用时，使用 **导出 / 导入**。
- **当前设备无感切换多个账号**
  - 当你只想在当前设备切换登录身份，而不想动现有对话记录和 profile 目录时，使用 **账号池**。
- **当前设备管理多个完整账号目录**
  - 当你希望每个账号有自己独立的 `.codex` 数据、记录、状态和配置时，使用 **账号槽位**。

适用场景：
- `macOS` 上的 Codex App
- `macOS / Windows` 上的 Codex VS Code 扩展
- 同机多账号切换
- 跨设备迁移 `.codex` 数据
- 备份恢复与问题回滚
- 账号池按额度自动轮换

## 功能概览

当前版本只专注于 `Codex`，不再面向多客户端方案。

已实现能力：
- 可视化导出 `.codex` 数据为 ZIP
- 可视化导入备份 ZIP 到当前账号或新账号槽位
- 导入前预演，先看统计再执行
- 多账号槽位管理：新增、切换、切换并合并、切换并覆盖、删除
- 账号池：导入单个 / 多个 JSON 或目录中的 JSON，通过 `pool-runner` 专用槽位切换当前登录态，不动现有对话记录
- 账号池：显示 `FREE / TEAM / PLUS / PRO` 标签，支持单条刷新、按分类批量刷新和定时顺序刷新
- 切换前目录占用检测，必要时结束进程后继续
- 切换完成后尝试恢复启动被结束的客户端进程
- 每个账号单独刷新用量，显示套餐、5 小时 / 7 天窗口剩余额度与重置时间提示
- 支持 `history.jsonl` 与 `session_index.jsonl` 的迁移与合并
- 支持可选迁移 `state_*.sqlite*`
- 支持可选迁移 `auth.json / cap_sid`
- 生成导入报告
- 按会话 ID 批量预览和清理对话

## 账号槽位机制

账号功能基于“账号槽位目录 + `~/.codex` 软链接”实现。

工作方式：
1. 首次执行新增或切换时，会把当前 `~/.codex` 纳入首个槽位（通常是 `primary`）。
2. 后续每个账号槽位都存放在 `~/.codex-profiles/<profileId>`。
3. 当前活动账号始终通过 `~/.codex -> 槽位目录` 链接切换。

支持的操作：
- `切换`
  - 直接切到目标账号槽位
- `切换并合并`
  - 把当前账号的记录合并到目标账号
  - 适合保留双方记录
- `切换并覆盖`
  - 用当前账号的记录覆盖目标账号原有记录
  - 同时保留目标账号的登录态
  - 适合“目标账号只拿来登录，记录沿用当前账号”
- `删除`
  - 删除非当前激活账号槽位

## 什么时候用导出 / 导入，什么时候用账号池

这是当前最容易混淆的两套能力，建议按下面理解：

- **导出 / 导入**
  - 目标：把一个设备上的 Codex 记录、历史、状态带到另一台设备继续用
  - 适合：`Mac -> Windows`、`Windows -> Mac`、旧机器迁到新机器
  - 会涉及：`sessions`、`history`、`state`、可选 `auth`
  - 核心作用：**同步记录与上下文**

- **账号槽位**
  - 目标：在当前设备上维护多个完整账号目录
  - 适合：每个账号都有自己独立的记录、状态、配置
  - 核心作用：**切换整个账号目录**

- **账号池**
  - 目标：在当前设备上无感切换登录态
  - 适合：保留当前设备已有记录，只更换当前正在使用的账号认证
  - 不会动：`sessions`、`history`、`state`、`config`
  - 通过 `pool-runner` 专用槽位承接 token 切换，普通账号槽位不直接改写
  - 核心作用：**只切认证，不切记录**

一句话区分：
- 想**跨设备同步之前的记录**，用 `导出 / 导入`
- 想**当前设备继续用现有记录，只换账号身份**，用 `账号池`
- 想**当前设备给每个账号保留一整套独立目录**，用 `账号槽位`

## 导出与导入说明

### 导出内容

核心迁移内容：
- `sessions/`
- `rules/`
- `skills/`
- `history.jsonl`
- `session_index.jsonl`
- `config.toml`
- `version.json`
- `.codex-global-state.json`（在账号切换链路中也会参与同步/修复）

可选内容：
- `state_*.sqlite*`
- `auth.json`
- `cap_sid`

导出文件命名示例：

```text
codex-backup-{userLabel}-{timestamp}.zip
```

### 可选项说明

- `包含 state_*.sqlite*`
  - 导出时把本地状态数据库一起打包
  - 对跨设备恢复会话列表、排序和本地状态更有帮助
  - 建议在重要迁移时开启

- `包含 auth 文件（敏感）`
  - 导出 `auth.json / cap_sid`
  - 仅建议在你自己的可信设备之间迁移时使用

- `替换本地 state 文件`
  - 导入时用备份中的 `state_*.sqlite*` 覆盖本地状态
  - 适合希望尽量还原原设备状态时使用

- `导入 auth 文件（高风险）`
  - 导入登录态文件
  - 可能触发重新登录、串号或权限异常，只适合可信设备

导出 / 导入最适合的场景：
- 你在 A 设备上已经使用过一段时间，现在想在 B 设备继续接着用
- 你需要把之前的会话、项目上下文、历史记录一起带过去
- 你不只是要换登录态，而是要**同步记录**

## 切换前自动备份

- 默认关闭
- 开启后，每次执行切换类操作前会自动备份当前账号（不含 auth）
- 当前行为：如果生成内容完全一样的 ZIP，会自动清理重复备份，只保留一份

适用操作：
- `切换`
- `切换并合并`
- `切换并覆盖`

## 用量查询

每个账号槽位都可以单独刷新用量，也可以刷新全部账号。

展示字段：
- 套餐类型 `planType`
- 5 小时窗口剩余
- 7 天窗口剩余
- 最近刷新时间

刷新用量前会优先按 Codex 官方 OAuth refresh_token 流程续期登录态：
- 使用 `https://auth.openai.com/oauth/token`
- 使用 `refresh_token` grant
- 提前 5 天进入续期窗口，和 CLIProxyAPI 的 Codex 刷新策略保持一致
- 续期成功后会写回新的 `access_token / id_token / refresh_token / expired / last_refresh`

如果 refresh_token 已失效、账号未登录或 auth 不完整，会在日志中显示跳过或失败原因。

## 账号池

账号池是独立于“账号槽位”的另一套机制，专门用于**当前设备无感换号**。

工作方式：
- 导入 token JSON 到账号池
- 先把你当前想工作的记录同步到 `pool-runner` 专用槽位
- 切到 `pool-runner` 后，账号池只 patch 这个槽位的 `auth.json` 认证字段
- 不切换普通账号槽位
- 不改对话记录
- 不改 `sessions / history / state / config`

推荐工作流：
1. 在普通账号槽位里整理好你要继续使用的记录
2. 点击“同步当前记录到池槽位”
3. 切换到 `pool-runner`
4. 再用账号池切 token，或开启账号池自动检测让它按间隔顺序刷新整池用量

支持导入：
- 单个 JSON
- 多个 JSON
- 指定目录首层 `.json`

切换时只会改认证字段：
- `last_refresh`
- `expired`
- `tokens.access_token`
- `tokens.account_id`
- `tokens.id_token`
- `tokens.refresh_token`
- `tokens.expired`

不会改：
- `cap_sid`
- `sessions`
- `history.jsonl`
- `session_index.jsonl`
- `state_*.sqlite*`
- `config.toml`

### 账号池额度规则

- `free`
  - 只看 `7天剩余`
- `plus`
  - 同时看 `5小时剩余` 和 `7天剩余`

账号池刷新与检测逻辑：
- 只在**当前活动槽位是 `pool-runner`** 时生效
- 手动支持单条刷新
- 手动支持按分类批量刷新：全部账号、Free、Plus、Team、Pro
- 开启“账号池自动检测”并设置频率后，会按池内顺序串行刷新整个账号池
- 每个账号刷新前都会尝试用 refresh_token 自动续期登录态
- 当前版本不再做真正的无人值守自动换号；写入新登录态后仍以手动切换和手动重启 / Reload Window 生效为主

## 对话清理（按会话ID）

支持按会话 ID 批量清理记录。

流程：
1. 输入一个或多个会话 ID
2. 先执行“查找匹配”预览
3. 查看命中账号、线程、文件数量
4. 二次确认后执行删除

支持两种生效方式：
- `下次重启生效`
- `立即结束相关进程生效`

可选项：
- 删除前自动备份
- 针对全部账号 / 当前账号 / 指定单账号执行

## 目录结构

```text
src/                 扩展主进程与迁移引擎
  engine/            导出、导入、账号管理、用量查询、会话清理
  ui-host/           Webview 通信桥接
  protocol/          前后端消息协议
webview/             React UI
docs/                数据说明文档
test/                单元测试
```

## 开发调试

环境要求：
- `Node.js 20+`
- `npm`
- VS Code 或兼容 VS Code Extension Host 的环境

安装依赖：

```bash
npm install
```

开发模式：

终端 A：
```bash
npm run watch:webview
```

终端 B：
```bash
npm run watch:ext
```

然后按 `F5` 启动扩展开发宿主。

## 构建、测试、打包

```bash
npm run typecheck
npm run build
npm run test:unit
```

打包 VSIX：

```bash
npm run package:vsix
```

如果本机默认 Node 低于 20：

```bash
npm run package:vsix:node20
```

## 已知限制

- 删除槽位仅支持删除非当前激活槽位
- 切换时若 `.codex` 或目标槽位被客户端占用，需要先释放或结束进程
- 跨平台迁移时，旧设备上的本地缓存状态可能仍需一次完整重启后才完全生效
- 如果源端 `state_*.sqlite*` 已损坏，仍可能需要额外修复或重建索引

## 安全建议

- `auth.json`、`cap_sid` 属于敏感凭据，请谨慎迁移和保存
- 重要切换前建议保留至少一个可用备份
- 做“切换并覆盖”前，建议先确认目标账号已完成一次登录

## 相关文档

- 数据说明：`docs/CODEX_DATA_GUIDE.zh-CN.md`
