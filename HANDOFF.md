# Codex Migration Extension Handoff

最后更新：2026-03-10（修正拖拽排序语义与账号池大列表渲染）

## 项目快照

- 项目名：`codex-migration-extension`
- 展示名：`Codex 迁移助手`
- 当前版本：`1.0.1`
- 形态：VS Code / Codex Webview 扩展
- 技术栈：TypeScript、React、VS Code Webview、Node.js 20+
- 目标：面向 Codex 用户的账号切换、数据迁移、备份恢复、会话清理与用量查看

## 历史路线与定位变化

根据历史对话，这个项目的路线已经明确收敛过：

- 一开始讨论过更通用的跨客户端形态
- 后来明确收敛到“只做 Codex”
- UI 方案也从通用网页工具思路，收敛成 `VS Code Webview + React + TypeScript` 扩展

当前不要再把它当成通用多客户端管理工具，默认定位就是“Codex 迁移助手扩展”。

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

截至本次更新，工作树里仍存在**未提交**改动，重点已经从“基础 token pool”推进到“pool-runner 专用槽位”模型：

- 已修改：
  - `README.md`
  - `package.json`
  - `src/engine/profiles.ts`
  - `src/engine/usage.ts`
  - `src/extension.ts`
  - `src/protocol/messages.ts`
  - `src/protocol/schema.ts`
  - `src/ui-host/bridge.ts`
  - `webview/src/App.tsx`
  - `webview/src/api/types.ts`
  - `webview/src/pages/AccountsManager.tsx`
  - `webview/src/pages/Home.tsx`
  - `webview/src/state/store.ts`
  - `webview/src/styles.css`
- 新增未提交：
  - `src/engine/tokenPool.ts`
  - `webview/src/pages/TokenPoolPanel.tsx`

不要把这批 token pool / pool-runner 相关改动当成无关噪音回滚掉。

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

### 0. 账号管理与账号池支持拖拽排序

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

### 1. pool-runner 按钮行为修复

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

### 2. token pool 重复快照刷新修复

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

### 3. 账号页自动刷新 interval 稳定化

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

### 5. 账号池自动重启 Codex 逻辑已放宽

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

### 6. 已用尽账号禁止手动切换

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

### 7. 修复 `SWITCH_TO_POOL_RUNNER` 在 Windows 首次切换时卡住

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

### 8. token pool 手动切换前必须先刷新并校验额度

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

### 9. token pool 操作列背景与 Windows 商店版启动匹配

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
