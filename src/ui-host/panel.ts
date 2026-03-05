import * as vscode from "vscode";
import { renderWebviewHtml } from "./webviewHtml";

let currentPanel: vscode.WebviewPanel | undefined;

export async function openPanel(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    return currentPanel;
  }

  const panel = vscode.window.createWebviewPanel("clientMigration.panel", "AI 客户端迁移助手", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist-webview")]
  });

  panel.onDidDispose(() => {
    currentPanel = undefined;
  });

  panel.webview.html = await renderWebviewHtml(panel.webview, context.extensionUri);
  currentPanel = panel;
  return panel;
}
