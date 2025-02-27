import { loadNetworks } from "./utils/fs";

interface EtherscanChain {
  chainid: number;
  name: string;
  url: string;
  status: string;
  chainname: string;
}

interface EtherscanResponse {
  comments: string;
  totalcount: number;
  result: EtherscanChain[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getEtherscanChains(): Promise<EtherscanChain[]> {
  try {
    const response = await fetch("https://api.etherscan.io/v2/chainlist");
    const data = await response.json();

    return data.result as EtherscanChain[];
  } catch (error) {
    console.error("Failed to fetch Etherscan chains:", error);
    throw error;
  }
}

// pinax runs proxies for etherscan multi-chain api, i.e. https://mainnet.abi.pinax.network/api for https://api.etherscan.io/v2/api?chainid=1
// this script checks if all proxies are setup and added to the registry
async function main() {
  try {
    const etherscanChains = await getEtherscanChains();
    console.log("Fetched Etherscan chains:", etherscanChains.length);

    let networks = loadNetworks("registry");
    console.log("Loaded from registry: ", networks.length);
    const overlappedChains = networks
      .filter((network) =>
        etherscanChains.some(
          (ethChain) => network.caip2Id === `eip155:${ethChain.chainid}`,
        ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    console.log("Overlap: ", overlappedChains.length);

    console.log(
      "id                     chainid      registry   proxy                url",
    );
    for (const network of overlappedChains) {
      const ourApi = network.apiUrls?.find((c) =>
        c.url.includes("abi.pinax.network"),
      )?.url;
      const inRegistry = !!ourApi;
      const url = ourApi ?? `https://${network.id}.abi.pinax.network/api`;
      const inProxy = await fetch(url)
        .then((res) => res.status === 200)
        .catch(() => false);

      console.log(
        `${network.id.padEnd(22)} ${network.caip2Id.replace(/^eip155:/, "").padEnd(15)} ${(inRegistry ? "✅" : "❌").padEnd(7)}  ${inProxy ? "✅" : "❌"}      ${url}`,
      );
      await sleep(7000); // limited to 10 requests in 1 minute
    }
  } catch (error) {
    console.error("Error in main:", error);
    process.exit(1);
  }
}

main();
