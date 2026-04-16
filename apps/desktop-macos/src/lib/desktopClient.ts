import { invoke } from "@tauri-apps/api/core";

export type DesktopRunnerResponse<T = unknown> =
  | {
      ok: true;
      result: {
        snapshot?: T;
        data?: unknown;
        messages: string[];
        warnings: string[];
        errors: string[];
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
      details?: unknown;
    };

export async function runDesktopCommand<TSnapshot = unknown, TResult = unknown>(request: unknown): Promise<{
  snapshot?: TSnapshot;
  data?: TResult;
  messages: string[];
  warnings: string[];
  errors: string[];
}> {
  const response = await invoke<DesktopRunnerResponse<TSnapshot>>("run_backend_command", { request });
  if (!response.ok) {
    throw new Error(`${response.code}: ${response.message}`);
  }
  return {
    snapshot: response.result.snapshot,
    data: response.result.data as TResult | undefined,
    messages: response.result.messages,
    warnings: response.result.warnings,
    errors: response.result.errors
  };
}
