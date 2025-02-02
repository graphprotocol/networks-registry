import { printErrorsAndWarnings } from "./print";
import { Network } from "./types/registry";
import { applyEnvVars } from "./utils/env";
import { loadNetworks } from "./utils/fs";

const ERRORS: string[] = [];
const WARNINGS: string[] = [];
const TIMEOUT = 10000;
const FETCH_BATCH_SIZE = 30;

// calls processor function on each item of items, in parallel, up to batchSize items at a time
async function processQueue<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  batchSize: number = FETCH_BATCH_SIZE,
) {
  console.log(`Processing queue with ${items.length} items`);
  const queue = [...items];
  const inProgress = new Set<Promise<void>>();

  while (queue.length > 0 || inProgress.size > 0) {
    while (inProgress.size < batchSize && queue.length > 0) {
      const next = queue.shift()!;
      const promise = processor(next).then(() => {
        inProgress.delete(promise);
      });
      inProgress.add(promise);
    }
    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }
  }
}

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
      console.log(
        `  ${networkId} - URL returned an error, which is probably fine: ${url} - ${response.status}`,
      );
    } else {
      console.log(`  ${networkId} - URL is valid and accessible: ${url}`);
    }
  } catch (e) {
    // we only care about thrown connection errors
    console.error(`  ${networkId} - exception at ${url}: ${e.message}`);
    ERRORS.push(`\`${networkId}\` - unreachable: ${url}`);
  }
}

async function testRpc({ network, url }: { network: Network; url: string }) {
  try {
    const urlExpanded = applyEnvVars(url);
    if (!urlExpanded) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    const response = await fetch(urlExpanded, {
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
      const err = `\`${network.id}\` - failed to query RPC endpoint: ${url}`;
      ERRORS.push(err);
      console.error(err);
      return;
    }

    const data = await response.json();
    if (data.error || !data.result) {
      const err = `\`${network.id}\` - empty response from RPC endpoint: ${url}`;
      WARNINGS.push(err);
      console.warn(err);
      return;
    }

    const genesisHash = data.result.hash;
    if (genesisHash.toLowerCase() !== network.genesis?.hash.toLowerCase()) {
      const err = `\`${network.id}\` - mismatched genesis hash at RPC endpoint: ${url}`;
      ERRORS.push(err);
      console.error(err);
      return;
    }
    console.log(`  ${network.id}: genesis validated at ${url}: ${genesisHash}`);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      ERRORS.push(`\`${network.id}\` - RPC request timed out: ${url}`);
    } else {
      ERRORS.push(`\`${network.id}\` - unreachable RPC endpoint: ${url}`);
    }
    console.error(`\`${network.id}\` - exception at ${url}: ${e.message}`);
  }
}

async function validateRpcs(networks: Network[]) {
  process.stdout.write("Validating RPC genesis blocks ... \n");
  const urls = networks
    .filter((n) => n.genesis && n.caip2Id.startsWith("eip155"))
    .flatMap((n) => (n.rpcUrls ?? []).map((url) => ({ url, network: n })));

  await processQueue(urls, testRpc);
  process.stdout.write("done\n");
}

async function validateDomains(networks: Network[]) {
  process.stdout.write("Validating URLs ... \n");
  const urls = networks.flatMap((n) =>
    [
      // n.rpcUrls ?? [],
      n.explorerUrls ?? [],
      n.docsUrl ?? [],
      (n.apiUrls ?? []).map((u) => u.url),
    ]
      .flat()
      .map((url) => ({ url, networkId: n.id })),
  );
  await processQueue(urls, testURL);
  process.stdout.write("done\n");
}

export async function validateUrls(networksPath: string) {
  let networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  if (networks.length === 0) {
    ERRORS.push("No networks found");
  }

  await validateDomains(networks);
  await validateRpcs(networks);

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
