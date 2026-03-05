import * as vscode from "vscode";
import { executeExport } from "./commands/exportCommand";
import { executeImport } from "./commands/importCommand";
import { executeOpenPanel } from "./commands/openPanel";
import { executePreviewImport } from "./commands/previewImportCommand";
import { CodexSidebarViewProvider, SIDEBAR_VIEW_ID } from "./ui-host/sidebarView";
import { getLogger } from "./util/logger";

export function activate(context: vscode.ExtensionContext): void {
  const logger = getLogger();
  logger.appendLine("AI Client Migration Assistant activated.");

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, new CodexSidebarViewProvider(context)),
    vscode.commands.registerCommand("clientMigration.open", () => executeOpenPanel(context)),
    vscode.commands.registerCommand("clientMigration.export", () => executeExport(context)),
    vscode.commands.registerCommand("clientMigration.previewImport", () => executePreviewImport(context)),
    vscode.commands.registerCommand("clientMigration.import", () => executeImport(context)),
    vscode.commands.registerCommand("codexMigration.open", () => vscode.commands.executeCommand("clientMigration.open")),
    vscode.commands.registerCommand("codexMigration.export", () => vscode.commands.executeCommand("clientMigration.export")),
    vscode.commands.registerCommand("codexMigration.previewImport", () => vscode.commands.executeCommand("clientMigration.previewImport")),
    vscode.commands.registerCommand("codexMigration.import", () => vscode.commands.executeCommand("clientMigration.import")),
    logger
  );
}

export function deactivate(): void {
  // no-op
}
