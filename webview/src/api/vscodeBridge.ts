import type { RequestMessage } from "./types";

type VscodeApi = {
  postMessage(message: RequestMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VscodeApi;
  }
}

const vscode = window.acquireVsCodeApi?.();

export function post(message: RequestMessage): void {
  if (!vscode) {
    return;
  }
  vscode.postMessage(message);
}
