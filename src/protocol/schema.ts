import { z } from "zod";
const providerSchema = z.enum(["codex", "antigravity", "claude", "gemini", "cursor"]);

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
      selectedProviders: z.array(providerSchema).optional(),
      includeState: z.boolean(),
      includeAuth: z.boolean(),
      mode: z.literal("core")
    })
  }),
  z.object({
    type: z.literal("START_PREVIEW_IMPORT"),
    payload: z.object({
      codexHome: z.string().optional(),
      backupZip: z.string().min(1),
      selectedProviders: z.array(providerSchema).optional(),
      replaceState: z.boolean(),
      importAuth: z.boolean(),
      mode: z.literal("core")
    })
  }),
  z.object({
    type: z.literal("START_IMPORT"),
    payload: z.object({
      codexHome: z.string().optional(),
      backupZip: z.string().min(1),
      selectedProviders: z.array(providerSchema).optional(),
      replaceState: z.boolean(),
      importAuth: z.boolean(),
      mode: z.literal("core")
    })
  }),
  z.object({
    type: z.literal("START_IMPORT_TO_NEW_PROFILE"),
    payload: z.object({
      codexHome: z.string().optional(),
      backupZip: z.string().min(1),
      selectedProviders: z.array(providerSchema).optional(),
      replaceState: z.boolean(),
      importAuth: z.boolean(),
      mode: z.literal("core"),
      profileName: z.string().min(1)
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
