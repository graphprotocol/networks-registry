function extractVersion(version: string): {
  major: number;
  minor: number;
  patch: number;
} {
  const [major, minor, patch] = version.split(".").map(Number);
  return { major, minor, patch };
}

export function getVersionFilenames(version: string) {
  const { major, minor, patch } = extractVersion(version);
  const filenameLatest = `TheGraphNetworksRegistry.json`;
  const filenameLatestPatch = `TheGraphNetworksRegistry_v${major}_${minor}_${patch}.json`;
  const filenameLatestMinor = `TheGraphNetworksRegistry_v${major}_${minor}_x.json`;
  const filenameLatestMajor = `TheGraphNetworksRegistry_v${major}_x_x.json`;
  const filenameRegistrySchema = `TheGraphNetworksRegistrySchema_v${major}_${minor}.json`;

  return {
    filenameLatest,
    filenameLatestPatch,
    filenameLatestMinor,
    filenameLatestMajor,
    filenameRegistrySchema,
  };
}
