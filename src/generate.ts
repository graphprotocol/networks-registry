import fs from "fs";
import path from "path";
import { Network, TheGraphNetworksRegistrySchema } from "./types/registry";
import { loadNetworks } from "./utils/fs";
import packageInfo from "../package.json";
import { getVersionFilenames } from "./utils/versions";

const REGISTRY_ROOT_URL =
  process.env.REGISTRY_ROOT_URL ?? "https://networks-registry.thegraph.com";

function generateMermaidGraph(networks: Network[]): string {
  const relations = networks
    .reduce((acc: string[], network) => {
      network.relations?.forEach((relation) => {
        acc.push(`${network.id} -->|${relation.kind}| ${relation.network}`);
      });
      return acc;
    }, [])
    .sort(
      (a, b) =>
        (a.endsWith("| mainnet") ? 1 : 0) - (b.endsWith("| mainnet") ? 1 : 0),
    );

  return `graph TD\n  ${relations.join("\n  ")}\n`;
}

function byCaip2Id(a: Network, b: Network) {
  if (a.caip2Id.startsWith("eip155") && !b.caip2Id.startsWith("eip155")) {
    return -1;
  }
  if (!a.caip2Id.startsWith("eip155") && b.caip2Id.startsWith("eip155")) {
    return 1;
  }
  return a.caip2Id.localeCompare(b.caip2Id);
}

function main() {
  const [, , networksDir = "registry", outputDir = "dist"] = process.argv;

  const {
    filenameLatest,
    filenameLatestPatch,
    filenameLatestMinor,
    filenameLatestMajor,
    filenameRegistrySchema,
  } = getVersionFilenames(packageInfo.version);

  const registry: TheGraphNetworksRegistrySchema = {
    $schema: `${REGISTRY_ROOT_URL}/${filenameRegistrySchema}`,
    version: `${packageInfo.version}`,
    title: "The Graph networks registry",
    description:
      "This registry was generated and validated at https://github.com/graphprotocol/networks-registry",
    updatedAt: new Date().toISOString(),
    networks: loadNetworks(networksDir).sort(byCaip2Id),
  };

  const content = JSON.stringify(registry, null, 2) + "\n";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(path.join(outputDir, filenameLatest), content);
  fs.writeFileSync(path.join(outputDir, filenameLatestPatch), content);
  fs.writeFileSync(path.join(outputDir, filenameLatestMinor), content);
  fs.writeFileSync(path.join(outputDir, filenameLatestMajor), content);
  fs.copyFileSync(
    path.join(__dirname, "../schemas/registry.schema.json"),
    path.join(outputDir, filenameRegistrySchema),
  );

  process.stdout.write(
    `Generated ${filenameLatest} with ${registry.networks.length} networks`,
  );

  const mermaid = generateMermaidGraph(registry.networks);
  process.stdout.write(`\n\n${mermaid}`);
}

main();
