import { Network } from "./types/registry";
import { loadNetworks, getAllJsonFiles, readFromJsonFile } from "./utils/fs";
import { fetchWeb3NetworkIcons } from "./utils/web3icons";
import { getActiveNetworks } from "./utils/graphnetwork";
import { fetchChainListNetworks } from "./utils/chainlist";
import { printErrorsAndWarnings } from "./print";

const ERRORS: string[] = [];
const WARNINGS: string[] = [];

const ALLOWED_DUPLICATES: string[] = [
  "0x31ced5b9beb7f8782b014660da0cb18cc409f121f408186886e1ca3e8eeca96b",
  "0xe8e77626586f73b955364c7b4bbf0bb7f7685ebd40e852b164633a4acbd3244c",
  "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn",
];

const ALLOWED_ETHEREUM_LIST_MISSING: string[] = ["katana", "ozean-poseidon"];

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

function validateUniqueness(networks: Network[]) {
  process.stdout.write("Validating uniqueness ... ");
  for (const field of [
    "id",
    "fullName",
    "caip2Id",
    "aliases",
    "firehose.firstStreamableBlock.id",
    "explorerUrls",
    "rpcUrls",
    "apiUrls.url",
    "services.firehose",
    "services.substreams",
  ]) {
    // Only consider networks that do NOT have an 'evmOf' relation
    const values = networks
      .filter((n) => !n.relations?.some((rel) => rel.kind === "evmOf"))
      .flatMap((n) => {
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
      if (network.firehose) {
        if (network.firehose.evmExtendedModel === undefined) {
          ERRORS.push(
            `\`${network.id}\` - EVM chain is missing firehose.evmExtendedModel field`,
          );
        }
        if (
          network.firehose.evmExtendedModel === false &&
          !network.firehose.blockFeatures?.includes("base")
        ) {
          ERRORS.push(
            `\`${network.id}\` - EVM chain has firehose.evmExtendedModel=false but firehose.blockFeatures does not include "base"`,
          );
        }
      }

      if (network.graphNode?.protocol !== "ethereum") {
        ERRORS.push(
          `\`${network.id}\` - EVM chain has graphNode.protocol!="ethereum"`,
        );
      }

      if (network.rpcUrls?.length === 0) {
        WARNINGS.push(`\`${network.id}\` - has no RPC endpoints`);
      }

      if (network.apiUrls?.length === 0) {
        WARNINGS.push(`\`${network.id}\` - has no API endpoints`);
      }
    } else {
      if (network.firehose?.evmExtendedModel !== undefined) {
        ERRORS.push(
          `\`${network.id}\` - non-EVM chain has evmExtendedModel field`,
        );
      }

      if (network.graphNode?.protocol === "ethereum") {
        ERRORS.push(
          `\`${network.id}\` - non-EVM has graphNode.protocol="ethereum"`,
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
        `\`${testnet.id}\` - this testnet has unknown mainnet: \`${mainnetId.network}\``,
      );
      continue;
    }
    if (
      mainnet.firehose?.blockType !== testnet.firehose?.blockType ||
      mainnet.firehose?.bytesEncoding !== testnet.firehose?.bytesEncoding ||
      mainnet.firehose?.evmExtendedModel !== testnet.firehose?.evmExtendedModel
    ) {
      ERRORS.push(
        `\`${testnet.id}\` - mismatching testnet/mainnet firehose block type`,
      );
    }
    if (testnet.networkType === "mainnet") {
      if (testnet.relations?.find((n) => n.kind === "testnetOf")) {
        ERRORS.push(
          `\`${testnet.id}\` - testnet can't have "testnetOf" relation`,
        );
      }
    }
  }

  process.stdout.write("done\n");
}

function validateBeacons(networks: Network[]) {
  process.stdout.write("Validating beacons ... ");
  const beacons = networks.filter((n) => n.networkType === "beacon");
  for (const beacon of beacons) {
    if (!beacon.relations?.find((rel) => rel.kind === "beaconOf")) {
      ERRORS.push(`\`${beacon.id}\` - beacon must have "beaconOf" relation`);
    }
  }

  process.stdout.write("done\n");
}

const ALLOWED_FH_PROVIDERS = ["pinax.network", "streamingfast.io"];
const ALLOWED_SG_PROVIDERS = ["api.studio.thegraph.com"];
const ALLOWED_TOKEN_API_PROVIDERS = ["token-api.thegraph.com"];

function validateServices(networks: Network[]) {
  process.stdout.write("Validating services ... ");

  for (const network of networks) {
    const services = network.services ?? [];

    if (services.firehose?.length) {
      if (!network.firehose) {
        ERRORS.push(
          `\`${network.id}\` - has firehose service but no firehose block info`,
        );
      }
    }

    // Validate subgraphs and sps services
    ["subgraphs", "sps"].forEach((serviceType) => {
      for (const url of services[serviceType] ?? []) {
        if (!ALLOWED_SG_PROVIDERS.some((provider) => url.includes(provider))) {
          ERRORS.push(
            `\`${network.id}\` - invalid \`${serviceType}\` provider: ${url}`,
          );
        }
      }
    });

    // Validate substreams and firehose services
    ["firehose", "substreams"].forEach((serviceType) => {
      for (const url of services[serviceType] ?? []) {
        if (!ALLOWED_FH_PROVIDERS.some((provider) => url.includes(provider))) {
          ERRORS.push(
            `\`${network.id}\` - invalid \`${serviceType}\` provider: ${url}`,
          );
        }
      }
    });

    // Validate token API services
    for (const url of services.tokenApi ?? []) {
      if (
        !ALLOWED_TOKEN_API_PROVIDERS.some((provider) => url.includes(provider))
      ) {
        ERRORS.push(
          `\`${network.id}\` - invalid \`tokenApi\` provider: ${url}`,
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

function validateMainnetAliases(networks: Network[]) {
  process.stdout.write("Validating mainnet aliases ... ");
  const mainnets = networks.filter(
    (n) =>
      n.id !== "mainnet" &&
      n.networkType === "mainnet" &&
      !n.relations?.some((r) => r.kind === "beaconOf"),
  );
  for (const network of mainnets) {
    const woMainnet = network.id.replace("-mainnet", "");
    const withMainnet = `${woMainnet}-mainnet`;

    if (woMainnet === network.id) {
      if (!network.aliases?.includes(withMainnet)) {
        ERRORS.push(
          `\`${network.id}\` - must have an alias \`${withMainnet}\``,
        );
      }
    } else {
      if (!network.aliases?.includes(woMainnet)) {
        ERRORS.push(`\`${network.id}\` - must have an alias \`${woMainnet}\``);
      }
    }
  }
  process.stdout.write("done\n");
}

async function validateWeb3Icons(networks: Network[]) {
  process.stdout.write("Validating web3 icons ... ");
  const web3Icons = await fetchWeb3NetworkIcons();
  for (const network of networks) {
    if (!network.icon || !network.icon.web3Icons) {
      WARNINGS.push(`\`${network.id}\` - has no web3icon`);
      continue;
    }
    if (network.icon.web3Icons.name) {
      const ourIcon = network.icon.web3Icons;
      const web3Icon = web3Icons.find((i) => i.id === ourIcon.name);
      if (!web3Icon) {
        ERRORS.push(
          `\`${network.id}\` - web3icon id does not exist on web3Icons: \`${ourIcon.name}\``,
        );
      } else {
        const web3Variants = web3Icon.variants || [];
        const ourVariants = ourIcon.variants || [];

        if (
          web3Variants.length === 3 &&
          ourVariants.length !== 0 &&
          ourVariants.length !== 3
        ) {
          WARNINGS.push(
            `\`${network.id}\` - web3icon should have 0 or all 3 variants \`${ourVariants.join(",")}\``,
          );
        }
        if (
          web3Variants.length !== 3 &&
          web3Variants.sort().join(",") !== ourVariants.sort().join(",")
        ) {
          WARNINGS.push(
            `\`${network.id}\` - web3icon has mismatching variants \`${web3Variants.join(",")}\``,
          );
        }
      }
    } else {
      if (web3Icons.find((i) => i.id === network.id)) {
        WARNINGS.push(
          `\`${network.id}\` - has no web3icon but there exists an icon with the same id. Consider adding it.`,
        );
      } else {
        WARNINGS.push(
          `\`${network.id}\` - has no web3icon, consider adding one to web3icons repo`,
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
        `\`${network.id}\` - has indexing rewards in registry but not on The Graph Network`,
      );
      continue;
    }
    if (graphNetwork.id !== network.caip2Id) {
      ERRORS.push(
        `\`${network.id}\` - has non-matching chain id on the graph network: ${graphNetwork?.id} vs ${network.caip2Id}`,
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
    if (ALLOWED_ETHEREUM_LIST_MISSING.includes(network.id)) {
      continue;
    }
    const ourId = parseInt(network.caip2Id.split("eip155:")[1]);
    const chain = chains.find((c) => c.chainId === ourId);
    if (!chain) {
      ERRORS.push(
        `\`${network.id}\` - CAIP-2 id \`${network.caip2Id}\` does not exist in ethereum list`,
      );
      continue;
    }
    if (chain.nativeCurrency.symbol !== network.nativeToken) {
      WARNINGS.push(
        `\`${network.id}\` - native token mismatch in ethereum list: \`${chain.nativeCurrency.symbol}\` vs \`${network.nativeToken}\``,
      );
    }
    if (chain.parent?.type === "L2") {
      const ourParent = network.relations?.find(
        (r) => r.kind === "l2Of",
      )?.network;
      if (!ourParent) {
        WARNINGS.push(
          `\`${network.id}\` - has L2 parent in ethereum list but has no "l2Of" relation in registry`,
        );
        continue;
      }
      const parentChainId = ethNetworks.find(
        (n) => n.id === ourParent,
      )?.caip2Id!;
      const actualParentChainId = chain.parent.chain.replace("-", ":");
      if (actualParentChainId !== parentChainId) {
        WARNINGS.push(
          `\`${network.id}\` - parent chain mismatch in ethereum list: \`${actualParentChainId}\` vs \`${parentChainId}\``,
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
  validateBeacons(networks);
  validateUrls(networks);
  validateServices(networks);
  validateMainnetAliases(networks);
  await validateWeb3Icons(networks);
  await validateFirehoseBlockType(networks);
  await validateGraphNetworks(networks);
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
