import { printErrorsAndWarnings } from "./print";
import { Network } from "./types/registry";
import { applyEnvVars } from "./utils/env";
import { loadNetworks } from "./utils/fs";

const ERRORS: string[] = [];
const WARNINGS: string[] = [];
const TIMEOUT = 10000;

async function testURL({ url, networkId }: { url: string; networkId: string }) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(
        `  ${networkId} - URL returned an error: ${url} - ${response.status}`,
      );
    } else {
      console.log(`  ${networkId} - URL is valid and accessible: ${url}`);
    }
  } catch (error) {
    // we only care about thrown connection errors
    console.error(
      `  ${networkId} - Domain unreachable: ${url} - Error: ${error}`,
    );
    ERRORS.push(`\`${networkId}\` - unreachable: ${url}`);
  }
}

async function validateRpc(networks: Network[]) {
  process.stdout.write("Validating RPC genesis blocks ... ");

  const ethNetworks = networks.filter(
    (n) => n.genesis && n.caip2Id.startsWith("eip155"),
  );

  await Promise.all(
    ethNetworks.map(async (network) => {
      const rpcUrls = (network.rpcUrls ?? []).map(applyEnvVars).filter(Boolean);
      for (const rpcUrl of rpcUrls) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), TIMEOUT);

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
              `\`${network.id}\` - failed to query RPC endpoint: ${rpcUrl}`,
            );
            continue;
          }
          const data = await response.json();

          if (data.error || !data.result) {
            WARNINGS.push(
              `\`${network.id}\` - empty response from RPC endpoint: ${rpcUrl}`,
            );
            continue;
          }

          const genesisHash = data.result.hash;
          if (
            genesisHash.toLowerCase() !== network.genesis?.hash.toLowerCase()
          ) {
            ERRORS.push(
              `\`${network.id}\` - mismatched genesis hash at RPC endpoint: ${rpcUrl}`,
            );
          }
          console.log(
            `  ${network.id}: genesis hash validated at ${rpcUrl}: ${genesisHash}`,
          );
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") {
            ERRORS.push(
              `\`${network.id}\` - RPC request timed out after 10s: ${rpcUrl}`,
            );
          } else {
            ERRORS.push(
              `\`${network.id}\` - exception querying RPC endpoint: ${rpcUrl}`,
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
  const urls = networks.flatMap((n) => {
    const urls = [
      n.rpcUrls ?? [],
      n.explorerUrls ?? [],
      n.docsUrl ?? [],
      (n.apiUrls ?? []).map((u) => u.url),
    ].flat();
    return urls.map((url) => ({ url, networkId: n.id }));
  });

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

  await validateDomains(networks);
  // sleep a bit for rate-limits
  await new Promise((resolve) => setTimeout(resolve, 3000));
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
