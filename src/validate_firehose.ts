import { Network } from "./types/registry";
import { loadNetworks } from "./utils/fs";
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const ERRORS: string[] = [];

interface FirehoseInfo {
  chainName: string;
  chainNameAliases: string[];
  firstStreamableBlockNum?: string;
  firstStreamableBlockId: string;
  blockIdEncoding: "BLOCK_ID_ENCODING_HEX" | "BLOCK_ID_ENCODING_BASE58" | "BLOCK_ID_ENCODING_0X_HEX";
  blockFeatures: ("base" | "extended" | "hybrid")[];
}

const ValidEncodingMap = {
  "BLOCK_ID_ENCODING_HEX": "hex",
  "BLOCK_ID_ENCODING_BASE58": "base58",
  "BLOCK_ID_ENCODING_0X_HEX": "0xhex",
};

async function validateSingleEndpoint(network: Network, endpoint: string): Promise<void> {
  console.log(`  ${network.id} @ ${endpoint} `);
  try {
    const command = `grpcurl -H "X-Api-Key: ${process.env.SF_API_KEY}" ${endpoint} sf.firehose.v2.EndpointInfo/Info`;
    const { stdout } = await execAsync(command);
    const info = JSON.parse(stdout) as FirehoseInfo;

    if (ValidEncodingMap[info.blockIdEncoding] !== network.firehose?.bytesEncoding) {
      ERRORS.push(`Network ${network.id} endpoint ${endpoint} has invalid bytesEncoding: Registry: ${network.firehose?.bytesEncoding}, Firehose: ${info.blockIdEncoding}`);
    }
    if (info.blockFeatures?.includes("extended") && !network.firehose?.evmExtendedModel) {
      ERRORS.push(`Network ${network.id} endpoint ${endpoint} has invalid evmExtendedModel for extended: Registry: ${network.firehose?.evmExtendedModel}, Firehose: ${info.blockFeatures}`);
    }
    if (info.blockFeatures?.includes("base") && network.firehose?.evmExtendedModel) {
      ERRORS.push(`Network ${network.id} endpoint ${endpoint} has invalid evmExtendedModel for base: Registry: ${network.firehose?.evmExtendedModel}, Firehose: ${info.blockFeatures}`);
    }
    if (info.blockFeatures?.includes("hybrid") && !network.firehose?.evmExtendedModel) {
      ERRORS.push(`Network ${network.id} endpoint ${endpoint} has invalid evmExtendedModel for hybrid: Registry: ${network.firehose?.evmExtendedModel}, Firehose: ${info.blockFeatures}`);
    }
    if (!network.genesis?.hash?.includes(info.firstStreamableBlockId)) {
      ERRORS.push(`Network ${network.id} endpoint ${endpoint} has invalid firstStreamableBlockId: Registry: ${network.genesis?.hash}, Firehose: ${info.firstStreamableBlockId}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Unimplemented")) {
        return;
      }
    }
    ERRORS.push(`Network ${network.id} endpoint ${endpoint} error: ${JSON.stringify(error)}`);
  }
}

async function validateFirehoseEvmModel(networks: Network[]) {
  if (!process.env.SF_API_KEY) {
    console.error("Need SF_API_KEY to validate firehose endpoints");
    process.exit(1);
  }
  console.log("Validating firehose evm extended model ");

  const endpointsAndNetworks = networks
    .flatMap(network => network.services.firehose?.map(endpoint => [endpoint, network] as [string, Network]) ?? []);

  for (let i = 0; i < endpointsAndNetworks.length; i += 10) {
    const chunk = endpointsAndNetworks.slice(i, i + 10);
    await Promise.all(chunk.map(([endpoint, network]) => validateSingleEndpoint(network, endpoint)));
  }
}

async function main() {
  const [, , networksPath = "registry"] = process.argv;

  let networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  await validateFirehoseEvmModel(networks);

  if (ERRORS.length > 0) {
    console.error("\nValidation errors found:");
    ERRORS.forEach((error) => console.error(`  ${error}`));
    process.exit(1);
  }
}

await main();
