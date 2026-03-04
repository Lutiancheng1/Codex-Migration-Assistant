# Codex 本地数据与迁移说明（macOS/Windows）

最后更新：2026-03-04

本文基于你当前机器上的实际样本（`/Users/lutiancheng/.codex`）和导出包（`codex-backup-20260304-155320.zip`）整理，目的是回答四件事：

1. 导出 ZIP 里到底有什么  
2. 本地 `.codex` 目录每个核心文件夹做什么  
3. 如何做“无感切换账号”  
4. 如何做“聊天记录合并”或“切换到某账号历史”

---

## 1) 你这次导出的 ZIP 里有什么

本次 `metadata.json` 关键字段：

- `format`: `codex-backup-v3`
- `mode`: `core`
- `includeState`: `false`
- `includeAuth`: `false`
- `copiedItems`: `config.toml`, `sessions`, `rules`, `skills`

结论：这是一个“核心数据包”，不含账号凭据、不含状态库。

### 实际目录结构（示意）

```text
metadata.json
payload/
  core/
    config.toml
    sessions/...
    rules/...
    skills/...
```

### 各项含义

- `config.toml`
  - 模型、工具服务器（MCP）等配置。
- `sessions/`
  - 对话事件 JSONL（主要聊天历史内容）。
- `rules/`
  - 规则文件（例如 `default.rules`）。
- `skills/`
  - 技能定义与脚本。

### 不在这个包里的内容

- `auth.json` / `cap_sid`（账号凭据）
- `state_*.sqlite*`（线程索引、状态等）

---

## 2) 本地 `~/.codex` 包含什么

你机器上的顶层主要项目（已脱敏）：

- `auth.json`（敏感）
- `config.toml`
- `sessions/`
- `archived_sessions/`
- `rules/`
- `skills/`
- `state_5.sqlite`, `state_5.sqlite-wal`, `state_5.sqlite-shm`
- `.codex-global-state.json`
- `shell_snapshots/`
- `sqlite/codex-dev.db`
- `vendor_imports/`

### 当前体量（你机器样本）

- `sessions`: 约 `155M`（最大）
- `vendor_imports`: 约 `6.1M`
- `state_5.sqlite-wal`: 约 `4.0M`
- `skills`: 约 `2.1M`

### 关键文件职责

#### A. 身份与配置

- `auth.json`
  - 账号登录态/令牌信息。迁移时最敏感。
- `config.toml`
  - 模型、推理强度、MCP 服务器等配置项。

#### B. 聊天数据本体

- `sessions/YYYY/MM/DD/*.jsonl`
  - 事件流。样本中单文件可达几千行。
  - 常见事件 `type`：`session_meta`、`turn_context`、`response_item`、`event_msg`。
- `archived_sessions/*.jsonl`
  - 已归档会话数据。

#### C. 本地状态索引

- `state_5.sqlite*`
  - 本地线程/状态索引（含 `threads` 等表）。
  - 你样本的 `threads` 表有 `12` 条（其中归档 `1` 条）。
  - 该库与 `sessions` 配合决定“当前看到的线程列表/状态”。

#### D. UI/客户端状态

- `.codex-global-state.json`
  - 窗口布局、工作区标签、线程标题映射等全局 UI 状态键。

#### E. 自动化与收件箱

- `sqlite/codex-dev.db`
  - 表：`automations`、`automation_runs`、`inbox_items`。
  - 与自动化任务和收件箱展示相关。

#### F. 其他

- `shell_snapshots/`
  - Shell 快照脚本文件。
- `vendor_imports/`
  - 外部导入资源缓存（你样本里含 skills 仓库缓存）。

---

## 3) 无感切换账号：推荐做法

“无感切换账号”本质是切换整套本地 profile，而不是只换 `auth.json`。

## 推荐策略：Profile 隔离

为每个账号维护独立目录：

- `~/.codex-profiles/account-A`
- `~/.codex-profiles/account-B`

每个目录都包含完整 `.codex` 结构（auth/config/sessions/state...）。

切换流程：

1. 关闭 Codex App / VS Code 扩展宿主  
2. 把当前 profile 切换为 `~/.codex`（目录替换或符号链接切换）  
3. 重启客户端  

优点：

- 切换后“账号 + 历史 + 状态”一致，接近无感。
- 不同账号数据互不污染。

不推荐仅替换 `auth.json`，因为线程索引和本地状态仍是旧账号上下文，容易混乱。

---

## 4) 聊天记录“合并”与“切换”的实现语义

你可以按目标选择两种模式：

## 模式 A：合并聊天（保留当前账号）

目标：把另一份备份中的会话并入当前本地，不切账号。

建议参数：

- 导出端：`core` 模式即可（不带 auth/state）
- 导入端：
  - `importAuth = false`
  - `replaceState = false`

结果：

- `sessions/rules/skills` 按文件合并
- 同路径冲突产生 `*-imported-{timestamp}.*` 副本
- 当前账号登录态不变

## 模式 B：切换到对方账号历史（接近“整套切换”）

目标：本地表现尽量对齐来源账号环境。

建议参数：

- 导出端：包含 `auth + state`（仅限你确认合规时）
- 导入端：
  - `importAuth = true`
  - `replaceState = true`

结果：

- 登录态可被替换
- 线程状态库被替换（旧 state 会先备份）
- 本地体验更接近“切到另一账号历史”

风险：

- `auth` 高敏感
- `state` 覆盖后会改变当前线程状态视图

---

## 5) 你当前扩展的实际行为（当前版本）

- 默认导出目录：`~/codex-backup`
- 当默认目录下存在多个 ZIP：会弹出列表让用户选
- 导入前可先“预演”查看冲突与风险
- 导入后输出 JSON + Markdown 报告
- 账号页支持“刷新用量”（按账号槽位拉取套餐与 5 小时/7 天窗口剩余额度）
- 增强模式支持多编辑器状态迁移：VS Code / VS Code Insiders / Cursor / Antigravity / Kiro / Trae / Qoder

注意：当前合并是“文件级合并”，不是“语义级聊天去重/重排”。

---

## 6) 迁移安全建议

1. 跨账号迁移时，默认不要导入 `auth`。  
2. 先做 `preview`，确认冲突样本。  
3. 大迁移前备份整个 `~/.codex`。  
4. “切账号”优先用 profile 隔离，不要临时混写同一个 `.codex`。  
