import { printErrorsAndWarnings } from "./print";
import { Network } from "./types/registry";
import { loadNetworks } from "./utils/fs";

const ERRORS: string[] = [];
const WARNINGS: string[] = [];

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

async function validateRpc(networks: Network[]) {
  process.stdout.write("Validating RPC genesis blocks ... ");

  const ethNetworks = networks.filter(
    (n) => n.genesis && n.caip2Id.startsWith("eip155"),
  );

  await Promise.all(
    ethNetworks.map(async (network) => {
      for (const rpcUrl of network.rpcUrls ?? []) {
        if (rpcUrl.includes("{")) {
          continue;
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getBlockByNumber",
              params: [`0x${network.genesis?.height.toString(16)}`, false],
            }),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!response.ok) {
            ERRORS.push(
              `Network ${network.id} failed to query public RPC: ${rpcUrl}`,
            );
            continue;
          }
          const data = await response.json();

          if (data.error || !data.result) {
            WARNINGS.push(
              `Network ${network.id} empty response from public RPC: ${rpcUrl}`,
            );
            continue;
          }

          const genesisHash = data.result.hash;
          if (
            genesisHash.toLowerCase() !== network.genesis?.hash.toLowerCase()
          ) {
            ERRORS.push(
              `Network ${network.id} has mismatched genesis hash: RPC=${genesisHash} registry=${network.genesis?.hash}`,
            );
          }
          console.log(
            `  ${network.id}: genesis hash validated at ${rpcUrl}: ${genesisHash}`,
          );
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") {
            ERRORS.push(
              `Network ${network.id} RPC request timed out after 10s: ${rpcUrl}`,
            );
          } else {
            ERRORS.push(
              `Network ${network.id} exception querying public RPC: ${rpcUrl}`,
            );
          }
        }
      }
    }),
  );

  process.stdout.write("done\n");
}

async function validateDomains(networks: Network[]) {
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

export async function validateUrls(networksPath: string) {
  let networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  if (networks.length === 0) {
    ERRORS.push("No networks found");
  }

  // await validateDomains(networks);
  await validateRpc(networks);

  return {
    errors: ERRORS.map((e) => `[urls] ${e}`),
    warnings: WARNINGS.map((e) => `[urls] ${e}`),
  };
}

async function main() {
  const [, , networksPath = "registry"] = process.argv;

  const { errors, warnings } = await validateUrls(networksPath);

  printErrorsAndWarnings(errors, warnings);
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Only run main() if this file is being run directly
if (import.meta.main) {
  await main();
}
