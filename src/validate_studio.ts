import { printErrorsAndWarnings } from "./print";
import { loadNetworks } from "./utils/fs";

const ERRORS: string[] = [];
const WARNINGS: string[] = [];

/**
 * Fetches the list of supported chains from the private GitHub repository
 * @returns An array of chain IDs supported by Studio
 */
async function fetchStudioChains(): Promise<string[]> {
  const token = process.env.STUDIO_GITHUB_TOKEN;
  if (!token) {
    console.warn("STUDIO_GITHUB_TOKEN not set");
    return [];
  }

  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/alinobrasil/studio_chain_names/refs/heads/main/chains.json",
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3.raw",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `GitHub API returned ${response.status}: ${response.statusText}`,
      );
    }

    const chains = (await response.json()) as string[];
    return chains;
  } catch (error) {
    console.error("Error fetching studio chains:", error);
    return [];
  }
}

export async function validateStudioChains(networksPath: string) {
  let networks = loadNetworks(networksPath);
  console.log(`Loaded ${networks.length} networks`);

  const studioChains = await fetchStudioChains();
  if (studioChains.length === 0) {
    return {
      errors: [`[studio] failed to fetch Studio chains`],
      warnings: [],
    };
  }
  console.log(`Loaded ${studioChains.length} studio chains`);

  for (const network of networks) {
    const hasStudioService = network.services.subgraphs?.find((url) =>
      url.includes("studio.thegraph.com"),
    );
    if (hasStudioService && !studioChains.includes(network.id)) {
      ERRORS.push(
        `Network ${network.id} has subgraph service but is not in Studio`,
      );
    }
    if (
      !hasStudioService &&
      studioChains.includes(network.id) &&
      network.graphNode?.protocol === "ethereum"
    ) {
      ERRORS.push(
        `Network ${network.id} is in Studio but has no subgraphs service`,
      );
    }
  }

  return {
    errors: ERRORS.map((e) => `[studio] ${e}`),
    warnings: WARNINGS.map((e) => `[studio] ${e}`),
  };
}

async function main() {
  const [, , networksPath = "registry"] = process.argv;

  const { errors, warnings } = await validateStudioChains(networksPath);

  printErrorsAndWarnings(errors, warnings);
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Only run main() if this file is being run directly
if (import.meta.main) {
  await main();
}
