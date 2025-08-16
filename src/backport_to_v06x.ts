#!/usr/bin/env bun
/**
 * Backport v0.7 registry entries to v0.6.x format
 *
 * This script reads all v0.7 network entries from the registry directory,
 * converts them to v0.6.x schema format, and generates a consolidated v0.6.x registry file
 * in the public directory.
 */

import fs from "fs";
import path from "path";
import { Network, TheGraphNetworksRegistrySchema } from "./types/registry";
import { loadNetworks } from "./utils/fs";
import { byCaip2Id } from "./generate";

// Define the v0.6.x format network interface with the genesis field
interface NetworkV06x extends Network {
  genesis?: {
    hash: string;
    height: number;
  };
}

// Configure paths and versions
const REGISTRY_DIR = "registry";
const OUTPUT_DIR = "public";
const V06X_FILENAME = "TheGraphNetworksRegistry_v0_6_x.json";
const V06X_SCHEMA_URL =
  "https://networks-registry.thegraph.com/TheGraphNetworksRegistrySchema_v0_6.json";
const V06X_VERSION = getNextVersion();
const V06X_VERSIONED_FILENAME = `TheGraphNetworksRegistry_v0_6_${V06X_VERSION.split(".")[2]}.json`;

// Read the current version from existing v0.6.x file and increment it
function getNextVersion(): string {
  try {
    const existingRegistry = JSON.parse(
      fs.readFileSync(path.join(OUTPUT_DIR, V06X_FILENAME), "utf-8"),
    ) as TheGraphNetworksRegistrySchema;

    const currentVersion = existingRegistry.version;
    const [major, minor, patch] = currentVersion.split(".").map(Number);

    return `${major}.${minor}.${patch + 1}`;
  } catch (error) {
    throw new Error(
      "Could not read existing registry version, defaulting to 0.6.1",
    );
  }
}

/**
 * Convert a v0.7 network entry to v0.6.x format
 * The function handles changes in schema structure between versions
 */
function convertToV06xFormat(network: Network): NetworkV06x {
  const v06xNetwork = JSON.parse(JSON.stringify(network)) as NetworkV06x;
  if (v06xNetwork.firehose) {
    if (v06xNetwork.firehose.firstStreamableBlock) {
      v06xNetwork.genesis = {
        hash: v06xNetwork.firehose.firstStreamableBlock.id,
        height: v06xNetwork.firehose.firstStreamableBlock.height,
      };

      delete v06xNetwork.firehose.firstStreamableBlock;
    }

    if (v06xNetwork.firehose.blockFeatures) {
      delete v06xNetwork.firehose.blockFeatures;
    }
  }
  if (v06xNetwork.tokenApi) {
    delete v06xNetwork.tokenApi;
  }
  if (v06xNetwork.services?.tokenApi) {
    delete v06xNetwork.services.tokenApi;
  }
  if (v06xNetwork.networkType === "beacon") {
    v06xNetwork.networkType = "mainnet";
  }
  if (v06xNetwork.graphNode?.deprecatedAt) {
    delete v06xNetwork.graphNode.deprecatedAt;
  }
  v06xNetwork.relations = v06xNetwork.relations?.filter(
    (r) => r.kind !== "svmOf",
  );

  if (v06xNetwork.icon?.web3Icons?.variants) {
    v06xNetwork.icon.web3Icons.variants =
      v06xNetwork.icon.web3Icons.variants.filter((v) => v !== "background");
  }

  return v06xNetwork;
}

/**
 * Main function to execute the backport process
 */
async function main() {
  console.log("Starting backport of v0.7 registry to v0.6.x format...");

  // Load all networks from v0.7 registry files
  const v07Networks = loadNetworks(REGISTRY_DIR);
  console.log(`Loaded ${v07Networks.length} networks from v0.7 registry`);

  // Convert each network to v0.6.x format
  const v06xNetworks = v07Networks.map(convertToV06xFormat);

  // Sort networks by CAIP-2 ID for consistency
  v06xNetworks.sort(byCaip2Id) as NetworkV06x[];

  // Create v0.6.x registry
  const v06xRegistry: TheGraphNetworksRegistrySchema & {
    networks: NetworkV06x[];
  } = {
    $schema: V06X_SCHEMA_URL,
    version: V06X_VERSION,
    title: "The Graph networks registry",
    description:
      "This registry was generated and validated. To add a chain, open a pull request: https://github.com/graphprotocol/networks-registry",
    updatedAt: new Date().toISOString(),
    networks: v06xNetworks,
  };

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write the v0.6.x registry files
  const registryContent = JSON.stringify(v06xRegistry, null, 2) + "\n";
  fs.writeFileSync(path.join(OUTPUT_DIR, V06X_FILENAME), registryContent);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, V06X_VERSIONED_FILENAME),
    registryContent,
  );

  console.log(
    `Successfully generated v0.6.x registry with ${v06xNetworks.length} networks`,
  );
  console.log(
    `Files created: ${V06X_FILENAME} and ${V06X_VERSIONED_FILENAME} in ${OUTPUT_DIR} directory`,
  );
}

main().catch((error) => {
  console.error("Error during backport:", error);
  process.exit(1);
});
