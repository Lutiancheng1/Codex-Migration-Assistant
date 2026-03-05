import * as vscode from "vscode";
import { bindBridge } from "../ui-host/bridge";
import { openPanel } from "../ui-host/panel";

const bridgeMap = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();

export async function executeOpenPanel(context: vscode.ExtensionContext): Promise<void> {
  const panel = await openPanel(context);
  if (bridgeMap.has(panel)) {
    return;
  }

  const bridge = bindBridge(context, panel);
  bridgeMap.set(panel, bridge);
  panel.onDidDispose(() => {
    bridge.dispose();
    bridgeMap.delete(panel);
  });
}
