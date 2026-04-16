import * as vscode from "vscode";
import { executeExport } from "./commands/exportCommand";
import { executeImport } from "./commands/importCommand";
import { executeOpenPanel } from "./commands/openPanel";
import { executePreviewImport } from "./commands/previewImportCommand";
import { initializeTokenPoolService } from "./engine/tokenPool";
import { CodexSidebarViewProvider, SIDEBAR_VIEW_ID } from "./ui-host/sidebarView";
import { getLogger } from "./util/logger";

export function activate(context: vscode.ExtensionContext): void {
  const logger = getLogger();
  logger.appendLine("Codex Migration Assistant activated.");

  context.subscriptions.push(
    initializeTokenPoolService(context, {
      info: (message) => {
        void vscode.window.showInformationMessage(message);
      },
      warn: (message) => {
        void vscode.window.showWarningMessage(message);
      }
    }),
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, new CodexSidebarViewProvider(context)),
    vscode.commands.registerCommand("codexMigration.open", () => executeOpenPanel(context)),
    vscode.commands.registerCommand("codexMigration.export", () => executeExport(context)),
    vscode.commands.registerCommand("codexMigration.previewImport", () => executePreviewImport(context)),
    vscode.commands.registerCommand("codexMigration.import", () => executeImport(context)),
    logger
  );
}

export function deactivate(): void {
  // no-op
}
