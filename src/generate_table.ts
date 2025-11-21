import fs from "fs";
import path from "path";
import { loadNetworks } from "./utils/fs";
import { Network } from "./types/registry";
import { version } from "../package.json";

function getGraphNodeProtocol(network: Network): string {
  if (network.graphNode?.protocol) return network.graphNode.protocol;
  if (network.services?.substreams?.length) return "substreams";
  return "N/A";
}

function getChainId(network: Network): string {
  const [type, id] = network.caip2Id.split(":");
  if (type === "eip155") return id;
  return "N/A";
}

function sortNetworks(networks: Network[]): Network[] {
  return networks.sort((a, b) => {
    if (a.id == "mainnet") return -1;
    if (b.id == "mainnet") return 1;
    if (a.issuanceRewards !== b.issuanceRewards) {
      return b.issuanceRewards ? 1 : -1;
    }
    const countServices = (network: Network) => {
      return (["subgraphs", "firehose", "substreams", "tokenApi"] as const).reduce(
        (count, service) => {
          return count + (network.services?.[service]?.length ?? 0);
        },
        0,
      );
    };
    return countServices(b) - countServices(a);
  });
}

function getFullName(network: Network): string {
    const icon = network.icon?.web3Icons?.name
      ? `![](https://raw.githubusercontent.com/0xa3k5/web3icons/refs/heads/main/raw-svgs/networks/branded/${network.icon.web3Icons.name}.svg)`
      : "";
    return `${icon} ${network.shortName} ${network.secondName ?? ""}`;
}

function generateMarkdownTable(networks: Network[]): string {
  const headers = [
    ["Network", ":---"],
    ["ID", ":---:"],
    ["Type", ":---:"],
    ["Chain Id", ":---:"],
    ["Indexing Rewards", ":---:"],
    ["Graph Node Protocol", ":---:"],
    ["Subgraphs", ":---:"],
    ["Firehose", ":---:"],
    ["Substreams", ":---:"],
    ["Token API", ":---:"],
    ["Explorer", ":---"],
    ["Docs", ":---"],
  ];

  const headerRow = `| ${headers.map(([header]) => header).join(" | ")} |`;
  const alignmentRow = `| ${headers.map(([, alignment]) => alignment).join(" | ")} |`;

  // Generate rows for each network
  const rows = networks.map((network) => {
    const services = network.services || {};
    return [
      getFullName(network),
      `**${network.id}**`,
      `*${network.networkType}*`,
      `*${getChainId(network)}*`,
      network.issuanceRewards ? "✅" : "",
      `*${getGraphNodeProtocol(network)}*`,
      services.subgraphs?.length ? "✅" : "",
      services.firehose?.length ? "✅" : "",
      services.substreams?.length ? "✅" : "",
      services.tokenApi?.length ? "✅" : "",
      network.explorerUrls?.[0]
        ? `[${network.explorerUrls[0]}](${network.explorerUrls[0]})`
        : "",
      network.docsUrl ? `[${network.docsUrl}](${network.docsUrl})` : "",
    ].join(" | ");
  });

  // Combine all parts
  const tableContent = [
    headerRow,
    alignmentRow,
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");

  // Create complete markdown content
  return `# Networks Registry v${version}\n\nAuto-generated from the networks registry on every release.\n\n${tableContent}\n`;
}

function main() {
  const [, , networksDir = "registry", outputPath = "docs/networks-table.md"] =
    process.argv;

  // Load networks
  const networks = loadNetworks(networksDir);
  console.log(`Loaded ${networks.length} networks`);

  // Generate markdown content
  const content = generateMarkdownTable(sortNetworks(networks));

  // Ensure docs directory exists
  const docsDir = path.dirname(outputPath);
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  // Write the file
  fs.writeFileSync(outputPath, content);
  console.log(`Generated ${outputPath}`);
}

main();
