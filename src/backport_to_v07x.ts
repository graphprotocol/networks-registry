#!/usr/bin/env bun
/**
 * Backport v0.8 registry entries to v0.7.x format
 *
 * This script reads all v0.8 network entries from the registry directory,
 * converts them to v0.7.x schema format, validates them against the v0.7 schema
 * and generates a consolidated v0.7.x registry file in the public directory.
 *
 * Schema differences:
 * - v0.8 `services.subgraphs` is an array of { kind, provider, description } objects
 * - v0.7 `services.subgraphs` is an array of Studio deployment URL strings,
 *   so only `kind: "studio"` entries are carried over as their provider URL
 */

import fs from "fs";
import path from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { Network, TheGraphNetworksRegistrySchema } from "./types/registry";
import { loadNetworks } from "./utils/fs";
import { byCaip2Id } from "./generate";

// Define the v0.7.x format network interface with string subgraphs
interface NetworkV07x extends Omit<Network, "services"> {
  services: Omit<Network["services"], "subgraphs"> & {
    subgraphs?: string[];
  };
}

// Configure paths and versions
const REGISTRY_DIR = "registry";
const OUTPUT_DIR = "public";
const V07X_FILENAME = "TheGraphNetworksRegistry_v0_7_x.json";
const V07X_SCHEMA_FILENAME = "TheGraphNetworksRegistrySchema_v0_7.json";
const V07X_SCHEMA_URL = `https://networks-registry.thegraph.com/${V07X_SCHEMA_FILENAME}`;
const V07X_VERSION = getNextVersion();
const V07X_VERSIONED_FILENAME = `TheGraphNetworksRegistry_v0_7_${V07X_VERSION.split(".")[2]}.json`;

// Read the current version from existing v0.7.x file and increment it
function getNextVersion(): string {
  try {
    const existingRegistry = JSON.parse(
      fs.readFileSync(path.join(OUTPUT_DIR, V07X_FILENAME), "utf-8"),
    ) as TheGraphNetworksRegistrySchema;

    const [major, minor, patch] = existingRegistry.version
      .split(".")
      .map(Number);

    return `${major}.${minor}.${patch + 1}`;
  } catch (error) {
    throw new Error(`Could not read existing ${V07X_FILENAME} version`);
  }
}

/**
 * Convert a v0.8 network entry to v0.7.x format
 */
function convertToV07xFormat(network: Network): NetworkV07x {
  const v07xNetwork = JSON.parse(JSON.stringify(network)) as NetworkV07x;
  if (network.services.subgraphs) {
    v07xNetwork.services.subgraphs = network.services.subgraphs
      .filter((s) => s.kind === "studio")
      .map((s) => s.provider);
  }
  return v07xNetwork;
}

function validateV07x(registry: object) {
  const ajv = new Ajv({ strict: true });
  addFormats(ajv);
  const schema = JSON.parse(
    fs.readFileSync(path.join(OUTPUT_DIR, V07X_SCHEMA_FILENAME), "utf-8"),
  );
  const validate = ajv.compile(schema);
  if (!validate(registry)) {
    throw new Error(
      `Backported registry does not match v0.7 schema:\n${validate
        .errors!.map((e) => `  ${e.instancePath} ${e.message}`)
        .join("\n")}`,
    );
  }
}

/**
 * Main function to execute the backport process
 */
async function main() {
  console.log("Starting backport of v0.8 registry to v0.7.x format...");

  const v08Networks = loadNetworks(REGISTRY_DIR);
  console.log(`Loaded ${v08Networks.length} networks from v0.8 registry`);

  const v07xNetworks = v08Networks.sort(byCaip2Id).map(convertToV07xFormat);

  const v07xRegistry = {
    $schema: V07X_SCHEMA_URL,
    version: V07X_VERSION,
    title: "The Graph networks registry",
    description:
      "This registry was generated and validated at https://github.com/graphprotocol/networks-registry",
    updatedAt: new Date().toISOString(),
    networks: v07xNetworks,
  };

  validateV07x(v07xRegistry);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const registryContent = JSON.stringify(v07xRegistry, null, 2) + "\n";
  fs.writeFileSync(path.join(OUTPUT_DIR, V07X_FILENAME), registryContent);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, V07X_VERSIONED_FILENAME),
    registryContent,
  );

  console.log(
    `Successfully generated v0.7.x registry with ${v07xNetworks.length} networks`,
  );
  console.log(
    `Files created: ${V07X_FILENAME} and ${V07X_VERSIONED_FILENAME} in ${OUTPUT_DIR} directory`,
  );
}

main().catch((error) => {
  console.error("Error during backport:", error);
  process.exit(1);
});
