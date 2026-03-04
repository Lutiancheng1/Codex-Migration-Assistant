# Codex 迁移助手

面向 Codex 用户的数据迁移与账号管理扩展，基于 `VS Code Webview + React + TypeScript` 实现。

目标场景：
- `macOS` 上 Codex App 用户
- `macOS / Windows` 上 Codex VS Code 扩展用户
- 同机多账号切换、跨机迁移、备份恢复

## 1. 功能概览

- 可视化导出/导入 `.codex` 数据
- 导入前预演（先看统计再导入）
- 导入到当前账号，或“导入为新账号槽位”
- 多账号槽位管理：新增、切换、切换并合并、删除
- 账号用量查询（按账号刷新，展示 5 小时 / 7 天窗口）
- 冲突保留副本（`*-imported-{timestamp}.*`）
- `history.jsonl` 去重追加合并
- 导入报告输出（JSON + Markdown）
- 切换前占用检测（目录被客户端占用时阻断切换）
- 切换失败自动回滚（尽量恢复到切换前状态）

## 2. 迁移模式

- `仅核心 (.codex)`（推荐）
  - 迁移核心目录与文件：`sessions`、`rules`、`skills`、`history.jsonl`、`config.toml`、`version.json`
- `核心 + 编辑器状态（增强）`
  - 在核心数据基础上，额外迁移编辑器侧 Codex 相关状态目录（过滤后导出/导入）
  - 当前支持编辑器：`VS Code`、`VS Code Insiders`、`Cursor`、`Antigravity`、`Kiro`、`Trae`、`Qoder`

## 3. 导入导出选项说明

- `包含 state_*.sqlite*` / `替换本地 state 文件`
  - 导出时：把本地 `state_*.sqlite*` 打包
  - 导入时：启用“替换”会覆盖本地同类 state 文件
- `包含 auth 文件（敏感）` / `导入 auth 文件（高风险）`
  - 涉及 `auth.json`、`cap_sid`
  - 建议仅在你明确知道风险时使用

## 4. 账号切换机制

账号功能基于“账号槽位目录 + `~/.codex` 软链接”实现。

- 首次执行“新增账号”或“切换账号”时：
  - 自动把当前 `~/.codex` 纳入首个槽位（通常为 `primary`）
  - 建立/维护 `~/.codex -> 槽位目录` 的链接
- 新增账号后：
  - 先切换到新槽位（空骨架目录）
  - 在 Codex 客户端登录该账号一次
  - 后续可在槽位间无感切换
- `切换并合并`：
  - 会把当前账号核心数据合并到目标槽位
  - 不导入 auth，不替换 state
- `切换前自动备份当前账号`：
  - 自动导出到 `~/codex-backup`

## 5. 用量查询能力

每个槽位可单独“刷新用量”，也可刷新全部账号。  
数据来源：读取该槽位 `auth.json` 后请求 ChatGPT 用量接口，展示：
- 套餐类型 `planType`
- 5 小时窗口剩余
- 7 天窗口剩余
- 最近刷新时间

如果某账号未登录或 auth 不完整，会显示为跳过/失败项并记录在日志中。

## 6. 导出 ZIP 内容

导出文件命名示例：
- `codex-backup-{userLabel}-{timestamp}.zip`

其中：
- `userLabel` 优先取账号标签（例如邮箱前缀），用于区分多账号备份
- `timestamp` 为本地时间戳

ZIP 内结构（示意）：

```text
metadata.json
payload/
  core/
    sessions/
    rules/
    skills/
    history.jsonl
    config.toml
    version.json
    state_*.sqlite*          (可选)
    auth.json / cap_sid      (可选)
  editor/                    (enhanced 模式可选)
    vscode/
    antigravity/
    ...
```

## 7. 侧边栏使用流程

在 VS Code 活动栏点击 `Codex迁移` 图标，进入 `迁移助手`。

导出流程：
1. 设置 `Codex 目录`
2. 设置 `导出目录`（默认 `~/codex-backup`）
3. 选择迁移模式与可选项
4. 点击 `执行导出`

导入流程：
1. 选择备份 ZIP（支持“默认目录”快速选择最新/指定 ZIP）
2. 选择迁移模式与可选项
3. 点击 `预演导入` 检查冲突与锁定
4. 点击 `执行导入` 或 `导入为新账号`

账号流程：
1. 新增账号槽位
2. 通过每行操作菜单执行刷新用量 / 切换 / 切换并合并 / 删除

## 8. 项目结构

```text
src/                 扩展主进程与迁移引擎
  engine/            导出、导入、预演、冲突处理、账号管理、用量查询
  ui-host/           Webview 通信桥接
  protocol/          前后端消息协议
webview/             React UI
docs/                设计与数据说明文档
test/                单元测试
```

## 9. 开发与调试

环境要求：
- `Node.js 20+`（推荐）
- `npm`
- VS Code / Antigravity（兼容 VS Code Extension Host）

安装依赖：

```bash
npm install
```

开发调试（无需反复打包）：

终端 A：
```bash
npm run watch:webview
```

终端 B：
```bash
npm run watch:ext
```

然后在编辑器内按 `F5` 启动扩展开发宿主。

热更新建议：
- 修改 `webview/src/*` 后执行 `Developer: Reload Window`
- 修改 `src/*` 后重启调试会话（Stop -> F5）

## 10. 构建、测试、打包

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

## 11. 已知限制

- 删除槽位仅支持删除“非当前激活槽位”
- 目录占用检测到客户端进程时，切换会被阻断（需先关闭相关客户端）
- “增强模式”编辑器状态迁移使用目录特征过滤，不做数据库级深度解析

## 12. 安全建议

- `auth.json`、`cap_sid` 属于敏感凭据，请谨慎迁移和保存
- 建议在导入前做一次完整备份
- 涉及账号切换时，建议先关闭 Codex App / VS Code 扩展相关进程

## 13. 相关文档

- 数据与策略说明：`docs/CODEX_DATA_GUIDE.zh-CN.md`
