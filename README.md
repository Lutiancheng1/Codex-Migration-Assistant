# AI 客户端迁移助手

面向本机与跨设备迁移场景的 VS Code 扩展，支持多客户端数据备份/导入/账号槽位管理（当前账号管理主要针对 Codex）。

## 核心能力

- 多客户端导出/导入（单 ZIP 可包含多客户端）
- 当前支持客户端：`Codex`、`Antigravity`、`Claude`、`Gemini`、`Cursor`
- 导入前预演（冲突/锁定样本）
- 导入为新账号（Codex 槽位）
- Codex 多账号槽位：新增、切换、切换并合并、删除
- 用量查询：Codex + Antigravity（支持本地提取 / 手动 token）

## 兼容说明（命令 ID 迁移）

本版本已切换到新命令前缀：

- `clientMigration.open`
- `clientMigration.export`
- `clientMigration.previewImport`
- `clientMigration.import`

同时保留旧命令前缀作为兼容别名（过渡 1 个版本）：

- `codexMigration.open`
- `codexMigration.export`
- `codexMigration.previewImport`
- `codexMigration.import`

## 导出包结构（v1）

```text
metadata.json
payload/
  providers/
    codex/
      core/
        sessions/
        rules/
        skills/
        history.jsonl
        config.toml
        version.json
        state_*.sqlite*      (可选)
        auth.json/cap_sid    (可选)
    antigravity/
      home/
      user/
    claude/
      home/
    gemini/
      home/
    cursor/
      home/
```

## 快速开始

```bash
npm install
npm run typecheck
npm run build
```

调试：

1. 终端 A：`npm run watch:webview`
2. 终端 B：`npm run watch:ext`
3. 编辑器中按 `F5` 启动 Extension Development Host

## 打包

```bash
npm run package:vsix
```

如本机默认 Node 版本较低：

```bash
npm run package:vsix:node20
```

## 安全建议

- `auth.json`、`cap_sid`、token 等属于敏感信息，默认不建议迁移。
- 导入前建议先导出一份当前本机备份。
- 账号切换前建议关闭占用客户端，避免目录锁冲突。
