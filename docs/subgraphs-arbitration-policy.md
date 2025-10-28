# Network Arbitration Policy for Subgraphs

> **Note**: This policy applies to **subgraphs** specifically. The Networks Registry tracks multiple Graph services (subgraphs, firehose, substreams, token API), but arbitration is currently only applicable to subgraph indexing and querying.

## What is Arbitration?

Arbitration is The Graph Network's dispute resolution system for subgraphs. It allows fishermen to challenge indexers who provide incorrect query responses or Proofs of Indexing (POIs). If proven incorrect, the indexer is penalized (slashed) and the fisherman receives a reward.

This system ensures data integrity and indexer accountability on The Graph Network.

For complete details, see:
- [GIP-0008: Timeline for Sunsetting Hosted Service](https://snapshot.org/#/council.graphprotocol.eth/proposal/0xbdd884654a393620a7e8665b4289201b7542c3ee62becfad133e951b0c408444) - Introduced the Feature Support Matrix
- [Arbitration Charter](https://github.com/graphprotocol/graph-improvement-proposals/blob/main/gips/0009-arbitration-charter.md) - Detailed arbitration rules and procedures

## Default Rule

Networks with indexing rewards (`issuanceRewards: true`) support both query and indexing arbitration on The Graph Network unless explicitly documented as exceptions in the [Feature Support Matrix](https://github.com/graphprotocol/indexer/blob/main/docs/feature-support-matrix.md).

This is a bidirectional relationship:
- **Indexing rewards enabled** → Arbitration support enabled
- **Arbitration support enabled** → Indexing rewards enabled

## Checking Arbitration Support

To verify if a network supports arbitration:

1. Check the [Networks Table](./networks-table.md)
2. Look for ✅ in the **"Indexing Rewards"** column
3. If ✅ present → Network has full arbitration support (query + indexing)
4. If no ✅ → Network does not have arbitration support
5. For rare exceptions, check the [Feature Support Matrix](https://github.com/graphprotocol/indexer/blob/main/docs/feature-support-matrix.md)

## Examples

### Networks with Arbitration Support

- **Ethereum** (`issuanceRewards: true`) → ✅ Full arbitration support
- **Arbitrum One** (`issuanceRewards: true`) → ✅ Full arbitration support
- **Polygon** (`issuanceRewards: true`) → ✅ Full arbitration support
- **Gnosis** (`issuanceRewards: true`) → ✅ Full arbitration support

### Networks without Arbitration Support

- **Near** (`issuanceRewards: false`) → ❌ No arbitration support
- **Solana** (`issuanceRewards: false`) → ❌ No arbitration support
- **Bitcoin** (`issuanceRewards: false`) → ❌ No arbitration support

## Governance

Per [GGP-0062](https://snapshot.org/#/s:council.graphprotocol.eth/proposal/0x4eff14202f6204c0927860a9adff865fce33c32b6cbe7054227457631ee261b9):

**Network-level (managed in this registry)**:
- **The Graph Foundation** (with Technical Advisory Board review) has authority to add or remove indexing rewards for networks via the `issuanceRewards` field
- Since indexing rewards determine arbitration support, this authority also controls network arbitration eligibility

**Feature-level (managed in Feature Support Matrix)**:
- **The Graph Council** can determine which new graph-node features or data source types are eligible for indexing rewards and arbitration
- These decisions are documented in the [Feature Support Matrix](https://github.com/graphprotocol/indexer/blob/main/docs/feature-support-matrix.md)

## Relationship with Feature Support Matrix

Historically, both network support and indexing rewards were documented in the [Feature Support Matrix](https://github.com/graphprotocol/indexer/blob/main/docs/feature-support-matrix.md) in the indexer repository. This created duplication with the Networks Registry.

**New approach (established by this documentation)**:
- **Networks Registry** (`issuanceRewards` field) = Source of truth for which networks have indexing rewards
- **Feature Support Matrix** = Documents graph-node features and arbitration rules, references registry for network-level data

This separation eliminates duplication and clarifies ownership: network metadata lives in the registry, graph-node behavior lives in the feature matrix.

## Related Documentation

- [Feature Support Matrix](https://github.com/graphprotocol/indexer/blob/main/docs/feature-support-matrix.md) - Graph-node features and arbitration policy
- [Networks Table](./networks-table.md) - Complete list of supported networks
- [GIP-0008](https://snapshot.org/#/council.graphprotocol.eth/proposal/0xbdd884654a393620a7e8665b4289201b7542c3ee62becfad133e951b0c408444) - Introduced the Feature Support Matrix
- [Arbitration Charter](https://github.com/graphprotocol/graph-improvement-proposals/blob/main/gips/0009-arbitration-charter.md) - Detailed arbitration rules and procedures
- [GGP-0062](https://snapshot.org/#/s:council.graphprotocol.eth/proposal/0x4eff14202f6204c0927860a9adff865fce33c32b6cbe7054227457631ee261b9) - Governance structure for feature matrix
