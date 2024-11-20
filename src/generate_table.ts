import fs from "fs";
import path from "path";
import { loadNetworks } from "./utils/fs";
import { Network } from "./types/registry";

function generateMarkdownTable(networks: Network[]): string {
  const headers = [
    "ID",
    "Network",
    "Type",
    "Indexing Rewards",
    "Graph Node Protocol",
    "Subgraphs",
    "SpS",
    "Firehose",
    "Substreams",
    "Explorer",
    "Docs",
  ];

  // header row with alignment
  const headerRow = `| ${headers.join(" | ")} |`;
  // center-align all columns using :---:
  const alignmentRow = `| ${headers.map(() => ":---:").join(" | ")} |`;

  // Generate rows for each network
  const rows = networks.map((network) => {
    const services = network.services || {};
    return [
      `**${network.id}**`,
      `${network.shortName} ${network.secondName ?? ""}`,
      `*${network.networkType}*`,
      network.issuanceRewards ? "✅" : "",
      `*${
        network.graphNode?.protocol
          ? network.graphNode.protocol
          : network.services?.substreams?.length
            ? "substreams"
            : ""
      }*`,
      services.subgraphs?.length ? "✅" : "",
      services.sps?.length ? "✅" : "",
      services.firehose?.length ? "✅" : "",
      services.substreams?.length ? "✅" : "",
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
  return `# The Graph Registry Networks\n\nAuto-generated from the networks registry on every release.\n\n${tableContent}\n`;
}

function main() {
  const [, , networksDir = "registry", outputPath = "docs/networks-table.md"] =
    process.argv;

  // Load networks
  const networks = loadNetworks(networksDir);
  console.log(`Loaded ${networks.length} networks`);

  networks.sort((a, b) => {
    if (a.id == "mainnet") return -1;
    if (b.id == "mainnet") return 1;
    if (a.issuanceRewards !== b.issuanceRewards) {
      return b.issuanceRewards ? 1 : -1;
    }
    const countServices = (network: Network) => {
      return ["subgraphs", "sps", "firehose", "substreams"].reduce(
        (count, service) => {
          return count + (network.services?.[service]?.length ?? 0);
        },
        0,
      );
    };
    return countServices(b) - countServices(a);
  });

  // Generate markdown content
  const content = generateMarkdownTable(networks);

  // Ensure docs directory exists
  const docsDir = path.dirname(outputPath);
  fs.mkdirSync(docsDir, { recursive: true });

  // Write the file
  fs.writeFileSync(outputPath, content);
  console.log(`Generated ${outputPath}`);
}

main();
