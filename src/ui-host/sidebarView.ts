import * as vscode from "vscode";
import { bindBridge } from "./bridge";
import { renderWebviewHtml } from "./webviewHtml";

export const SIDEBAR_VIEW_ID = "clientMigration.sidebarView";

export class CodexSidebarViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist-webview")]
    };

    webviewView.webview.html = await renderWebviewHtml(webviewView.webview, this.context.extensionUri);
    const bridge = bindBridge(this.context, { webview: webviewView.webview });

    webviewView.onDidDispose(() => bridge.dispose());
  }
}
