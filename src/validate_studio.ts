import { printErrorsAndWarnings } from "./print";
import { Network } from "./types/registry";
import { loadNetworks } from "./utils/fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const ERRORS: string[] = [];
const WARNINGS: string[] = [];

// hard coded for now, will pull from in the future
const STUDIO_CHAINS = [
  "matic",
  "optimism",
  "optimism-sepolia",
  "fantom",
  "linea",
  "linea-sepolia",
  "mode-mainnet",
  "mode-sepolia",
  "bsc",
  "fuse",
  "chapel",
  "avalanche",
  "fuji",
  "celo",
  "celo-alfajores",
  "mbase",
  "moonriver",
  "arbitrum-one",
  "near-mainnet",
  "near-testnet",
  "mainnet",
  "sepolia",
  "holesky",
  "poa-sokol",
  "xdai",
  "gnosis",
  "gnosis-chiado",
  "aurora-testnet",
  "aurora",
  "fantom-testnet",
  "moonbeam",
  "boba",
  "zksync-era-sepolia",
  "harmony",
  "base",
  "base-sepolia",
  "astar-zkevm-sepolia",
  "blast-testnet",
  "astar-zkevm-mainnet",
  "zksync-era",
  "polygon-zkevm",
  "polygon-zkevm-cardona",
  "scroll-sepolia",
  "scroll",
  "arbitrum-sepolia",
  "blast-mainnet",
  "sei-testnet",
  "zkyoto-testnet",
  "polygon-amoy",
  "xlayer-mainnet",
  "xlayer-sepolia",
  "etherlink-testnet",
  "btc",
  "sei-mainnet",
  "sei-atlantic",
  "solana-mainnet-beta",
  "rootstock",
  "iotex",
  "gravity-mainnet",
  "gravity-testnet",
  "etherlink-mainnet",
  "iotex-testnet",
  "neox",
  "neox-testnet",
  "arbitrum-nova",
  "soneium-testnet",
  "starknet-mainnet",
  "chiliz",
  "fuse-testnet",
  "boba-testnet",
  "boba-bnb",
  "boba-bnb-testnet",
  "chiliz-testnet",
  "rootstock-testnet",
  "unichain-testnet",
  "kaia",
  "kaia-testnet",
  "lens-testnet",
  "solana-devnet",
  "hemi",
  "abstract",
  "abstract-testnet",
  "corn-testnet",
  "corn",
  "botanix-testnet",
  "lumia",
  "sonic",
  "hemi-sepolia",
  "joc",
  "expchain-testnet",
  "monad-testnet",
  "soneium",
  "mint",
  "viction",
  "mint-sepolia",
  "fraxtal",
  "vana",
  "vana-moksha",
  "zetachain",
  "berachain",
  "ink",
  "ink-sepolia",
  "joc-testnet",
  "unichain",
  "autonomys-taurus",
  "swellchain",
  "swellchain-sepolia",
  "apechain",
  "apechain-curtis",
  "hashkeychain-sepolia",
  "hashkeychain",
  "metis",
  "starknet-testnet",
  "zilliqa-protomainnet",
  "peaq",
  "berachain-bepolia",
  "manta",
  "hoodi",
  "megaeth-testnet",
  "lens",
  "stellar",
  "katana-tatara",
  "ronin",
  "katana",
  "ozean-poseidon",
  "botanix",
  "status-sepolia",
  "cronos",
  "zilliqa",
  "zilliqa-testnet",
];

export async function validateStudioChains(networksPath: string) {
  let networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  for (const network of networks) {
    const hasStudioService = network.services.subgraphs?.find((url) =>
      url.includes("studio.thegraph.com"),
    );
    if (hasStudioService && !STUDIO_CHAINS.includes(network.id)) {
      WARNINGS.push(
        `Network ${network.id} has subgraph service but is not in Studio`,
      );
    }
    if (
      !hasStudioService &&
      STUDIO_CHAINS.includes(network.id) &&
      network.graphNode?.protocol === "ethereum"
    ) {
      WARNINGS.push(
        `Network ${network.id} is in Studio but has no subgraphs service`,
      );
    }
  }

  return {
    errors: ERRORS.map((e) => `[studio] ${e}`),
    warnings: WARNINGS.map((e) => `[studio] ${e}`),
  };
}

async function main() {
  const [, , networksPath = "registry"] = process.argv;

  const { errors, warnings } = await validateStudioChains(networksPath);

  printErrorsAndWarnings(errors, warnings);
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Only run main() if this file is being run directly
if (import.meta.main) {
  await main();
}
