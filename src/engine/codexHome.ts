import { exists } from "../util/fs";
import { resolveCodexHome } from "../util/path";
import { ErrorCode } from "../protocol/errors";

export async function resolveAndValidateCodexHome(input?: string): Promise<string> {
  const codexHome = resolveCodexHome(input);
  const ok = await exists(codexHome);
  if (!ok) {
    const err = new Error(`Codex home does not exist: ${codexHome}`) as Error & { code: ErrorCode };
    err.code = ErrorCode.CodexHomeNotFound;
    throw err;
  }
  return codexHome;
}
