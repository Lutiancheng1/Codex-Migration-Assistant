import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

function nonce(length = 20): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

async function readIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

export async function renderWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const n = nonce();
  const distRoot = path.join(extensionUri.fsPath, "dist-webview");

  const cssDisk = path.join(distRoot, "index.css");
  const jsDisk = path.join(distRoot, "index.js");

  const cssUri = webview.asWebviewUri(vscode.Uri.file(cssDisk));
  const jsUri = webview.asWebviewUri(vscode.Uri.file(jsDisk));

  const fallbackHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI 客户端迁移助手</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
    pre { white-space: pre-wrap; }
  </style>
</head>
<body>
  <h2>AI 客户端迁移助手</h2>
  <p>Webview 资源尚未构建。</p>
  <pre>运行: npm install && npm run build</pre>
</body>
</html>`;

  const exists = await readIfExists(jsDisk);
  if (!exists) {
    return fallbackHtml;
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${cssUri}" rel="stylesheet" />
  <title>AI 客户端迁移助手</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${n}" src="${jsUri}"></script>
</body>
</html>`;
}
