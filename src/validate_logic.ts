import { Network } from "./types/registry";
import { loadNetworks, getAllJsonFiles, readFromJsonFile } from "./utils/fs";
import { fetchWeb3NetworkIcons } from "./utils/web3icons";
import { getActiveNetworks } from "./utils/graphnetwork";
import { fetchChainListNetworks } from "./utils/chainlist";
import { printErrorsAndWarnings } from "./print";

const ERRORS: string[] = [];
const WARNINGS: string[] = [];

function validateFilenames(networksPath: string) {
  process.stdout.write("Validating filenames ... ");
  const files = getAllJsonFiles(networksPath);
  for (const file of files) {
    const network = readFromJsonFile<Network>(file);
    if (!file.endsWith(`/${network.id}.json`)) {
      ERRORS.push(`\`${network.id}\` - must reside in ${network.id}.json`);
    }
  }
  process.stdout.write("done\n");
}

const ALLOWED_DUPLICATES: string[] = [
  "0x31ced5b9beb7f8782b014660da0cb18cc409f121f408186886e1ca3e8eeca96b",
  "0xe8e77626586f73b955364c7b4bbf0bb7f7685ebd40e852b164633a4acbd3244c",
];

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
    "services.firehose",
    "services.substreams",
  ]) {
    const values = networks.flatMap((n) => {
      if (field.includes(".")) {
        const [obj, fi] = field.split(".");
        if (Array.isArray(n[obj])) {
          return n[obj].map((item) => item[fi]);
        }
        if (Array.isArray(n[obj]?.[fi])) {
          return n[obj][fi];
        }
        return [n[obj]?.[fi]].filter(Boolean);
      }
      if (Array.isArray(n[field])) return n[field];
      return n[field] ? [n[field]] : [];
    });
    const duplicates = values
      .filter((v, i) => values.indexOf(v) !== i)
      .filter((v) => !ALLOWED_DUPLICATES.includes(v));
    if (duplicates.length) {
      ERRORS.push(`Duplicate field: "${field} = ${duplicates[0]}"`);
    }
  }

  // aliases must be unique over ids
  const aliases = new Set(networks.flatMap((n) => n.aliases ?? []));
  for (const network of networks) {
    if (aliases.has(network.id)) {
      ERRORS.push(`\`${network.id}\` - is used an alias elsewhere`);
    }
  }
  process.stdout.write("done\n");
}

function validateNames(networks: Network[]) {
  process.stdout.write("Validating names ... ");
  const mainnets = networks.filter((n) => n.networkType === "mainnet");
  for (const network of mainnets) {
    const dups = mainnets.filter((n) => n.shortName === network.shortName);
    if (dups.length > 1) {
      ERRORS.push(
        `Networks ${dups.map((n) => `\`${n.id}\``).join(",")} have non-unique shortName: ${network.shortName}`,
      );
    }
  }
  process.stdout.write("done\n");
}

function validateRelations(networks: Network[]) {
  process.stdout.write("Validating relations ... ");
  for (const network of networks) {
    for (const relation of network.relations ?? []) {
      if (!networks.find((n) => n.id === relation.network)) {
        ERRORS.push(
          `\`${network.id}\` - has unknown related network: \`${relation.network}\``,
        );
      }
      if (relation.network === network.id) {
        ERRORS.push(
          `\`${network.id}\` - has self-referencing "${relation.kind}" relation`,
        );
      }
    }
  }

  process.stdout.write("done\n");
}

function validateEvmRules(networks: Network[]) {
  process.stdout.write("Validating EVM rules ... ");

  for (const network of networks) {
    const isEvm = network.caip2Id.startsWith("eip155:");

    if (isEvm) {
      if (network.firehose?.evmExtendedModel === undefined) {
        ERRORS.push(
          `\`${network.id}\` - is EVM but missing required firehose.evmExtendedModel field`,
        );
      }

      if (network.graphNode?.protocol !== "ethereum") {
        ERRORS.push(
          `\`${network.id}\` - is EVM but graphNode.protocol is not "ethereum"`,
        );
      }
    } else {
      if (network.firehose?.evmExtendedModel !== undefined) {
        ERRORS.push(
          `\`${network.id}\` - is non-EVM but has evmExtendedModel field which is not allowed`,
        );
      }

      if (network.graphNode?.protocol === "ethereum") {
        ERRORS.push(
          `\`${network.id}\` - is non-EVM but has graphNode.protocol="ethereum" which is not allowed`,
        );
      }
    }
  }

  process.stdout.write("done\n");
}

function validateTestnets(networks: Network[]) {
  process.stdout.write("Validating testnets ... ");
  const testnets = networks.filter((n) =>
    ["testnet", "devnet"].includes(n.networkType),
  );
  for (const testnet of testnets) {
    const mainnetId = testnet.relations?.find((n) => n.kind === "testnetOf");
    if (!mainnetId) {
      WARNINGS.push(`\`${testnet.id}\` - this testnet has no mainnet relation`);
      continue;
    }
    const mainnet = networks.find((n) => n.id === mainnetId.network);
    if (!mainnet) {
      ERRORS.push(
        `Testnet \`${testnet.id}\` has unknown mainnet: \`${mainnetId.network}\``,
      );
      continue;
    }
    if (JSON.stringify(mainnet.firehose) !== JSON.stringify(testnet.firehose)) {
      ERRORS.push(
        `Testnet \`${testnet.id}\` has different firehose block type than mainnet \`${mainnet.id}\``,
      );
    }
    if (testnet.networkType === "mainnet") {
      if (testnet.relations?.find((n) => n.kind === "testnetOf")) {
        ERRORS.push(`Mainnet \`${testnet.id}\` can't have testnetOf relation`);
      }
    }
  }

  process.stdout.write("done\n");
}

const ALLOWED_FH_PROVIDERS = ["pinax.network", "streamingfast.io"];
const ALLOWED_SG_PROVIDERS = ["api.studio.thegraph.com"];

function validateServices(networks: Network[]) {
  process.stdout.write("Validating services ... ");

  for (const network of networks) {
    const services = network.services ?? [];

    // Validate subgraphs and sps services
    ["subgraphs", "sps"].forEach((serviceType) => {
      for (const url of services[serviceType] ?? []) {
        if (!ALLOWED_SG_PROVIDERS.some((provider) => url.includes(provider))) {
          ERRORS.push(
            `\`${network.id}\` - invalid \`${serviceType}\` URL: only ${ALLOWED_SG_PROVIDERS.join(", ")} allowed right now`,
          );
        }
      }
    });

    // Validate substreams and firehose services
    ["firehose", "substreams"].forEach((serviceType) => {
      for (const url of services[serviceType] ?? []) {
        if (!ALLOWED_FH_PROVIDERS.some((provider) => url.includes(provider))) {
          ERRORS.push(
            `\`${network.id}\` - invalid \`${serviceType}\` URL: only ${ALLOWED_FH_PROVIDERS.join(", ")} allowed right now`,
          );
        }
      }
    });

    // Validate that firehose and substreams services are paired by provider
    const firehoseUrls = services.firehose ?? [];
    const substreamsUrls = services.substreams ?? [];
    if (firehoseUrls.length !== substreamsUrls.length) {
      WARNINGS.push(`\`${network.id}\` - no matching substreams/firehose pair`);
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
          `\`${network.id}\` - web3icon id does not exist on web3Icons: \`${ourIcon.name}\``,
        );
      } else {
        const web3Variants = web3Icon.variants || [];
        const ourVariants = ourIcon.variants || [];

        if (web3Variants.length === 2) {
          if (ourVariants.length === 1) {
            WARNINGS.push(
              `\`${network.id}\` - web3icon should have both variants or none: \`${ourVariants.join(",")}\``,
            );
          }
        } else if (web3Variants.length === 1) {
          if (ourVariants.length !== 1 || ourVariants[0] !== web3Variants[0]) {
            ERRORS.push(
              `\`${network.id}\` - web3icon should only have the variant: \`${web3Variants[0]}\``,
            );
          }
        }
      }
    } else {
      if (web3Icons.find((i) => i.id === network.id)) {
        WARNINGS.push(
          `\`${network.id}\` - does not have a web3icon but there exists an icon with the same id. Consider adding it.`,
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
        `\`${network.id}\` - CAIP-2 id \`${network.caip2Id}\` does not exist in ethereum chain registry`,
      );
      continue;
    }
    if (chain.nativeCurrency.symbol !== network.nativeToken) {
      WARNINGS.push(
        `\`${network.id}\` - CAIP-2 id \`${network.caip2Id}\` has different native token symbol in ethereum chain registry: \`${chain.nativeCurrency.symbol}\` vs \`${network.nativeToken}\``,
      );
    }
    if (chain.parent?.type === "L2") {
      const ourParent = network.relations?.find(
        (r) => r.kind === "l2Of",
      )?.network;
      if (!ourParent) {
        WARNINGS.push(
          `\`${network.id}\` - CAIP-2 id \`${network.caip2Id}\` is an L2 chain in ethereum chain registry but has no l2Of relation`,
        );
        continue;
      }
      const parentChainId = ethNetworks.find(
        (n) => n.id === ourParent,
      )?.caip2Id!;
      const actualParentChainId = chain.parent.chain.replace("-", ":");
      if (actualParentChainId !== parentChainId) {
        WARNINGS.push(
          `\`${network.id}\` - CAIP-2 id \`${network.caip2Id}\` has different L2 parent chain in ethereum chain registry: \`${actualParentChainId}\` vs \`${parentChainId}\``,
        );
      }
    }
  }
  process.stdout.write("done\n");
}

export async function validateLogic(networksPath: string) {
  const networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  if (networks.length === 0) {
    ERRORS.push("No networks found");
  }

  validateFilenames(networksPath);
  validateUniqueness(networks);
  validateNames(networks);
  validateRelations(networks);
  validateEvmRules(networks);
  validateTestnets(networks);
  validateUrls(networks);
  validateServices(networks);
  await validateWeb3Icons(networks);
  await validateFirehoseBlockType(networks);
  // await validateGraphNetworks(networks);       // uncomment when "mode" glitch is fixed
  await validateEthereumList(networks);

  return {
    errors: ERRORS.map((e) => `[logic] ${e}`),
    warnings: WARNINGS.map((e) => `[logic] ${e}`),
  };
}

async function main() {
  const [, , networksPath = "registry"] = process.argv;

  const { errors, warnings } = await validateLogic(networksPath);

  printErrorsAndWarnings(errors, warnings);
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Only run main() if this file is being run directly
if (import.meta.main) {
  await main();
}
