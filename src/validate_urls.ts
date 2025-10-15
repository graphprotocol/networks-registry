import { printErrorsAndWarnings } from "./print";
import { Network } from "./types/registry";
import { applyEnvVars } from "./utils/env";
import { processQueue, withRetry } from "./utils/retry";
import { loadNetworks } from "./utils/fs";

const ERRORS: string[] = [];
const WARNINGS: string[] = [];
const FETCH_TIMEOUT_MS = 10000;

const ALLOWED_RPC_ERRORS = {
  "https://sei-evm-rpc.publicnode.com": "height is not available",
};

async function testURL({
  url,
  networkId,
}: {
  url: string;
  networkId: string;
}): Promise<boolean> {
  try {
    await withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url, {
        method: "HEAD",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const err = `${networkId} - ${url} returned ${response.status}`;
        //acceptable error codes
        if ([308, 307, 403].includes(response.status)) {
          console.warn(err + " (acceptable error)");
          return;
        }
        throw new Error(err);
      }
    }, url);
  } catch (e) {
    // Only add warning/error after all retries have failed
    console.error(`  ${networkId} - exception at ${url}: ${e.message}`);
    WARNINGS.push(`\`${networkId}\` - unreachable URL: ${url}`);
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
    await withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const response = await fetch(
          `${url}?module=contract&action=getsourcecode&address=0x0000000000001267532f4387C34a5AA50A8D4284`,
          {
            signal: controller.signal,
          },
        );

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`status ${response.status}`);
        }
        const body = await response.json().catch(() => undefined);
        if (!body) {
          throw new Error("non-JSON response");
        }
        if (body.status != "1" && !body.result?.includes("not verified")) {
          throw new Error(`invalid response: ${body.status} - ${body.message}`);
        }
        console.log(`  ${networkId} - ${url} is valid`);
      },
      url,
      5, // max attempts
      30_000, // for rate-limiting
      0.2, // jitter
    );
  } catch (e) {
    let errorMessage = "unknown error";
    if (e instanceof Error) {
      if (e.message.includes("Unable to connect")) {
        errorMessage = "unreachable host";
      } else if (e.name === "AbortError") {
        errorMessage = "request timeout";
      } else {
        errorMessage = e.message;
      }
    }
    const err = `\`${networkId}\` - ${errorMessage} at API endpoint: ${url}`;
    WARNINGS.push(err);
    console.error(err);
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
    await withRetry(async () => {
      const urlExpanded = applyEnvVars(url);
      if (urlExpanded === "") {
        return false;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const firstBlock = network.firehose?.firstStreamableBlock?.height ?? 0;
      const hash = network.firehose?.firstStreamableBlock?.id ?? "";
      const response = await fetch(urlExpanded, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBlockByNumber",
          params: [`0x${firstBlock.toString(16)}`, false],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`bad status: ${response.status}`);
      }

      const data = await response.json();
      if (data?.error) {
        if (
          ALLOWED_RPC_ERRORS[url] &&
          data.error?.message.includes(ALLOWED_RPC_ERRORS[url])
        ) {
          console.warn(
            `\`${network.id}\` - ${ALLOWED_RPC_ERRORS[url]} at RPC endpoint: ${url} - OK to ignore`,
          );
          return true;
        }
        throw new Error(`bad response: ${data.error?.message ?? data.error}`);
      }
      if (!data?.result) {
        throw new Error("empty response");
      }

      const genesisHash = data.result.hash;
      if (hash && genesisHash?.toLowerCase() !== hash.toLowerCase()) {
        throw new Error("mismatched genesis hash");
      }
    }, url);
  } catch (e) {
    let errorMessage = "unknown error";
    if (e instanceof Error) {
      if (e.message.includes("Unable to connect")) {
        errorMessage = "unreachable host";
      } else if (e.name === "AbortError") {
        errorMessage = "request timeout";
      } else {
        errorMessage = e.message;
      }
    }
    const err = `\`${network.id}\` - ${errorMessage} at RPC endpoint: ${url}`;
    WARNINGS.push(err);
    console.error(err);
    return false;
  }
  return true;
}

async function validatePublicRpcs(networks: Network[]) {
  console.log("Validating public RPCs ... ");
  const ethNetworks = networks.filter(
    (n) => n.firehose?.firstStreamableBlock && n.caip2Id.startsWith("eip155"),
  );
  const urls = ethNetworks.flatMap((n) =>
    (n.rpcUrls ?? [])
      .filter((url) => !url.includes("{"))
      .map((url) => ({ url, network: n })),
  );

  const results = await processQueue(urls, testRpc);

  // Check each network for valid RPC endpoints
  for (const network of ethNetworks) {
    const networkUrls = urls
      .map((u, i) => ({ url: u.url, valid: results[i] }))
      .filter(({ url }) => network.rpcUrls?.includes(url));
    if (networkUrls.length > 0 && !networkUrls.some(({ valid }) => valid)) {
      if (network.networkType === "testnet") {
        WARNINGS.push(`\`${network.id}\` - no working public RPC endpoints [testnet]`);
      } else {
        ERRORS.push(`\`${network.id}\` - no working public RPC endpoints [mainnet]`);
      }
    }
  }

  console.log(
    `Public RPC validation complete: ${results.filter(Boolean).length}/${urls.length} endpoints validated successfully\n`,
  );
}

async function validatePrivateRpcs(networks: Network[]) {
  console.log("Validating private RPCs ... ");
  const ethNetworks = networks.filter(
    (n) => n.firehose?.firstStreamableBlock && n.caip2Id.startsWith("eip155"),
  );
  const urls = ethNetworks.flatMap((n) =>
    (n.rpcUrls ?? [])
      .filter((url) => url.includes("{"))
      .map((url) => ({ url, network: n })),
  );

  const results = await processQueue(urls, testRpc);

  console.log(
    `Private RPC validation complete: ${results.filter(Boolean).length}/${urls.length} endpoints validated successfully\n`,
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
  const results = await processQueue(urls, testAPI, 20);

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
  await validatePublicRpcs(networks);
  await validatePrivateRpcs(networks);

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
