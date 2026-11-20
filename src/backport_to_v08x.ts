#!/usr/bin/env bun
/**
 * Backport v0.9 registry entries to v0.8.x format
 *
 * This script reads all v0.9 network entries from the registry directory,
 * converts them to v0.8.x schema format, validates them against the v0.8 schema
 * and generates a consolidated v0.8.x registry file in the public directory.
 *
 * Schema differences:
 * - v0.9 gateway entries in `services.subgraphs` carry `queryUrls` templates
 * - v0.8 has no `queryUrls`; consumers build query URLs as
 *   `<provider>/<api key>/subgraphs/id/<id>`, so only gateway entries whose
 *   templates follow that shape are carried over, without `queryUrls`
 */

import fs from "fs";
import path from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  Network,
  SubgraphsService,
  TheGraphNetworksRegistrySchema,
} from "./types/registry";
import { loadNetworks } from "./utils/fs";
import { byCaip2Id } from "./generate";

type SubgraphsServiceV08x = Omit<SubgraphsService, "queryUrls">;

interface NetworkV08x extends Omit<Network, "services"> {
  services: Omit<Network["services"], "subgraphs"> & {
    subgraphs?: SubgraphsServiceV08x[];
  };
}

const REGISTRY_DIR = "registry";
const OUTPUT_DIR = "public";
const V08X_FILENAME = "TheGraphNetworksRegistry_v0_8_x.json";
const V08X_SCHEMA_FILENAME = "TheGraphNetworksRegistrySchema_v0_8.json";
const V08X_SCHEMA_URL = `https://networks-registry.thegraph.com/${V08X_SCHEMA_FILENAME}`;
const V08X_VERSION = getNextVersion();
const V08X_VERSIONED_FILENAME = `TheGraphNetworksRegistry_v0_8_${V08X_VERSION.split(".")[2]}.json`;

// Read the current version from existing v0.8.x file and increment it
function getNextVersion(): string {
  try {
    const existingRegistry = JSON.parse(
      fs.readFileSync(path.join(OUTPUT_DIR, V08X_FILENAME), "utf-8"),
    ) as TheGraphNetworksRegistrySchema;

    const [major, minor, patch] = existingRegistry.version
      .split(".")
      .map(Number);

    return `${major}.${minor}.${patch + 1}`;
  } catch (error) {
    throw new Error(`Could not read existing ${V08X_FILENAME} version`);
  }
}

/**
 * Whether a v0.8 consumer, which derives query URLs from `provider`, reaches
 * the same endpoints the entry's `queryUrls` name
 */
function hasV08xQueryUrls({ kind, provider, queryUrls }: SubgraphsService) {
  if (kind !== "gateway") return true;
  return (
    queryUrls?.subgraphId === `${provider}/{API_KEY}/subgraphs/id/{SUBGRAPH_ID}` &&
    queryUrls?.deploymentId ===
      `${provider}/{API_KEY}/deployments/id/{DEPLOYMENT_ID}`
  );
}

/**
 * Convert a v0.9 network entry to v0.8.x format
 */
function convertToV08xFormat(network: Network): NetworkV08x {
  const v08xNetwork = JSON.parse(JSON.stringify(network)) as NetworkV08x;
  if (network.services.subgraphs) {
    v08xNetwork.services.subgraphs = network.services.subgraphs
      .filter(hasV08xQueryUrls)
      .map(({ queryUrls, ...entry }) => entry);
  }
  return v08xNetwork;
}

function validateV08x(registry: object) {
  const ajv = new Ajv({ strict: true });
  addFormats(ajv);
  const schema = JSON.parse(
    fs.readFileSync(path.join(OUTPUT_DIR, V08X_SCHEMA_FILENAME), "utf-8"),
  );
  const validate = ajv.compile(schema);
  if (!validate(registry)) {
    throw new Error(
      `Backported registry does not match v0.8 schema:\n${validate
        .errors!.map((e) => `  ${e.instancePath} ${e.message}`)
        .join("\n")}`,
    );
  }
}

/**
 * Main function to execute the backport process
 */
async function main() {
  console.log("Starting backport of v0.9 registry to v0.8.x format...");

  const v09Networks = loadNetworks(REGISTRY_DIR);
  console.log(`Loaded ${v09Networks.length} networks from v0.9 registry`);

  const v08xNetworks = v09Networks.sort(byCaip2Id).map(convertToV08xFormat);

  const v08xRegistry = {
    $schema: V08X_SCHEMA_URL,
    version: V08X_VERSION,
    title: "The Graph networks registry",
    description:
      "This registry was generated and validated at https://github.com/graphprotocol/networks-registry",
    updatedAt: new Date().toISOString(),
    networks: v08xNetworks,
  };

  validateV08x(v08xRegistry);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const registryContent = JSON.stringify(v08xRegistry, null, 2) + "\n";
  fs.writeFileSync(path.join(OUTPUT_DIR, V08X_FILENAME), registryContent);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, V08X_VERSIONED_FILENAME),
    registryContent,
  );

  console.log(
    `Successfully generated v0.8.x registry with ${v08xNetworks.length} networks`,
  );
  console.log(
    `Files created: ${V08X_FILENAME} and ${V08X_VERSIONED_FILENAME} in ${OUTPUT_DIR} directory`,
  );
}

main().catch((error) => {
  console.error("Error during backport:", error);
  process.exit(1);
});
