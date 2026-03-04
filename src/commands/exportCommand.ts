import * as vscode from "vscode";

export async function executeExport(context: vscode.ExtensionContext): Promise<void> {
  await vscode.commands.executeCommand("codexMigration.open");
  void context;
}
