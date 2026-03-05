import { z } from "zod";

export const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("INIT") }),
  z.object({
    type: z.literal("REFRESH_PROFILES"),
    payload: z
      .object({
        codexHome: z.string().optional()
      })
      .optional()
  }),
  z.object({
    type: z.literal("REFRESH_PROFILE_USAGE"),
    payload: z
      .object({
        codexHome: z.string().optional(),
        profileId: z.string().optional()
      })
      .optional()
  }),
  z.object({
    type: z.literal("PICK_PATH"),
    payload: z.object({
      kind: z.enum(["folder", "file"]),
      title: z.string().min(1),
      filters: z.record(z.array(z.string())).optional()
    })
  }),
  z.object({
    type: z.literal("PICK_DEFAULT_BACKUP"),
    payload: z
      .object({
        directory: z.string().optional()
      })
      .optional()
  }),
  z.object({
    type: z.literal("OPEN_IN_OS"),
    payload: z.object({
      path: z.string().min(1)
    })
  }),
  z.object({
    type: z.literal("CREATE_PROFILE"),
    payload: z.object({
      codexHome: z.string().optional(),
      name: z.string().min(1)
    })
  }),
  z.object({
    type: z.literal("ACTIVATE_PROFILE"),
    payload: z.object({
      codexHome: z.string().optional(),
      profileId: z.string().min(1),
      backupCurrent: z.boolean(),
      mergeFromCurrentCore: z.boolean().optional()
    })
  }),
  z.object({
    type: z.literal("DELETE_PROFILE"),
    payload: z.object({
      codexHome: z.string().optional(),
      profileId: z.string().min(1)
    })
  }),
  z.object({
    type: z.literal("START_EXPORT"),
    payload: z.object({
      codexHome: z.string().optional(),
      outputDir: z.string().min(1),
      includeState: z.boolean(),
      includeAuth: z.boolean(),
      mode: z.enum(["core", "enhanced"]),
      scope: z.enum(["active", "all", "single"]).optional(),
      profileId: z.string().min(1).optional()
    })
  }),
  z.object({
    type: z.literal("START_PREVIEW_IMPORT"),
    payload: z.object({
      codexHome: z.string().optional(),
      backupZip: z.string().min(1),
      replaceState: z.boolean(),
      importAuth: z.boolean(),
      mode: z.enum(["core", "enhanced"])
    })
  }),
  z.object({
    type: z.literal("START_IMPORT"),
    payload: z.object({
      codexHome: z.string().optional(),
      backupZip: z.string().min(1),
      replaceState: z.boolean(),
      importAuth: z.boolean(),
      mode: z.enum(["core", "enhanced"])
    })
  }),
  z.object({
    type: z.literal("START_IMPORT_TO_NEW_PROFILE"),
    payload: z.object({
      codexHome: z.string().optional(),
      backupZip: z.string().min(1),
      replaceState: z.boolean(),
      importAuth: z.boolean(),
      mode: z.enum(["core", "enhanced"]),
      profileName: z.string().min(1)
    })
  }),
  z.object({
    type: z.literal("PREVIEW_THREAD_CLEANUP"),
    payload: z.object({
      codexHome: z.string().optional(),
      threadIds: z.array(z.string().min(1)).min(1),
      scope: z.enum(["active", "all", "single"]),
      profileId: z.string().min(1).optional()
    })
  }),
  z.object({
    type: z.literal("START_THREAD_CLEANUP"),
    payload: z.object({
      codexHome: z.string().optional(),
      threadIds: z.array(z.string().min(1)).min(1),
      scope: z.enum(["active", "all", "single"]),
      profileId: z.string().min(1).optional(),
      backupEnabled: z.boolean(),
      applyMode: z.enum(["killNow", "restartLater"])
    })
  }),
  z.object({
    type: z.literal("KILL_PROCESSES"),
    payload: z.object({
      pids: z.array(z.number()),
      commands: z.array(z.string()).optional()
    })
  })
]);

export type RequestSchema = z.infer<typeof requestSchema>;
