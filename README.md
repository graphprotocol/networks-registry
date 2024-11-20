# The Graph networks registry

[![GitHub Release](https://img.shields.io/github/v/release/graphprotocol/networks-registry)](https://github.com/graphprotocol/networks-registry/releases/latest)

This repository manages a registry of networks in The Graph ecosystem.

See [Releases](https://github.com/graphprotocol/networks-registry/releases) page for the latest version of the registry.
See [Networks Table](./docs/networks-table.md) for an up-to-date auto-generated networks list.

[Libraries](https://github.com/pinax-network/graph-networks-libs) for Typescript, Go and Rust.

[Demo app](https://graph-networks-app.vercel.app/) for the registry.

## Adding/updating a chain

- add/update a network JSON in the `registry` directory. See [Adding a Chain](./docs/adding-a-chain.md) for details
- [optional] validate with `bun validate` (see below for local setup steps)
- [optional] format with `bun format`
- increment patch version in `package.json`
- open a PR. This will trigger validation checks and will signal if there are any issues with your definition

## Structure of the repository

- `schemas/`: Contains the schema for the registry
- `registry/`: Contains the networks JSONs (edit these)
- `docs/`: Contains docs and auto-generated networks table
- `public`: Contains all generated registry versions (don't edit those)
- `src/`: Contains scripts to validate networks JSONs and generate the resulting registry JSON

## Setup

- install `bun`: https://bun.sh/
- `git clone` the repository
- install dependencies `bun install --no-save`
- rename `.env.example` to `.env`
- [optional] get your free [Studio API key](https://thegraph.com/studio/apikeys/) and set it in the `.env` file - we will need it to run a few queries to do some network validation

## Scripts usage

- `bun generate:types` - generate types from schema if schema has changed to use for validation
- `bun validate:schema` - validate networks JSONs against the schema
- `bun validate:networks` - additional semantic validation of networks JSONs, i.e. uniqueness, relations, urls, ethereum chain list, graph network, icons, etc
- `bun generate:registry` - generate resulting registry JSON in `./dist`
- `bun validate:registry` - validate generated registry in `./dist` against the schema
- `bun format` - format JSON and TS files with prettier
- `bun format:check` - check JSON and TS formatting with prettier
- `bun all` - do all of the above

## Versioning

### Schema Version

Registry schema has a MAJOR.MINOR semantic version, i.e. `v1.2`

When version needs to be incremented:

- MAJOR version: breaking schema change, i.e. field type change, new mandatory field, field removal
- MINOR version: backward compatible schema change, i.e. new optional field, new enum variant

### Registry version

Published registry has a MAJOR.MINOR.PATCH semantic version, i.e. `v1.2.3` where MAJOR.MINOR corresponds to the schema version

When version needs to be incremented:

- MAJOR/MINOR version: when schema is updated change MAJOR and MINOR versions to reflect the schema
- PATCH version: new network added, existing network entry updated

## Releases

Every PR merge triggers a GitHub action that generates new registry version, formats it, commits, publishes a release and deploys
4 registry JSON files with the identical contents are deployed in addition to existing ones.
Assuming current version is v1.2.3, the following files with identical content are published:

- TheGraphNetworksRegistry.json
- TheGraphNetworksRegistry_v1_2_3.json
- TheGraphNetworksRegistry_v1_2_x.json
- TheGraphNetworksRegistry_v1_x_x.json

In addition to the above, the JSON Schema is available at TheGraphNetworksRegistrySchema_v1_2.json

## Registry Usage

In your application you can use one of the generated registry JSONs above depending on your use case.

Libraries for Typescript, Go and Rust [exist](https://github.com/pinax-network/graph-networks-libs) to make it easier to work with the registry.

Typical use cases:

- Codegens and other tools for The Graph ecosystem
- Indexer infrastructure setup/validation
- Marketing and website
- Docs

## References

- [The Graph Networks Registry libraries](https://github.com/pinax-network/graph-networks-libs)
- [Ethereum chains list](https://github.com/ethereum-lists/chains)
- [CAIP-2 chain ids](https://chainagnostic.org/CAIPs/caip-2)
- [Web3Icons](https://github.com/0xa3k5/web3icons/tree/main/raw-svgs/networks/branded)
- [EBO subgraph](https://thegraph.com/explorer/subgraphs/4KFYqUWRTZQ9gn7GPHC6YQ2q15chJfVrX43ezYcwkgxB)
