export enum ErrorCode {
  Unknown = "E_UNKNOWN",
  InvalidMessage = "E_INVALID_MESSAGE",
  BackupZipNotFound = "E_BACKUP_ZIP_NOT_FOUND",
  CodexHomeNotFound = "E_CODEX_HOME_NOT_FOUND",
  PermissionDenied = "E_PERMISSION_DENIED",
  FileLocked = "E_FILE_LOCKED",
  SharedLockBusy = "E_SHARED_LOCK_BUSY",
  InvalidBackupFormat = "E_INVALID_BACKUP_FORMAT"
}

export type AppError = {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export function asAppError(err: unknown, fallbackCode = ErrorCode.Unknown): AppError {
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
    const maybe = err as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof maybe.code === "string" && typeof maybe.message === "string") {
      return {
        code: maybe.code as ErrorCode,
        message: maybe.message,
        details: typeof maybe.details === "object" && maybe.details !== null ? (maybe.details as Record<string, unknown>) : undefined
      };
    }
  }

  if (err instanceof Error) {
    return { code: fallbackCode, message: err.message };
  }

  return { code: fallbackCode, message: "Unknown error" };
}
