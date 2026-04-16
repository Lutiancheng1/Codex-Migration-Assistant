import type * as vscode from "vscode";

type LoggerLike = {
  appendLine(message: string): void;
  dispose(): void;
};

let channel: LoggerLike | undefined;

function createConsoleLogger(): LoggerLike {
  return {
    appendLine(message: string) {
      console.log(`[Codex Migration Assistant] ${message}`);
    },
    dispose() {
      // no-op for desktop/CLI fallback
    }
  };
}

export function getLogger(): LoggerLike {
  if (channel) {
    return channel;
  }

  try {
    const runtime = require("vscode") as typeof vscode;
    channel = runtime.window.createOutputChannel("Codex Migration Assistant");
    return channel;
  } catch {
    channel = createConsoleLogger();
    return channel;
  }
}
