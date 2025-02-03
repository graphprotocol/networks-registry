import { printErrorsAndWarnings } from "./print";
import { Network } from "./types/registry";
import { applyEnvVars } from "./utils/env";
import { loadNetworks } from "./utils/fs";

const ERRORS: string[] = [];
const WARNINGS: string[] = [];
const TIMEOUT = 10000;
const FETCH_BATCH_SIZE = 30;

// calls processor function on each item of items, in parallel, up to batchSize items at a time
async function processQueue<T, S>(
  items: T[],
  processor: (item: T) => Promise<S>,
  batchSize: number = FETCH_BATCH_SIZE,
): Promise<S[]> {
  console.log(`Processing queue with ${items.length} items`);
  const queue = [...items];
  const inProgress = new Map<Promise<S>, number>();
  const results: S[] = new Array(items.length);
  let nextIndex = 0;

  while (queue.length > 0 || inProgress.size > 0) {
    while (inProgress.size < batchSize && queue.length > 0) {
      const item = queue.shift()!;
      const index = nextIndex++;
      const promise = processor(item).then((result) => {
        results[index] = result;
        inProgress.delete(promise);
        return result;
      });
      inProgress.set(promise, index);
    }
    if (inProgress.size > 0) {
      await Promise.race(inProgress.keys());
    }
  }

  return results;
}

async function testURL({
  url,
  networkId,
}: {
  url: string;
  networkId: string;
}): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = `${networkId} - ${url} returned ${response.status}`;
      //acceptable error codes
      if ([308, 307, 403].includes(response.status)) {
        console.warn(err);
        return true;
      }
      console.error(err);
      WARNINGS.push(err);
      return false;
    }
    console.log(`  ${networkId} - URL is valid and accessible: ${url}`);
  } catch (e) {
    // we only care about thrown connection errors
    console.error(`  ${networkId} - exception at ${url}: ${e.message}`);
    ERRORS.push(`\`${networkId}\` - unreachable: ${url}`);
    return false;
  }
  return true;
}

async function testAPI({
  url,
  kind,
  networkId,
}: {
  url: string;
  kind: string;
  networkId: string;
}): Promise<boolean> {
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
    // we only care about thrown connection errors for now
    console.error(`  ${networkId} - exception at ${url}: ${e.message}`);
    ERRORS.push(`\`${networkId}\` - unreachable: ${url}`);
    return false;
  }
  return true;
}

async function testRpc({
  network,
  url,
}: {
  network: Network;
  url: string;
}): Promise<boolean> {
  try {
    const urlExpanded = applyEnvVars(url);
    if (!urlExpanded) {
      return false; // private RPC
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
      WARNINGS.push(err);
      console.error(err);
      return false;
    }

    const data = await response.json();
    if (data.error || !data.result) {
      const err = `\`${network.id}\` - empty response from RPC endpoint: ${url}`;
      WARNINGS.push(err);
      console.warn(err);
      return true; //consider it valid
    }

    const genesisHash = data.result.hash;
    if (genesisHash.toLowerCase() !== network.genesis?.hash.toLowerCase()) {
      const err = `\`${network.id}\` - mismatched genesis hash at RPC endpoint: ${url}`;
      ERRORS.push(err);
      console.error(err);
      return false;
    }
    console.log(`  ${network.id}: genesis validated at ${url}: ${genesisHash}`);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      WARNINGS.push(`\`${network.id}\` - RPC request timed out: ${url}`);
    } else {
      WARNINGS.push(`\`${network.id}\` - unreachable RPC endpoint: ${url}`);
    }
    console.error(`\`${network.id}\` - exception at ${url}: ${e.message}`);
    return false;
  }
  return true;
}

async function validateRpcs(networks: Network[]) {
  console.log("Validating RPC genesis blocks ... ");
  const ethNetworks = networks.filter(
    (n) => n.genesis && n.caip2Id.startsWith("eip155"),
  );
  const urls = ethNetworks.flatMap((n) =>
    (n.rpcUrls ?? []).map((url) => ({ url, network: n })),
  );

  const results = await processQueue(urls, testRpc);

  // Check each network for valid RPC endpoints
  for (const network of ethNetworks) {
    const networkUrls = urls
      .map((u, i) => ({ url: u.url, valid: results[i] }))
      .filter(({ url }) => network.rpcUrls?.includes(url));
    if (networkUrls.length > 0 && !networkUrls.some(({ valid }) => valid)) {
      ERRORS.push(`\`${network.id}\` - no working public RPC endpoints found`);
    }
  }

  console.log(
    `RPC validation complete: ${results.filter(Boolean).length}/${urls.length} endpoints validated successfully\n`,
  );
}

async function validateDocs(networks: Network[]) {
  console.log("Validating URLs ... ");
  const urls = networks.flatMap((n) =>
    [
      n.explorerUrls ?? [],
      n.docsUrl ?? [],
      (n.indexerDocsUrls ?? []).map((u) => u.url),
    ]
      .flat()
      .map((url) => ({ url, networkId: n.id })),
  );
  const results = await processQueue(urls, testURL);
  console.log(
    `Docs validation complete: ${results.filter(Boolean).length}/${urls.length} endpoints accessible\n`,
  );
}

async function validateApis(networks: Network[]) {
  console.log("Validating APIs ... ");
  const urls = networks.flatMap((n) =>
    (n.apiUrls ?? []).map(({ url, kind }) => ({ url, kind, networkId: n.id })),
  );
  const results = await processQueue(urls, testAPI);

  console.log(
    `API validation complete: ${results.filter(Boolean).length}/${urls.length} endpoints accessible\n`,
  );
}

export async function validateUrls(networksPath: string) {
  let networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  if (networks.length === 0) {
    ERRORS.push("No networks found");
  }

  await validateDocs(networks);
  await validateApis(networks);
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
