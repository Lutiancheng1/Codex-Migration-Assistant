import * as path from "path";

export function deriveProfilesRoot(codexHomeInput: string): string {
  const codexHome = path.resolve(codexHomeInput);
  return path.join(path.dirname(codexHome), `${path.basename(codexHome)}-profiles`);
}

export function deriveTokenPoolPaths(codexHomeInput: string): {
  profilesRoot: string;
  tokenPoolDir: string;
  metaPath: string;
  secretsPath: string;
} {
  const profilesRoot = deriveProfilesRoot(codexHomeInput);
  const tokenPoolDir = path.join(profilesRoot, "token-pool");
  return {
    profilesRoot,
    tokenPoolDir,
    metaPath: path.join(tokenPoolDir, "meta.v1.json"),
    secretsPath: path.join(tokenPoolDir, "secrets.v1.json")
  };
}

export function deriveSharedLockPath(codexHomeInput: string): string {
  return path.join(deriveProfilesRoot(codexHomeInput), ".shared-write.lock.json");
}
