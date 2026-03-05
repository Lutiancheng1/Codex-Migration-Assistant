import * as vscode from "vscode";

export async function executeExport(context: vscode.ExtensionContext): Promise<void> {
  await vscode.commands.executeCommand("clientMigration.open");
  void context;
}
