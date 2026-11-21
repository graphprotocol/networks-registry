# AGENTS.md

Guidance for AI agents (Claude Code, Cursor, Copilot, etc.) working in this repo.

## What this repo is

A registry of networks in The Graph ecosystem. You edit **network JSON files in
`registry/`**; everything in `dist/` and `public/` is **generated — never edit it
by hand**.

- `schemas/` — JSON schema for a network definition
- `registry/<namespace>/` — the network JSONs, grouped by CAIP-2 namespace
  (`eip155` for EVM chains, `solana`, `cosmos`, `near`, …)
- `src/` — validation + generation scripts
- `docs/adding-a-chain.md` — human-facing field reference (read it for field meanings)

## Adding / updating a chain

1. **Pick the namespace and file path.** For an EVM chain, the file is
   `registry/eip155/<id>.json`, where `<id>` matches the `id` field. Choose a short,
   descriptive id — avoid `mainnet`/`testnet` in it (`mychain`, not `mychain-mainnet`;
   `mychain-sepolia`, not `mychain-testnet`).

2. **Copy the closest existing chain as a template.** For a Pinax-served EVM L2, start
   from `registry/eip155/megaeth.json`. For an Arbitrum Orbit chain, see `apechain.json`
   or `gravity-mainnet.json`. Matching an existing neighbor keeps field ordering and
   conventions consistent.

3. **Verify every value against live sources — do not trust docs blindly.** Useful checks:

   ```bash
   # Chain ID (hex → decimal; caip2Id is eip155:<decimal>)
   curl -s -X POST <RPC_URL> -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

   # Genesis block hash → firehose.firstStreamableBlock.id
   curl -s -X POST <RPC_URL> -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x0",false],"id":1}'

   # Pinax service reachability
   timeout 5 bash -c 'echo > /dev/tcp/<id>.firehose.pinax.network/443' && echo OPEN

   # Pinax ABI endpoint actually serves this chain (see gotcha below)
   curl -s '<id>.abi.pinax.network/api?module=contract&action=getabi&address=0x0000000000000000000000000000000000000000'
   ```

4. **Validate, then format:**

   ```bash
   bun validate   # schema + semantic checks; MUST have zero errors (warnings are ok)
   bun format     # prettier
   ```

5. **Open a PR.** Do **not** bump the version in `package.json` — CI does that
   automatically on merge (`generate registry vX.Y.Z [no ci]` commits).

## Pinax endpoint conventions

For a chain with id `<id>`, Pinax endpoints follow these patterns:

- Firehose: `<id>.firehose.pinax.network:443`
- Substreams: `<id>.substreams.pinax.network:443`
- RPC: `<id>.rpc.pinax.network` (free tier, rate limited per IP; the older
  `<id>.rpc.service.pinax.network` form is no longer used)
- ABI (Etherscan-like): `<id>.abi.pinax.network/api`

The subdomain is sometimes a short alias rather than the registry id (e.g. `arbone` for
`arbitrum-one`, `eth` for `mainnet`) — copy it from an existing entry for the same chain.

**Always confirm each one responds before listing it** — the subdomain existing does
not mean the chain is provisioned.

**Never remove a Pinax `rpc.pinax.network` endpoint unless explicitly asked** —
even if it is temporarily down or not archive. These are first-party; report the problem
instead of deleting the endpoint.

## GraphOps endpoint conventions

GraphOps endpoints are keyed by chain ID rather than registry id:

- RPC (EVM): `https://rpc.graphops.xyz/v1/evm/<chainId>/{GRAPHOPS_API_KEY}`
- RPC (Bitcoin): `https://rpc.graphops.xyz/v1/bitcoin/<network>/{GRAPHOPS_API_KEY}`
- Subgraphs: a `gateway` entry next to The Graph's gateway on every chain that has one, with
  provider `https://subgraphs.graphops.xyz/v1` and `queryUrls`
  `https://subgraphs.graphops.xyz/v1/subgraphId/{SUBGRAPH_ID}/{API_KEY}` and
  `https://subgraphs.graphops.xyz/v1/deploymentCID/{DEPLOYMENT_ID}/{API_KEY}`

Every GraphOps request needs an API key, so RPC URLs carry the `{GRAPHOPS_API_KEY}`
placeholder. The served chains are listed at
`https://platform-api.graphops.xyz/v1/data-services/networks`; only add an endpoint for a
chain listed there under the matching service.

## Maintaining rpcUrls

Aim for **3 healthy** RPC endpoints per chain, preferring **archive** nodes. Use the
audit/cleanup tool:

```bash
bun cleanup:rpcs                 # dry run: audit ALL eip155 chains, print issues
bun cleanup:rpcs base bnb-op     # only these ids (prefix match)
bun cleanup:rpcs --write --max=3 # apply changes, target 3 RPCs/chain, then `bun format`
```

An endpoint is **healthy** when it returns the right chainId and serves
`firstStreamableBlock` with the matching hash — the same check the daily maintenance run
(`validate_urls.ts`) does. For each chain the tool keeps healthy registry endpoints plus
all Pinax endpoints, removes dead/failing ones, and tops up to `--max` from
[chainlist.org](https://chainlist.org/rpcs.json): archive nodes (`eth_getBalance` at
`firstStreamableBlock.height`) first, then least tracking, one per provider host. If no
endpoint at all serves `firstStreamableBlock` (some chains' nodes don't serve block 0, or
the registry value is stale) it keeps the reachable ones and reports the chain instead of
emptying it. It also reports stale `firstStreamableBlock`, chainId mismatches and broken
Pinax endpoints. Endpoints that need a paid plan/key fail the probe and are dropped.
Default is dry-run — review before `--write`, since public RPC liveness varies run-to-run.

## Gotchas (these cause validation ERRORS, not just warnings)

- **web3icons name must exist.** Setting `icon.web3Icons.name` to an id that isn't in
  the [web3icons](https://github.com/0xa3k5/web3icons) repo is an **ERROR**. If no icon
  exists yet, **omit the `icon` field entirely** (that's only a warning). Check with:
  `curl -sI https://raw.githubusercontent.com/0xa3k5/web3icons/refs/heads/main/raw-svgs/networks/branded/<name>.svg`

- **Brand-new chains aren't in the ethereum-lists repo yet.** Validation cross-checks
  `caip2Id` against [chainid.network](https://chainid.network). If the chain is too new
  to appear there, add its `id` to `ALLOWED_ETHEREUM_LIST_MISSING` in
  `src/validate_logic.ts` (remove it once the chain lands upstream).

- **Only list an ABI endpoint that serves the chain.** A Pinax ABI URL that returns
  `Invalid chain: <id>` is not provisioned — omit it and rely on the block explorer's
  `/api` endpoint instead.

- **Don't edit generated output.** Never hand-edit `dist/` or `public/`; regenerate via
  the scripts.

## EVM firehose block config (typical for a Pinax-served L2)

```json
"firehose": {
  "blockType": "sf.ethereum.type.v2.Block",
  "evmExtendedModel": false,
  "bufUrl": "https://buf.build/streamingfast/firehose-ethereum",
  "bytesEncoding": "hex",
  "firstStreamableBlock": { "id": "<genesis hash>", "height": 0 },
  "blockFeatures": ["base"]
}
```

Use `evmExtendedModel: true` + `"blockFeatures": ["extended"]` only when the extended
EVM model is actually indexed for the chain (e.g. `base.json`, `arbitrum-one.json`).
