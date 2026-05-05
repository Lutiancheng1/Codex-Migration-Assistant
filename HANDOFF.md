# Codex Migration Extension Handoff

最后更新：2026-05-05（已按用户要求移除 Tauri/macOS 独立 app 架构，仓库重新收回为纯扩展主线；账号池 `5h/7d` 列已补 hover 提示并在 README 标明悬浮百分比可查看最近刷新 / 5h 重置 / 7d 重置时间；账号池表已移除“最近刷新”列，并限制为最多显示 6 条后内部滚动，且当前账号会自动滚入可视区；账号池表头集成套餐筛选、视图排序、只看可用和按分类批量刷新；批量刷新菜单已从原生 select 改成按钮式菜单项，当前分类也可重复点击刷新，菜单宽度已收紧为按内容自然撑开；账号池设置已改成“自动检测/用量自动刷新频率”，频率只保留禁用 / 5m / 15m / 30m / 1h；Codex token 刷新已接入 CLIProxyAPI 同款 refresh_token 续期逻辑；账号池导入会记录来源路径，刷新前可同步 CLIProxy / 文件源里的最新 token；重复导入同邮箱同套餐会覆盖并合并历史重复项，多个 Team 邮箱共享 accountId 时不会误合并；无 CLIProxy 用户继续走插件本地托管刷新；refresh_token 预检续期失败但 access_token 查询成功时不再输出 warn 噪音；共享写锁错误现在归类为 E_FILE_LOCKED；README 已重写并补清核心价值、核心架构、数据边界和发布说明；扩展详情页 description 已改成准确描述；执行与操作日志已统一补时间前缀；账号管理区块的“用量自动刷新频率”默认已改为禁用；当前扩展版本 `1.0.20`）

## 项目快照

- 项目名：`codex-migration-extension`
- 展示名：`Codex 迁移助手`
- 当前版本：`1.0.20`
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
- token pool 单条额度刷新、按分类批量刷新、整池自动检测与可选切换后自动重启 Codex

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

### 0.3.4.1 账号池表新增只看可用、套餐筛选和视图排序

账号池表现在支持表头内置视图和刷新控件，不再单独占用一整行工具栏。

- `账号` 表头：
  - 套餐筛选
  - 全部套餐
  - Pro
  - Team
  - Plus
  - Free
  - 视图排序
  - 手动顺序
  - 套餐分组：`Pro > Team > Plus > Free`
  - 可用优先
  - 剩余额度高优先
  - 最近刷新优先
- `状态` 表头：
  - `只看可用账号`
  - 只显示 `status === available` 的池账号
- `5h/7d` 表头：
  - 右侧有刷新图标
  - 点开后是分类菜单项
  - 点击分类后立即触发批量刷新，无需确认按钮
  - 当前高亮分类也可以重复点击刷新，避免原生 select 选择相同值不触发 `onChange` 的问题

重要边界：

- 这些筛选 / 排序只影响当前表格展示
- 不会改变 token pool metadata 里的真实顺序
- 只有在 `全部套餐 + 未开启只看可用 + 手动顺序` 的默认视图下，拖拽排序和上移 / 下移才启用
- 在筛选或排序视图下，上移 / 下移和拖拽会禁用，避免用户误以为当前视图排序会写回真实池顺序

相关文件：

- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`
- `README.md`

### 0.3.4.2 账号池自动检测频率已收窄

账号池“用量自动刷新频率”选项已按用户要求收窄为：

- 禁用
- 每 5 分钟
- 每 15 分钟
- 每 30 分钟
- 每 1 小时

同时后端 `normalizeInterval` 已同步允许 `1h`，并移除 `1m / 3m`，避免前端保存后被后端归一化回默认值。

相关文件：

- `src/engine/tokenPool.ts`
- `webview/src/pages/TokenPoolPanel.tsx`

### 0.3.4.3 扩展详情页描述已更新

VSIX 扩展详情页主要读取：

- `package.json` 的 `displayName`
- `package.json` 的 `description`
- `README.md`
- `media/codex-migration.png`

之前 `description` 里还写着 `pool-runner 账号池无感换号`，和当前“手动切换 + 自动检测刷新”的产品边界不完全一致。

现在改为：

- `Codex 本地数据迁移、多账号槽位、账号池 token 管理、用量刷新与会话清理工具。`

相关文件：

- `package.json`

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

### 0.3.7 账号池已新增按分类批量刷新

账号池列表现在支持手动选择分类后批量刷新用量。

当前行为：

- 前端会读取当前账号池条目并统计分类数量
- 分类来源优先使用 `usage.planType`
- 如果账号还没刷新过，则回退到 `planTypeHint`
- UI 提供：
  - 全部账号
  - Free
  - Plus
  - Team
  - Pro
- 用户选择分类后点击“刷新选中分类”
- 后端按当前真实账号池数据重新筛选分类，再串行刷新匹配条目
- 前一个账号刷新结束后，才会刷新下一个账号
- 单个账号失败不会中断后续条目刷新

这块新增了独立消息：

- `REFRESH_TOKEN_POOL_GROUP_USAGE`

相关文件：

- `src/engine/tokenPool.ts`
- `src/protocol/messages.ts`
- `src/protocol/schema.ts`
- `src/ui-host/bridge.ts`
- `webview/src/api/types.ts`
- `webview/src/App.tsx`
- `webview/src/pages/AccountsManager.tsx`
- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`

### 0.3.8 Codex token 刷新已接入 CLIProxyAPI 同款 refresh_token 续期逻辑

这次对照了本地 `CLIProxyAPI` 的 Codex OAuth 实现，核心逻辑在：

- `internal/auth/codex/openai_auth.go`
- `sdk/auth/codex.go`

CLIProxyAPI 的 token 并不是“天然永不过期”，而是：

- 使用 `https://auth.openai.com/oauth/token`
- `grant_type=refresh_token`
- `client_id=app_EMoamEEZ73f0CkXaXp7hrann`
- Codex provider 设置了 `5 * 24h` 的 refresh lead
- 续期成功后持久化新的 `access_token / id_token / refresh_token / expired / last_refresh`

当前扩展已迁移这套核心策略：

- 账号槽位刷新用量前，会在 token 即将过期时自动续期并写回 `auth.json`
- 如果用量接口返回 `token_expired`，会强制续期后重试一次
- 账号池单条刷新、按分类批量刷新、自动检测整池刷新都会走同一套续期逻辑
- 账号池条目续期成功后会写回 token pool secret 和 metadata
- 手动切换账号池条目时，写入 `pool-runner/auth.json` 的是最新 token
- 账号槽位刷新用量现在进入共享写锁，因为刷新过程可能写回新 token

边界：

- 如果 `refresh_token` 已失效、被复用或被服务端拒绝，会明确提示重新登录
- 不读取、不打印、不记录任何实际 token 内容
- 续期失败时，如果旧 `access_token` 仍可用，会尝试继续查询；如果旧 token 也过期，则按失败提示展示

相关文件：

- `src/engine/usage.ts`
- `src/engine/tokenPool.ts`
- `src/ui-host/bridge.ts`
- `test/usage.test.mjs`

### 0.3.8.1 账号池刷新日志已避免 refresh_token 预检噪音

之前账号池刷新会先尝试 `refresh_token` 续期。

如果 refresh_token 已失效，但当前 `access_token` 仍然能查用量，旧逻辑会先打一条 warn：

- `账号池条目登录态续期失败，将尝试使用现有 access_token 查询...`

随后又显示刷新成功。这会让批量刷新日志看起来像“失败很多，但最后成功”，容易误判为批量刷新有问题。

现在改成：

- 预检续期失败时先不立即打 warn
- 如果后续 `access_token` 查询成功，本次刷新按成功处理，不输出续期失败噪音
- 只有最终用量查询也失败时，才把 refresh/usage 错误作为失败原因展示

相关文件：

- `src/engine/tokenPool.ts`

### 0.3.8.2 共享写锁错误码已从 E_UNKNOWN 修正为 E_FILE_LOCKED

之前共享写锁竞争时，日志会显示：

- `E_UNKNOWN: 共享数据正在被其它客户端写入...`

实际这是锁竞争，不是未知错误。

现在 bridge 会识别这类错误，并归类为：

- `E_FILE_LOCKED`

相关文件：

- `src/ui-host/bridge.ts`

### 0.3.8.3 账号池已补 CLIProxy / 文件源同步

当前账号池新增来源追踪：

- 从文件 / 目录导入 token JSON 时，secret 和 metadata 会记录：
  - `sourcePath`
  - `sourceKind`（`cliProxy` / `file`）
- 从 `.cli-proxy-api` 或 `codex-*.json` 导入的条目识别为 `CLIProxy`
- 账号池列表会在账号右侧显示 `CLIProxy` / `FILE` 来源标签
- 单条刷新、分类批量刷新、自动检测刷新前会先尝试读取来源 JSON 中的最新 token
- 重复导入时会按“同邮箱 + 同套餐分类”优先覆盖旧条目，即使来源路径和 token 指纹已经变化
- 没有邮箱时才回退到“同 accountId + 同套餐分类”
- 多个 Team 邮箱共享同一个 accountId 时会按邮箱保留为不同条目，避免误合并
- 如果账号池里已经有旧版本造成的同邮箱同套餐重复项，下次导入同邮箱同套餐 JSON 时会合并掉多余重复项
- 同邮箱的 Free / Team / Plus / Pro 仍按套餐分类保留为不同条目，不会互相覆盖
- 来源文件缺失或格式不合法时，回退到账号池本地 secret 缓存
- 没有 CLIProxy 的用户不受影响，插件仍用本地 secret 的 `refresh_token` 托管续期
- 已失效的 `refresh_token` 不能被插件救活，必须重新登录后重新导入

另外，导入 token 文件 / 目录时，VS Code 文件选择器会记住上一次选择的目录，不做默认目录探测，避免误读用户未选择的本地认证目录。

相关文件：

- `src/engine/tokenPool.ts`
- `src/ui-host/bridge.ts`
- `src/protocol/messages.ts`
- `webview/src/api/types.ts`
- `webview/src/pages/TokenPoolPanel.tsx`
- `webview/src/styles.css`
- `test/token-pool.test.mjs`
- `README.md`

### 0.3.9 README 已重写并补清核心价值、核心架构和发布说明

这一轮按发布前仓库说明标准整理了 `README.md`。

新增重点：

- 核心价值
  - 跨设备迁移不再靠手工拷目录
  - 多账号使用不再混写同一份 `.codex`
  - 账号池只切登录态，不破坏当前工作记录
  - 用量刷新接入 refresh_token 续期
  - 危险操作可观察、可预演、可校验
- 功能边界
  - 导出 / 导入
  - 账号槽位
  - 账号池
  - 用量刷新与 token 续期
  - 对话清理
- 核心架构
  - `src/extension.ts`
  - `src/ui-host`
  - `src/protocol`
  - `src/engine`
  - `src/util`
  - `webview`
- 数据目录、单写锁、安全说明、安装、构建、发布命令和已知限制
- `5h/7d` 列说明，明确 hover 百分比可查看最近刷新时间、5h 重置时间和 7d 重置时间

相关文件：

- `README.md`

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
