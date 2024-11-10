# Adding a Chain to the Networks Registry

Each chain should be defined as a JSON file in the `registry` directory with the filename matching the chain `id` (e.g., `mainnet.json`, `arbitrum-one.json`).

## Fields

- `id` - Unique descriptive identifier for the chain (e.g., "mainnet", "arbitrum-one"). See [Choosing a Chain ID](#choosing-a-chain-id) for best practices

- `shortName` - Brief display name (e.g., "Ethereum", "BNB")

- `fullName` - Full display name (e.g., "Ethereum Mainnet", "BNB Smart Chain")

- `aliases` [optional] - Alternative names for the chain (e.g., ["ethereum", "eth", "eth-mainnet"])

- `caip2Id` - [CAIP-2](https://chainagnostic.org/CAIPs/caip-2) chain identifier (e.g., "eip155:1", "near:mainnet")

- `networkType` - One of: "mainnet", "testnet", "devnet"

- `explorerUrls` [optional] - Array of block explorer URLs

- `rpcUrls` [optional] - Array of RPC endpoint URLs. Use "{CUSTOM_API_KEY}" placeholder for API keys

- `apiUrls` [optional] - Etherscan-like API endpoints

- `docsUrl` [optional] - Chain documentation URL

- `services` - The Graph services support for the chain

  - `subgraphs` - Studio support for subgraphs
  - `sps` - Studio support for substreams-based subgraphs
  - `firehose` - Firehose support and endpoints
  - `substreams` - Substreams support and endpoints

- `relations` [optional] - Relationships with other chains

- `firehose` [optional] - Firehose configuration

- `genesis` [optional] - Genesis block information

- `nativeToken` [optional] - Native token symbol (e.g., "ETH", "BNB")

- `graphNode` [optional] - Graph Node protocol configuration

- `icon` [optional] - Chain icon name from [Web3Icons](https://github.com/0xa3k5/web3icons)

- `indexerDocsUrls` [optional] - Documentation for running indexer components

## Example Chain Definition

```json
{
  "id": "arbitrum-one",
  "shortName": "Arbitrum One",
  "fullName": "Arbitrum One Mainnet",
  "aliases": ["arbone", "arbitrum", "arb-sepolia", "evm-42161"],
  "caip2Id": "eip155:42161",
  "graphNode": { "protocol": "ethereum" },
  "relations": [{ "kind": "l2Of", "network": "mainnet" }],
  "explorerUrls": ["https://arbiscan.io"],
  "rpcUrls": [
    "https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}",
    "https://arbitrum-mainnet.infura.io/v3/${INFURA_API_KEY}",
    "https://arbone.rpc.pinax.network/v1/{PINAX_API_KEY}",
    "https://arb1.arbitrum.io/rpc"
  ],
  "apiUrls": [
    { "url": "https://arbitrum-one.abi.pinax.network/api", "kind": "etherscan" }
  ],
  "services": {
    "subgraphs": [{ "provider": "e&n" }],
    "sps": [{ "provider": "e&n" }],
    "firehose": [
      { "provider": "pinax", "url": "arbone.firehose.pinax.network:443" }
    ],
    "substreams": [
      { "provider": "pinax", "url": "arbone.substreams.pinax.network:443" }
    ]
  },
  "networkType": "mainnet",
  "issuanceRewards": true,
  "nativeToken": "ETH",
  "docsUrl": "https://docs.arbitrum.io",
  "indexerDocsUrls": [
    {
      "url": "https://docs.infradao.com/archive-nodes-101/arbitrum",
      "kind": "rpc"
    }
  ],
  "genesis": {
    "hash": "0x7ee576b35482195fc49205cec9af72ce14f003b9ae69f6ba0faef4514be8b442",
    "height": 0
  },
  "firehose": {
    "blockType": "sf.ethereum.type.v2.Block",
    "evmExtendedModel": true,
    "bufUrl": "https://buf.build/streamingfast/firehose-ethereum",
    "bytesEncoding": "hex"
  },
  "icon": { "web3Icons": { "name": "arbitrum-one" } }
}
```

## Choosing a Chain ID

The chain ID should be unique and descriptive. Avoid using `mainnet` or `testnet` in the chain ID. Instead of `mychain-testnet` use `mychain-sepolia`.

## Validation

After adding your chain definition:

1. Run validation checks. This will validate your JSON against the schema and check for any semantic issues:

```bash
bun validate
```

2. Format the JSON:

```bash
bun format
```

3. Increment the patch version in `package.json`

4. Create a pull request with your changes

For more information about setting up the environment, validation process and available scripts, refer to the main [README](../README.md).
