import { Network } from "./types/registry";
import { loadNetworks, getAllJsonFiles, readFromJsonFile } from "./utils/fs";
import { fetchWeb3NetworkIcons } from "./utils/web3icons";
import { getActiveNetworks } from "./utils/graphnetwork";
import { fetchChainListNetworks } from "./utils/chainlist";

const ERRORS: string[] = [];

function validateFilenames(networksPath: string) {
  process.stdout.write("Validating filenames ... ");
  const files = getAllJsonFiles(networksPath);
  for (const file of files) {
    const network = readFromJsonFile<Network>(file);
    if (!file.endsWith(`/${network.id}.json`)) {
      ERRORS.push(`Network ${network.id} must reside in ${network.id}.json`);
    }
  }
  process.stdout.write("done\n");
}

function validateUniqueness(networks: Network[]) {
  process.stdout.write("Validating uniqueness ... ");
  for (const field of [
    "id",
    "fullName",
    "caip2Id",
    "aliases",
    "genesis.hash",
    "explorerUrls",
    "rpcUrls",
    "apiUrls.url",
  ]) {
    const values = networks.flatMap((n) => {
      if (field.includes(".")) {
        const [obj, fi] = field.split(".");
        if (Array.isArray(n[obj])) {
          return n[obj].map((item) => item[fi]);
        }
        return [n[obj]?.[fi]].filter(Boolean);
      }
      if (Array.isArray(n[field])) return n[field];
      return n[field] ? [n[field]] : [];
    });
    const duplicates = values.filter((v, i) => values.indexOf(v) !== i);
    if (duplicates.length) {
      ERRORS.push(`Duplicate field: "${field} = ${duplicates[0]}"`);
    }
  }

  // aliases must be unique over ids
  const aliases = new Set(networks.flatMap((n) => n.aliases ?? []));
  for (const network of networks) {
    if (aliases.has(network.id)) {
      ERRORS.push(`Network id ${network.id} is used an alias elsewhere`);
    }
  }
  process.stdout.write("done\n");
}

function validateRelations(networks: Network[]) {
  process.stdout.write("Validating relations ... ");
  for (const network of networks) {
    if (network.relations) {
      for (const relation of network.relations) {
        if (!networks.find((n) => n.id === relation.network)) {
          ERRORS.push(
            `Network ${network.id} has unknown related network: ${relation.network}`,
          );
        }
      }
    }
  }

  process.stdout.write("done\n");
}

function validateTestnets(networks: Network[]) {
  process.stdout.write("Validating testnets ... ");
  for (const network of networks) {
    if (["testnet", "devnet"].includes(network.networkType)) {
      const mainnetId = network.relations?.find((n) => n.kind === "testnetOf");
      if (!mainnetId) {
        ERRORS.push(`Testnet ${network.id} has no mainnet relation`);
        continue;
      }
      const mainnet = networks.find((n) => n.id === mainnetId.network);
      if (!mainnet) {
        ERRORS.push(
          `Testnet ${network.id} has unknown mainnet: ${mainnetId.network}`,
        );
        continue;
      }
      if (
        JSON.stringify(mainnet.firehose) !== JSON.stringify(network.firehose)
      ) {
        ERRORS.push(
          `Testnet ${network.id} has different firehose block type than mainnet ${mainnet.id}`,
        );
      }
    }
    if (network.networkType === "mainnet") {
      if (network.relations?.find((n) => n.kind === "testnetOf")) {
        ERRORS.push(
          `Mainnet network ${network.id} can't have testnetOf relation`,
        );
      }
    }
  }

  process.stdout.write("done\n");
}

function validateUrls(networks: Network[]) {
  process.stdout.write("Validating URLs ... ");
  const urls = [
    ...new Set(
      networks
        .flatMap((n) => [
          n.rpcUrls ?? [],
          n.explorerUrls ?? [],
          (n.apiUrls ?? []).map((u) => u.url),
        ])
        .flat(),
    ),
  ];
  for (const url of urls) {
    const match = /\{([^}]+)\}/g.exec(url); // Matches any {..}
    if (match && !/^[A-Z_]+$/.test(match[1])) {
      ERRORS.push(`Only upper-case variables allowed in URL: ${url}`);
    }
  }
  process.stdout.write("done\n");
}

async function validateWeb3Icons(networks: Network[]) {
  process.stdout.write("Validating web3 icons ... ");
  const web3Icons = await fetchWeb3NetworkIcons();
  for (const network of networks) {
    if (network.icon?.web3Icons?.name) {
      const ourIcon = network.icon?.web3Icons!;
      const web3Icon = web3Icons.find((i) => i.id === ourIcon.name);
      if (!web3Icon) {
        ERRORS.push(
          `Network ${network.id} web3icon id does not exist: ${network.web3Icon}`,
        );
      } else {
        const web3Variants = web3Icon.variants || [];
        const ourVariants = ourIcon.variants || [];

        if (web3Variants.length === 2) {
          if (ourVariants.length === 1) {
            ERRORS.push(
              `Network ${network.id} web3icon should have both variants or none: ${ourVariants.join(",")}`,
            );
          }
        } else if (web3Variants.length === 1) {
          if (ourVariants.length !== 1 || ourVariants[0] !== web3Variants[0]) {
            ERRORS.push(
              `Network ${network.id} web3icon should only have the variant: ${web3Variants[0]}`,
            );
          }
        }
      }
    } else {
      if (web3Icons.find((i) => i.id === network.id)) {
        ERRORS.push(
          `Network ${network.id} does not have a web3icon but there exists an icon with the same id. Consider adding it.`,
        );
      }
    }
  }
  process.stdout.write("done\n");
}

async function validateFirehoseBlockType(networks: Network[]) {
  process.stdout.write("Validating firehose block type ... ");
  const bufUrls = [
    ...new Set(
      networks.filter((n) => n.firehose?.bufUrl).map((n) => n.firehose!.bufUrl),
    ),
  ];
  await Promise.all(
    bufUrls.map(async (url) => {
      if (!url.startsWith("https://buf.build/")) {
        ERRORS.push(`Firehose block type buf.build URL is invalid: ${url}`);
        return;
      }
      const [owner, name] = url.split("/").slice(-2);
      try {
        const res = await fetch(
          "https://buf.build/buf.alpha.registry.v1alpha1.ResourceService/GetResourceByName",
          {
            headers: { "content-type": "application/json" },
            body: `{"owner":"${owner}","name":"${name}"}`,
            method: "POST",
          },
        );
        if (res.status !== 200) {
          ERRORS.push(
            `Firehose block type buf.build URL doesn't exist: ${url}`,
          );
        }
      } catch (e) {
        ERRORS.push(`Can't fetch: ${url} from buf.build`);
      }
    }),
  );
  process.stdout.write("done\n");
}

async function validateGraphNetworks(networks: Network[]) {
  process.stdout.write("Validating graph networks ... ");
  const activeGraphNetworks = await getActiveNetworks();
  if (activeGraphNetworks.length === 0) {
    process.stdout.write("skipped\n");
    return;
  }
  const activeRegistryNetworks = networks.filter((n) => n.issuanceRewards);
  for (const network of activeRegistryNetworks) {
    const graphNetwork = activeGraphNetworks.find(
      (n) => n.alias === network.id,
    );
    if (!graphNetwork) {
      ERRORS.push(
        `Network ${network.id} is active in registry but not on the graph network`,
      );
      continue;
    }
    if (graphNetwork.id !== network.caip2Id) {
      ERRORS.push(
        `Network ${network.id} has non-matching chain id on the graph network: ${graphNetwork?.id} vs ${network.caip2Id}`,
      );
    }
  }
  if (activeGraphNetworks.length > activeRegistryNetworks.length) {
    const extraNetworks = activeGraphNetworks.filter(
      (n) => !activeRegistryNetworks.find((r) => r.id === n.alias),
    );
    ERRORS.push(
      `Active networks mismatch: graph=${activeGraphNetworks.length} registry=${activeRegistryNetworks.length} extra=${extraNetworks.map((n) => n.alias).join(",")}`,
    );
  }
  process.stdout.write("done\n");
}

async function validateEthereumList(networks: Network[]) {
  process.stdout.write("Validating ethereum-list ... ");
  const chains = await fetchChainListNetworks();
  const ethNetworks = networks.filter((n) => n.caip2Id.startsWith("eip155"));
  for (const network of ethNetworks) {
    const ourId = parseInt(network.caip2Id.split("eip155:")[1]);
    const chain = chains.find((c) => c.chainId === ourId);
    if (!chain) {
      ERRORS.push(
        `Network ${network.id} with CAIP-2 id ${network.caip2Id} does not exist in ethereum chain registry`,
      );
      continue;
    }
    if (chain.nativeCurrency.symbol !== network.nativeToken) {
      ERRORS.push(
        `Network ${network.id} with CAIP-2 id ${network.caip2Id} has different native token symbol in ethereum chain registry: ${chain.nativeCurrency.symbol} vs ${network.nativeToken}`,
      );
    }
    if (chain.parent?.type === "L2") {
      const ourParent = network.relations?.find(
        (r) => r.kind === "l2Of",
      )?.network;
      if (!ourParent) {
        ERRORS.push(
          `Network ${network.id} with CAIP-2 id ${network.caip2Id} is an L2 chain in ethereum chain registry but has no l2Of relation`,
        );
        continue;
      }
      const parentChainId = ethNetworks.find(
        (n) => n.id === ourParent,
      )?.caip2Id!;
      const actualParentChainId = chain.parent.chain.replace("-", ":");
      if (actualParentChainId !== parentChainId) {
        ERRORS.push(
          `Network ${network.id} has different L2 parent chain in ethereum chain registry: ${actualParentChainId} vs ${parentChainId}`,
        );
      }
    }
  }
  process.stdout.write("done\n");
}

async function main() {
  const [, , networksPath = "registry"] = process.argv;

  const networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  if (networks.length === 0) {
    ERRORS.push("No networks found");
  }

  validateFilenames(networksPath);
  validateUniqueness(networks);
  validateRelations(networks);
  validateTestnets(networks);
  validateUrls(networks);
  await validateWeb3Icons(networks);
  await validateFirehoseBlockType(networks);
  await validateGraphNetworks(networks);
  await validateEthereumList(networks);

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
