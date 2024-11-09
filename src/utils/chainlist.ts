export async function fetchChainListNetworks(): Promise<ChainListNetwork[]> {
  const response = await fetch("https://chainid.network/chains.json");
  return response.json();
}

export interface ChainListNetwork {
  name: string;
  chain: string;
  icon?: string;
  rpc: string[];
  features?: Feature[];
  faucets: string[];
  nativeCurrency: NativeCurrency;
  infoURL: string;
  shortName: string;
  chainId: number;
  networkId: number;
  slip44?: number;
  ens?: Ens;
  explorers?: Explorer[];
  title?: string;
  status?: string;
  redFlags?: string[];
  parent?: Parent;
}

interface Feature {
  name: string;
}

interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

interface Ens {
  registry: string;
}

interface Explorer {
  name: string;
  url: string;
  standard: string;
  icon?: string;
}

interface Parent {
  type: string;
  chain: string;
  bridges?: Bridge[];
}

interface Bridge {
  url: string;
}
