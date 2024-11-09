export type Variants = "branded" | "mono";

export interface Web3IconsNetwork {
  id: string;
  name: string;
  variants: Variants[];
  nativeCoinId?: string;
  shortName?: string;
  chainId?: number;
}

export async function fetchWeb3NetworkIcons(): Promise<Web3IconsNetwork[]> {
  const response = await fetch(
    "https://raw.githubusercontent.com/0xa3k5/web3icons/refs/heads/main/packages/common/src/metadata/networks.json",
  );
  return response.json();
}
