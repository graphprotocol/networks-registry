import { Network } from "./types/registry";
import { loadNetworks } from "./utils/fs";

const ERRORS: string[] = [];

async function testURL(url: string) {
  try {
    const parsedUrl = new URL(url);
    await fetch(parsedUrl.origin, { method: "HEAD" });

    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      console.warn(`  URL returned an error: ${url} - ${response.status}`);
    } else {
      console.log(`  URL is valid and accessible: ${url}`);
    }
  } catch (error) {
    // we only care about domain errors
    console.error(`  Domain is invalid: ${url} - Error: ${error}`);
    ERRORS.push(`Domain is not available or invalid: ${url}`);
  }
}

async function validateUrls(networks: Network[]) {
  process.stdout.write("Validating URLs ... ");
  const batchSize = 30;
  const urls = [
    ...new Set(
      networks
        .flatMap((n) => [
          n.rpcUrls ?? [],
          n.explorerUrls ?? [],
          n.docsUrl ?? [],
          (n.apiUrls ?? []).map((u) => u.url),
        ])
        .flat(),
    ),
  ];

  console.log(`Found ${urls.length} URLs`);
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(testURL));
  }

  process.stdout.write("done\n");
}

async function main() {
  const [, , networksPath = "registry"] = process.argv;

  let networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  if (networks.length === 0) {
    ERRORS.push("No networks found");
  }

  await validateUrls(networks);

  if (ERRORS.length > 0) {
    console.error(`${ERRORS.length} Validation errors:`);
    for (const error of ERRORS) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log("All networks are valid");
}

await main();
