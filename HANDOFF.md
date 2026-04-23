# Codex Migration Extension Handoff

最后更新：2026-04-23（已按用户要求移除 Tauri/macOS 独立 app 架构，仓库重新收回为纯扩展主线；账号池 `5h/7d` 列已补 hover 提示；账号池表已移除“最近刷新”列，并限制为最多显示 6 条后内部滚动，且当前账号会自动滚入可视区；账号池设置已改成“自动检测/用量自动刷新频率”，不再自动换号；执行与操作日志已统一补时间前缀；账号管理区块的“用量自动刷新频率”默认已改为禁用；当前扩展版本 `1.0.12`）

## 项目快照

- 项目名：`codex-migration-extension`
- 展示名：`Codex 迁移助手`
- 当前版本：`1.0.12`
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
- `AGENTS.md` 已补充本项目专属规则：凡是用户需要安装扩展后才能验证的 UI/行为改动，结束前必须本地重新打包 `.vsix`，不能只停留在代码修改

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

### 0.3.1 账号池 `5h/7d` 列已补充 hover 提示

当前账号池表里的 `5h/7d` 列虽然已经压缩成 `xx%/yy%`，但为了不丢掉窗口重置时间，这一列现在补了原生 hover 提示。

悬浮时会显示：

- `最近刷新`
- `5h 重置时间`
- `7d 重置时间`

这些时间都直接来自现有用量接口解析后的 `resetAt / fetchedAt`，不是额外推算。

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`

### 0.3.2 账号池表已移除“最近刷新”列

在 `5h/7d` 列已经具备 hover 提示之后，账号池表里的“最近刷新”列变成了重复信息。

这一轮继续收缩为：

- 删除账号池表的“最近刷新”列
- `最近刷新` 信息保留在 `5h/7d` 单元格的 hover 提示里
- 这样主表只保留：
  - 账号
  - `5h/7d`
  - 状态
  - 操作

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`

### 0.3.3 账号池表现在最多展示 6 条，超出后内部纵向滚动

之前账号池列表会随着账号数量持续向下扩展，容易把整块面板撑满。

现在的行为改成：

- 账号池表容器最多显示约 6 条账号
- 超出后在表内部纵向滚动
- 内部滚动条隐藏，但滚轮/触控板滚动仍然可用
- 账号管理列表不受这次调整影响
- 账号池表头在内部滚动时保持吸顶，避免长列表时丢失列标题
- 当前正在使用的账号如果不在可视区域内，会在渲染后自动滚动到可见位置
- 这块样式要单独于通用 `accounts-table-wrap` 滚动条规则维护，避免被全局滚动条样式覆盖后重新失效

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`

### 0.3.4 账号池账号列改为按真实内容宽度占位，不再吞掉右侧列

之前账号池表的账号列在浏览器默认 table auto 布局下会被拉伸，导致：

- 账号列看起来独占整块表格可视区
- `5h/7d` 和状态列容易被挤到右侧不可见区域
- 即使账号文本不长，也像是“账号列吃满整行”

现在的行为改成：

- `5h/7d`、状态、操作列使用固定列宽
- 账号列按“账号文本 + FREE/TEAM 标签”的真实内容宽度占位
- 不再对账号文本做省略号截断，保留完整可复制性
- 如果整体宽度超出容器，就走横向滚动，而不是让账号列吞掉右侧列

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`

### 0.3.5 账号池自动检测已改为串行刷新整池，再决定是否自动切换

之前账号池的定时检测逻辑是：

- 先只刷新当前正在使用的账号
- 只有当前账号不可用时，才继续逐个刷新后续候选
- 因此它不是“每隔 N 分钟刷新整个账号池”，而是偏向“按需检测并切换”

现在的行为改成：

- 只要开启账号池自动检测，并设置了非 `0` 的检测间隔
- 每一轮定时器都会按顺序刷新整个账号池
- 前一个账号刷新结束后，才会开始刷新下一个
- 不管单个账号刷新成功还是失败，都会继续刷新后续条目
- 全部刷新完成后，才基于这轮最新结果决定是否需要自动切换

这样更符合用户对“每 5 分钟批量刷新整个账号池一次”的预期，也避免旧逻辑只刷新一部分账号导致列表状态陈旧。

相关文件：

- `src/engine/tokenPool.ts`

### 0.3.6 账号池设置文案和行为已改成“自动检测/用量自动刷新”，不再自动换号

用户确认后，账号池这块不再把“自动切换”作为主路径。

现在的行为改成：

- UI 文案从“开启账号池自动切换”改成“开启账号池自动检测”
- “检测间隔”改成“用量自动刷新频率”
- “切换后自动重启 Codex”改成“手动切换后自动重启 Codex”
- 定时器触发时只做整池串行刷新
- 不再基于刷新结果自动写入 `pool-runner` 并自动换号
- 最近一轮结果显示为“最近自动检测”，而不是“最近自动切换”

为了兼容已有本地存储和消息协议，这一轮没有强行重命名底层字段：

- `autoSwitchEnabled`
- `lastAutoSwitchAt`
- `lastAutoSwitchMessage`

这些字段目前只是沿用旧名字承载“自动检测/自动刷新”的状态，不代表系统还会自动切号。

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`
- `src/engine/tokenPool.ts`

### 0.6 执行与操作日志已统一补时间前缀

这一轮专门扫描了 Webview 里的“执行与操作日志”链路，结论是：

- 绝大多数业务日志都通过 `emitTaskLog(...)` 汇总成 `TASK_LOG`
- 前端日志列表统一在 `webview/src/App.tsx` 的 `state.logs` 渲染
- 之前没有时间，是因为日志消息结构里只有 `level + message`

当前改法是统一补在公共链路上，而不是去几十个业务点手工拼时间：

- `src/ui-host/bridge.ts`
  - `emitTaskLog(...)` 现在会附带 `timestamp`
- `src/protocol/messages.ts`
  - `TASK_LOG` 协议新增 `timestamp`
- `webview/src/api/types.ts`
  - 同步前端消息类型
- `webview/src/App.tsx`
  - 操作日志统一格式化成 `[时间] [级别] 消息`
  - 前端本地补的 warning/error 也走同一个格式化 helper

这样后续新增业务日志只要继续走 `emitTaskLog(...)`，就天然会带时间，不需要再单独补。

相关文件：

- `src/ui-host/bridge.ts`
- `src/protocol/messages.ts`
- `webview/src/api/types.ts`
- `webview/src/App.tsx`

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

### 0.4.1 账号管理区块的“用量自动刷新频率”默认已改为禁用

账号管理与切换列表顶部的“用量自动刷新频率”之前默认是 `5 分钟`。

现在已经改成：

- 默认值为 `禁用`
- 仍然保留首次进入面板时的一次性用量拉取
- 只是不再默认开启后续的周期自动刷新

这样更符合“默认安静、按需开启”的使用方式，避免一打开面板就持续轮询。

相关文件：

- `webview/src/pages/AccountsManager.tsx`

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
