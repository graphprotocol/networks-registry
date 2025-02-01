import { printErrorsAndWarnings } from "./print";
import { Network } from "./types/registry";
import { loadNetworks } from "./utils/fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const ERRORS: string[] = [];
const WARNINGS: string[] = [];

interface FirehoseInfo {
  chainName: string;
  chainNameAliases: string[];
  firstStreamableBlockNum?: string;
  firstStreamableBlockId: string;
  blockIdEncoding:
    | "BLOCK_ID_ENCODING_HEX"
    | "BLOCK_ID_ENCODING_BASE58"
    | "BLOCK_ID_ENCODING_0X_HEX";
  blockFeatures: ("base" | "extended" | "hybrid")[];
}

const ValidEncodingMap = {
  BLOCK_ID_ENCODING_HEX: "hex",
  BLOCK_ID_ENCODING_BASE58: "base58",
  BLOCK_ID_ENCODING_0X_HEX: "0xhex",
};

async function validateSingleEndpoint(
  network: Network,
  endpoint: string,
): Promise<void> {
  console.log(`  ${network.id} @ ${endpoint} `);
  try {
    const command = `grpcurl -H "X-Api-Key: ${process.env.SF_API_KEY}" ${endpoint} sf.firehose.v2.EndpointInfo/Info`;
    const { stdout } = await execAsync(command);
    const info = JSON.parse(stdout) as FirehoseInfo;

    if (
      ValidEncodingMap[info.blockIdEncoding] !== network.firehose?.bytesEncoding
    ) {
      ERRORS.push(
        `\`${network.id}\` - endpoint \`${endpoint}\` has different \`bytesEncoding\`: Registry: \`${network.firehose?.bytesEncoding}\`, Firehose: \`${info.blockIdEncoding}\``,
      );
    }
    if (
      info.blockFeatures?.includes("extended") &&
      !network.firehose?.evmExtendedModel
    ) {
      ERRORS.push(
        `\`${network.id}\` - endpoint \`${endpoint}\` has different \`evmExtendedModel\`: Registry: \`${network.firehose?.evmExtendedModel}\`, Firehose: \`${info.blockFeatures}\``,
      );
    }
    if (
      info.blockFeatures?.includes("base") &&
      network.firehose?.evmExtendedModel
    ) {
      ERRORS.push(
        `\`${network.id}\` - endpoint ${endpoint} has different \`evmExtendedModel\`: Registry: \`${network.firehose?.evmExtendedModel}\`, Firehose: \`${info.blockFeatures}\``,
      );
    }
    if (
      info.blockFeatures?.includes("hybrid") &&
      !network.firehose?.evmExtendedModel
    ) {
      ERRORS.push(
        `\`${network.id}\` - endpoint ${endpoint} has different \`evmExtendedModel\`: Registry: \`${network.firehose?.evmExtendedModel}\`, Firehose: \`${info.blockFeatures}\``,
      );
    }
    if (!network.genesis?.hash?.includes(info.firstStreamableBlockId)) {
      ERRORS.push(
        `\`${network.id}\` - endpoint ${endpoint} has different \`firstStreamableBlockId\`: Registry: \`${network.genesis?.hash}\`, Firehose: \`${info.firstStreamableBlockId}\``,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Unimplemented")) {
        return;
      }
    }
    ERRORS.push(
      `\`${network.id}\` - endpoint ${endpoint} error: ${JSON.stringify(error)}`,
    );
  }
}

async function validateFirehoseEvmModel(networks: Network[]) {
  if (!process.env.SF_API_KEY) {
    console.error("Need SF_API_KEY to validate firehose endpoints");
    process.exit(1);
  }
  console.log("Validating firehose evm extended model ");

  const endpointsAndNetworks = networks.flatMap(
    (network) =>
      network.services.firehose?.map(
        (endpoint) => [endpoint, network] as [string, Network],
      ) ?? [],
  );

  const BATCH = 20;
  for (let i = 0; i < endpointsAndNetworks.length; i += BATCH) {
    const chunk = endpointsAndNetworks.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(([endpoint, network]) =>
        validateSingleEndpoint(network, endpoint),
      ),
    );
  }
}

export async function validateFirehose(networksPath: string) {
  let networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  await validateFirehoseEvmModel(networks);

  return {
    errors: ERRORS.map((e) => `[firehose] ${e}`),
    warnings: WARNINGS.map((e) => `[firehose] ${e}`),
  };
}

async function main() {
  const [, , networksPath = "registry"] = process.argv;

  const { errors, warnings } = await validateFirehose(networksPath);

  printErrorsAndWarnings(errors, warnings);
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Only run main() if this file is being run directly
if (import.meta.main) {
  await main();
}
