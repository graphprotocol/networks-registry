export async function fetchChainListNetworks(): Promise<ChainListNetwork[]> {
  const response = await fetch("https://chainid.network/chains.json");
  return response.json();
}

// chainlist.org's feed: unlike chainid.network, `rpc` entries are objects carrying
// privacy info (`tracking`), and it includes extra community-maintained endpoints.
export interface ChainListOrgNetwork {
  name: string;
  chainId: number;
  rpc: { url: string; tracking?: string; isOpenSource?: boolean }[];
}

export async function fetchChainListOrgRpcs(): Promise<ChainListOrgNetwork[]> {
  const response = await fetch("https://chainlist.org/rpcs.json");
  if (!response.ok) {
    throw new Error(`chainlist.org returned ${response.status}`);
  }
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
